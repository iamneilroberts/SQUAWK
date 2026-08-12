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
import { hprFromQuat, turnRateRadS } from "../sim/quat";
import { radToDeg } from "../sim/units";
import { createControlSampler } from "../input/controls";
import type { AnalogAxes } from "../input/analog";
import { createStatsAccumulator } from "./stats";
import { classifyEnd, readImpact } from "./classify";
import { createRateMeter } from "./simRate";
import { levelingCommand, isLevel, C172_LEVELING, MAX_LEVELING_S } from "./leveling";
import { gearOverspeedFor } from "../hud/format";
import { classifyLightPhase, solarElevationDeg } from "../world/dayNight";
import { createLandingEvidenceRecorder, type LandingEvidence } from "../mission/landingEvidence";
import { evaluateLandingEvidence, type LandingEvaluation } from "../mission/resultPackage";
import type { MissionProfile, RunwayAssignment } from "../mission/types";
import { classificationFromMissionOutcome } from "./classify";

export const SNAPSHOT_INTERVAL_S = 0.1;

/**
 * Terrain-independent crash floor (#58). Ground collision is gated on `collisionArmed`,
 * which never opens while terrain is unverified (never sampled, or permanently disarmed at
 * COUNTDOWN) — without this, a plane that falls through unverified/absent terrain never ends
 * and the player is trapped. No real mission terrain sits 500 m below the WGS84 ellipsoid
 * (Death Valley, the deepest, is ~-85 m), so crossing this floor means the aircraft has fallen
 * through terrain that was never there to collide with — treat it as a crash regardless of
 * `collisionArmed`.
 */
const ABSOLUTE_FLOOR_M = -500;

/**
 * Body roll/pitch rate (rad/s) below which the leveling assist counts the aircraft settled.
 * Set above the small residual oscillation that lingers once the bank is already level, but well
 * under the ~0.6 rad/s the aircraft is still rolling at when it crosses through level on its
 * natural overshoot — so the assist disengages when genuinely level, not mid-overshoot.
 */
const LEVELING_RATE_TOLERANCE_RADS = 0.15;

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
  /**
   * Optional live view of the analog touch/tilt axes (Option B seam, spec §6), sampled once per
   * tick like heldKeys. Absent on desktop: with no provider the sampler runs the keyboard path
   * unchanged. An axis it returns `undefined` for is not driven and stays on the sprung keyboard
   * path; a number overrides that axis directly.
   */
  analog?: () => AnalogAxes | undefined;
  callsign: string;
  onSnapshot(s: HudSnapshot): void;
  landing?: { assignment: RunwayAssignment; profile: MissionProfile };
  onEnd(stats: FlightStats, landing?: FlightLandingResult): void;
};

export type FlightLandingResult = {
  evidence: LandingEvidence;
  evaluation: LandingEvaluation;
};

export function createFlightLoop(deps: FlightLoopDeps) {
  const { host, params, terrain, spawn, heldKeys, analog, callsign, landing, onSnapshot, onEnd } = deps;

  // The spawn's trimmed throttle and trim ARE the sampler's starting position — otherwise
  // the player inherits an idle, untrimmed aeroplane a second after the handoff card
  // promised otherwise.
  const sampler = createControlSampler(params, spawn.controls);
  const accumulator = createAccumulator();
  const rateMeter = createRateMeter(2);
  const stats = createStatsAccumulator(spawn.state);
  const landingRecorder = landing === undefined ? null : createLandingEvidenceRecorder(spawn.state);

  // Sim state lives HERE, in a closure variable — not in zustand (spec §3).
  let state: SimState = spawn.state;
  let controls: ControlVector = spawn.controls;

  let unsubscribe: (() => void) | null = null;
  let lastWallMs: number | null = null;
  let paused = false;
  let ended = false;
  let sinceSnapshotS = SNAPSHOT_INTERVAL_S; // publish immediately on the first frame
  let terrainClearanceM: number | null = null;

  // Return-to-level assist (issue #5a): edge-triggered on KeyL, auto-disengages at level or on
  // the timeout, and cancels the moment the player gives manual roll/pitch input.
  let leveling = false;
  let levelingElapsedS = 0;
  let prevLevelKey = false;

  function publish() {
    const hpr = hprFromQuat(state.attitude, state.position);
    const geo = ecefToGeodetic(state.position);
    const latDeg = radToDeg(geo.latRad);
    const lonDeg = radToDeg(geo.lonRad);

    onSnapshot({
      iasMs: state.iasMs,
      tasMs: state.tasMs,
      altitudeM: state.altitudeM,
      verticalSpeedMs: state.verticalSpeedMs,
      headingRad: hpr.headingRad,
      pitchRad: hpr.pitchRad,
      rollRad: hpr.rollRad,
      // Rate of TURN, not body yaw rate, and signed positive-right — see sim/quat.ts.
      turnRateRadS: turnRateRadS(state.attitude, state.position, state.rates),
      sideslipRad: state.sideslipRad,
      latDeg,
      lonDeg,
      aoaRad: state.aoaRad,
      loadFactor: state.loadFactor,
      throttle: controls.throttle,
      trim: controls.trim,
      flapLabel: params.flaps[controls.flapDetent].label,
      gear: params.gear,
      gearPosition: state.gearPosition,
      stalled: state.stalled,
      overspeed: state.iasMs > params.limits.vneIasMs,
      machNumber: state.machNumber,
      machOverspeed: state.machNumber > params.limits.mmo,
      afterburner: controls.afterburner,
      gearOverspeed: gearOverspeedFor(params.gear, state.gearPosition, state.iasMs, params.limits.vleIasMs),
      gLimited: state.gLimited,
      terrainClearanceM,
      terrainUnverified: terrain.unverified,
      simRate: rateMeter.rate(),
      airtimeS: state.timeS,
      classLabel: params.label,
      callsign,
      modelNote: params.modelNote,
      // Real time + real position → the honest current light phase (issue #14).
      lightPhase: classifyLightPhase(solarElevationDeg(new Date(), latDeg, lonDeg)),
    });
  }

  function endSession() {
    // Guard against double-fire: the ground-collision check and the absolute-floor check
    // (#58) both call this from the same stepOnce tick when an aircraft dives through
    // armed terrain past the floor in one step. Without this guard both would run
    // endSession's landing-evidence/stats/onEnd side effects a second time.
    if (ended) return;
    ended = true;
    const landingResult = landing === undefined || landingRecorder === null
      ? undefined
      : (() => {
          const evidence = landingRecorder.finish(state);
          return {
            evidence,
            evaluation: evaluateLandingEvidence(evidence, landing.assignment, landing.profile),
          };
        })();
    const finished = stats.finish(
      state,
      landingResult === undefined
        ? classifyEnd(readImpact(state, params, controls.flapDetent))
        : classificationFromMissionOutcome(landingResult.evaluation.outcome),
    );
    publish();
    onEnd(finished, landingResult);
  }

  function stepOnce() {
    if (ended) return;
    const analogAxes = analog?.();
    controls = sampler.sample(heldKeys, FIXED_DT, analogAxes);

    // ---- return-to-level assist (issue #5a) ----
    const levelKey = heldKeys.has("KeyL");
    if (levelKey && !prevLevelKey) {
      leveling = true;
      levelingElapsedS = 0;
    }
    prevLevelKey = levelKey;
    if (leveling) {
      // Grabbing the virtual stick cancels the assist the same way an arrow key does — a
      // deflection past a small threshold counts as the player taking the controls back. The
      // `analogAxes !== undefined` guard keeps the keyboard/desktop path byte-identical (this
      // extra term is unreachable with no analog provider).
      const STICK_CANCEL = 0.2;
      const analogManual =
        analogAxes !== undefined &&
        ((analogAxes.roll !== undefined && Math.abs(analogAxes.roll) > STICK_CANCEL) ||
          (analogAxes.pitch !== undefined && Math.abs(analogAxes.pitch) > STICK_CANCEL));
      const manualInput =
        heldKeys.has("ArrowLeft") || heldKeys.has("ArrowRight") ||
        heldKeys.has("ArrowUp") || heldKeys.has("ArrowDown") || analogManual;
      if (manualInput) {
        // The player took the controls back — hand them straight back, no fight.
        leveling = false;
      } else {
        const hpr = hprFromQuat(state.attitude, state.position);
        const cmd = levelingCommand(hpr.rollRad, hpr.pitchRad, C172_LEVELING);
        controls = { ...controls, roll: cmd.roll, pitch: cmd.pitch };
        levelingElapsedS += FIXED_DT;
        // Disengage only when it is actually SETTLED — attitude AND body roll/pitch rate both
        // small. Attitude alone would disengage at the zero-crossing of the natural overshoot,
        // while the aircraft is still rolling through level, and leave a residual bank.
        const settled =
          isLevel(hpr.rollRad, hpr.pitchRad, C172_LEVELING) &&
          Math.abs(state.rates.x) < LEVELING_RATE_TOLERANCE_RADS &&
          Math.abs(state.rates.y) < LEVELING_RATE_TOLERANCE_RADS;
        if (settled || levelingElapsedS >= MAX_LEVELING_S) {
          leveling = false;
        }
      }
    }

    state = stepAircraft(state, controls, params);
    stats.update(state);
    landingRecorder?.record(state);

    const geo = ecefToGeodetic(state.position);
    const ground = terrain.sample(geo.latRad, geo.lonRad, state.timeS);
    terrainClearanceM = ground.heightM === null ? null : state.altitudeM - ground.heightM;
    if (ground.collisionArmed && ground.heightM !== null && state.altitudeM <= ground.heightM) {
      endSession();
    }
    // Terrain-independent: must fire even when collisionArmed is false (unverified terrain),
    // which is the whole point (#58). endSession()'s own guard keeps this from double-firing
    // on a tick where the collision check above already ended the session.
    if (state.altitudeM < ABSOLUTE_FLOOR_M) {
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
      // Same re-base as resume(), for the same reason: whatever gap follows — a teardown, a
      // handoff card, the next takeover on this instance — is dead time, not flying time.
      // Leaving the clock set would hand start() a stale reference and lurch the first frame.
      lastWallMs = null;
      paused = false;
    },
    isPaused() {
      return paused;
    },
    isLeveling() {
      return leveling;
    },
    getState(): SimState {
      return state;
    },
  };
}
