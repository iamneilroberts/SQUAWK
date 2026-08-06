/*
 * The one loop. Driven by a single host frame callback (Cesium's scene.preRender in the
 * app, a fake in the tests) with performance.now() timing, it:
 *   - samples the held keys into a control vector once per PHYSICS tick, not per frame;
 *   - runs the fixed 60 Hz accumulator with the 0.25 s / 15 step clamp;
 *   - tests terrain collision every tick through the injected terrain service;
 *   - drives the camera once per FRAME (rendering cadence, not physics cadence);
 *   - publishes a HUD snapshot at ~10 Hz;
 *   - reports a falling sim rate honestly instead of quietly running in slow motion.
 *
 * It talks to a FlightHost, not to a Viewer, which is what makes all of the above testable
 * without Cesium. globe/cesiumFlightHost.ts is the ten-line real implementation.
 */
import type { ClassParams, ControlVector, SimState } from "../sim/types";
import type { TerrainService } from "../world/terrain";
import type { SpawnResult } from "../takeover/spawn";
import type { HudSnapshot } from "../hud/snapshot";
import type { FlightStats } from "./stats";
import { stepAircraft } from "../sim/aircraft";
import { createAccumulator, runFixedSteps, FIXED_DT } from "../sim/integrator";
import { ecefToGeodetic } from "../sim/geo";
import { hprFromQuat } from "../sim/quat";
import { createControlSampler } from "../input/controls";
import { createStatsAccumulator } from "./stats";
import { classifyEnd, readImpact } from "./classify";
import { createRateMeter } from "./simRate";

export const SNAPSHOT_INTERVAL_S = 0.1;

export type FlightHost = {
  /** Subscribe to render frames; returns the unsubscribe. */
  onFrame(cb: (wallMs: number) => void): () => void;
  setCamera(state: SimState, dtS: number): void;
  enterFlightView(): void;
  exitFlightView(): void;
};

export type FlightLoopDeps = {
  host: FlightHost;
  params: ClassParams;
  terrain: TerrainService;
  spawn: SpawnResult;
  /** Live view of the held keys — the loop samples it, it does not own it. */
  heldKeys: ReadonlySet<string>;
  callsign: string;
  onSnapshot(s: HudSnapshot): void;
  onEnd(stats: FlightStats): void;
};

export function createFlightLoop(deps: FlightLoopDeps) {
  const { host, params, terrain, spawn, heldKeys, callsign, onSnapshot, onEnd } = deps;

  // The spawn's trimmed throttle and trim ARE the sampler's starting position — otherwise
  // the player inherits an idle, untrimmed aeroplane a second after the handoff card
  // promised otherwise.
  const sampler = createControlSampler(params, spawn.controls);
  const accumulator = createAccumulator();
  const rateMeter = createRateMeter(2);
  const stats = createStatsAccumulator(spawn.state);

  // Sim state lives HERE, in a closure variable — not in zustand (spec §3).
  let state: SimState = spawn.state;
  let controls: ControlVector = spawn.controls;

  let unsubscribe: (() => void) | null = null;
  let lastWallMs: number | null = null;
  let paused = false;
  let ended = false;
  let sinceSnapshotS = SNAPSHOT_INTERVAL_S; // publish immediately on the first frame
  let terrainClearanceM: number | null = null;

  function publish() {
    const hpr = hprFromQuat(state.attitude, state.position);
    onSnapshot({
      iasMs: state.iasMs,
      tasMs: state.tasMs,
      altitudeM: state.altitudeM,
      verticalSpeedMs: state.verticalSpeedMs,
      headingRad: hpr.headingRad,
      aoaRad: state.aoaRad,
      loadFactor: state.loadFactor,
      throttle: controls.throttle,
      flapLabel: params.flaps[controls.flapDetent].label,
      gear: params.gear,
      stalled: state.stalled,
      overspeed: state.iasMs > params.limits.vneIasMs,
      gLimited: state.gLimited,
      terrainClearanceM,
      terrainUnverified: terrain.unverified,
      simRate: rateMeter.rate(),
      airtimeS: state.timeS,
      classLabel: params.label,
      callsign,
      modelNote: params.modelNote,
    });
  }

  function endSession() {
    ended = true;
    const finished = stats.finish(
      state,
      classifyEnd(readImpact(state, params, controls.flapDetent)),
    );
    publish();
    onEnd(finished);
  }

  function stepOnce() {
    if (ended) return;
    controls = sampler.sample(heldKeys, FIXED_DT);
    state = stepAircraft(state, controls, params);
    stats.update(state);

    const geo = ecefToGeodetic(state.position);
    const ground = terrain.sample(geo.latRad, geo.lonRad, state.timeS);
    terrainClearanceM = ground.heightM === null ? null : state.altitudeM - ground.heightM;
    if (ground.collisionArmed && ground.heightM !== null && state.altitudeM <= ground.heightM) {
      endSession();
    }
  }

  function onFrame(wallMs: number) {
    if (lastWallMs === null) {
      lastWallMs = wallMs; // first frame only establishes the clock
      publish();
      return;
    }
    const elapsedS = (wallMs - lastWallMs) / 1000;
    lastWallMs = wallMs;

    if (paused || ended) {
      host.setCamera(state, elapsedS);
      return;
    }

    const { steps } = runFixedSteps(accumulator, elapsedS, stepOnce);
    rateMeter.record(steps * FIXED_DT, elapsedS);
    host.setCamera(state, elapsedS);

    sinceSnapshotS += elapsedS;
    if (sinceSnapshotS >= SNAPSHOT_INTERVAL_S) {
      sinceSnapshotS = 0;
      publish();
    }
  }

  return {
    start() {
      if (unsubscribe) return;
      host.enterFlightView();
      unsubscribe = host.onFrame(onFrame);
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      // Forget the paused wall time so resuming does not simulate it (nor clamp-and-drop it).
      lastWallMs = null;
    },
    stop() {
      if (!unsubscribe) return;
      unsubscribe();
      unsubscribe = null;
      host.exitFlightView();
    },
    isPaused() {
      return paused;
    },
    getState(): SimState {
      return state;
    },
  };
}
