import { describe, it, expect } from "vitest";
import { createFlightLoop, SNAPSHOT_INTERVAL_S } from "./flightLoop";
import type { FlightHost } from "./flightLoop";
import { loadC172 } from "../sim/params";
import { buildSpawnState } from "../takeover/spawn";
import { createTerrainService } from "../world/terrain";
import { FIXED_DT } from "../sim/integrator";
import { ecefToGeodetic } from "../sim/geo";
import { refreshDerived } from "../sim/aircraft";
import { hprFromQuat, quatFromHpr } from "../sim/quat";
import { degToRad, msToKt, radToDeg } from "../sim/units";
import type { SpawnResult } from "../takeover/spawn";
import type { FlightStats } from "./stats";
import type { HudSnapshot } from "../hud/snapshot";
import type { Contact } from "../data/types";
import type { RunwayAssignment } from "../mission/types";
import { missionProfileForClass } from "../mission/profiles";
import type { FlightLandingResult } from "./flightLoop";

const P = loadC172();

const ga = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.6944, lon: -88.0399,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});

/** A host the test drives frame by frame. */
function fakeHost() {
  let cb: ((wallMs: number) => void) | null = null;
  const calls = { enter: 0, exit: 0, camera: 0 };
  const host: FlightHost = {
    onFrame(fn) {
      cb = fn;
      return () => { cb = null; };
    },
    setCamera() { calls.camera++; },
    enterFlightView() { calls.enter++; },
    exitFlightView() { calls.exit++; },
  };
  return {
    host,
    calls,
    frame(wallMs: number) { cb?.(wallMs); },
    get subscribed() { return cb !== null; },
  };
}

/** A trimmed, powered spawn re-banked to `rollDeg` (pure roll about the nose: no sideslip). */
function bankedSpawn(rollDeg: number): SpawnResult {
  const base = buildSpawnState(ga(), P, { terrainHeightM: 100 });
  const pos = base.state.position;
  const hpr = hprFromQuat(base.state.attitude, pos);
  const attitude = quatFromHpr(pos, hpr.headingRad, hpr.pitchRad, degToRad(rollDeg));
  return { ...base, state: refreshDerived({ ...base.state, attitude }, base.controls, P) };
}

const bankDegOf = (loop: { getState(): { attitude: any; position: any } }): number => {
  const s = loop.getState();
  return radToDeg(hprFromQuat(s.attitude, s.position).rollRad);
};

function makeLoop(overrides: {
  groundHeight?: number | undefined;
  held?: Set<string>;
  analog?: () => import("../input/analog").AnalogAxes | undefined;
  contact?: Contact;
  spawn?: SpawnResult;
  landing?: { assignment: RunwayAssignment; profile: ReturnType<typeof missionProfileForClass> };
} = {}) {
  const spawn = overrides.spawn ?? buildSpawnState(overrides.contact ?? ga(), P, { terrainHeightM: 100 });
  const terrain = createTerrainService(() =>
    "groundHeight" in overrides ? overrides.groundHeight : 100);
  const ends: FlightStats[] = [];
  const snaps: HudSnapshot[] = [];
  const landings: FlightLandingResult[] = [];
  const h = fakeHost();
  const loop = createFlightLoop({
    host: h.host,
    params: P,
    terrain,
    spawn,
    heldKeys: overrides.held ?? new Set<string>(),
    analog: overrides.analog,
    callsign: "SIM-A1B2C3",
    landing: overrides.landing,
    onSnapshot: (s) => snaps.push(s),
    onEnd: (s, landing) => {
      ends.push(s);
      if (landing !== undefined) landings.push(landing);
    },
  });
  return { loop, host: h, ends, landings, snaps, terrain, spawn };
}

describe("flight loop lifecycle", () => {
  it("start subscribes to frames and enters the flight view", () => {
    const { loop, host } = makeLoop();
    loop.start();
    expect(host.subscribed).toBe(true);
    expect(host.calls.enter).toBe(1);
    loop.stop();
  });
  it("stop unsubscribes and restores the view (no residue)", () => {
    const { loop, host } = makeLoop();
    loop.start();
    loop.stop();
    expect(host.subscribed).toBe(false);
    expect(host.calls.exit).toBe(1);
  });
  it("stop is idempotent", () => {
    const { loop, host } = makeLoop();
    loop.start();
    loop.stop();
    loop.stop();
    expect(host.calls.exit).toBe(1);
  });
  it("a restarted loop re-bases its clock instead of lurching through the dead time", () => {
    // Task 11 tears a flight down and builds the next one, and stop()/start() is the seam it
    // does it on. A stop() that leaves the frame clock set turns the gap between two flights
    // into a clamped-and-dropped 0.25 s of physics on the first frame of the second one.
    const { loop, host } = makeLoop();
    loop.start();
    host.frame(1000);
    host.frame(1100); // 100 ms -> 6 steps
    const flown = loop.getState().timeS;
    loop.stop();

    loop.start();
    host.frame(400000); // minutes later: this frame only re-establishes the clock
    expect(loop.getState().timeS).toBeCloseTo(flown, 9);
    host.frame(400000 + 1000 / 60);
    expect(loop.getState().timeS).toBeCloseTo(flown + FIXED_DT, 9);
    loop.stop();
  });
  it("a restarted loop is not born paused", () => {
    const { loop, host } = makeLoop();
    loop.start();
    host.frame(1000);
    loop.pause();
    loop.stop();

    loop.start();
    expect(loop.isPaused()).toBe(false);
    host.frame(2000);
    host.frame(2100);
    expect(loop.getState().timeS).toBeCloseTo(6 * FIXED_DT, 9);
    loop.stop();
  });
  it("the first frame establishes the clock without simulating a huge jump", () => {
    const { loop, spawn } = makeLoop();
    loop.start();
    loop.getState();
    expect(loop.getState().timeS).toBe(0);
    expect(loop.getState().altitudeM).toBeCloseTo(spawn.state.altitudeM, 6);
    loop.stop();
  });
});

describe("flight loop stepping", () => {
  it("advances sim time in 1/60 s increments driven by the host clock", () => {
    const { loop, host } = makeLoop();
    loop.start();
    host.frame(1000);
    host.frame(1000 + 100); // 100 ms -> 6 steps
    expect(loop.getState().timeS).toBeCloseTo(6 * FIXED_DT, 9);
    loop.stop();
  });
  it("caps a 30 s gap at 15 steps and reports a low sim rate", () => {
    const { loop, host, snaps } = makeLoop();
    loop.start();
    host.frame(1000);
    host.frame(31000);
    expect(loop.getState().timeS).toBeCloseTo(15 * FIXED_DT, 9);
    const last = snaps[snaps.length - 1];
    expect(last.simRate).toBeLessThan(0.5);
    loop.stop();
  });
  it("moves the camera every frame", () => {
    const { loop, host } = makeLoop();
    loop.start();
    host.frame(1000);
    host.frame(1016);
    host.frame(1032);
    expect(host.calls.camera).toBeGreaterThanOrEqual(2);
    loop.stop();
  });
});

describe("flight loop pause", () => {
  it("a paused loop does not advance sim time", () => {
    const { loop, host } = makeLoop();
    loop.start();
    host.frame(1000);
    host.frame(1100);
    const t = loop.getState().timeS;
    loop.pause();
    host.frame(5000);
    host.frame(9000);
    expect(loop.getState().timeS).toBeCloseTo(t, 9);
    expect(loop.isPaused()).toBe(true);
    loop.stop();
  });
  it("resuming does not simulate the paused wall time", () => {
    const { loop, host } = makeLoop();
    loop.start();
    host.frame(1000);
    loop.pause();
    host.frame(60000);
    loop.resume();
    host.frame(60100); // the first frame back only re-establishes the clock
    host.frame(60200); // 100 ms of flying time -> 6 steps, not 59 s worth
    expect(loop.getState().timeS).toBeCloseTo(6 * FIXED_DT, 9);
    loop.stop();
  });
  it("a pause that delivered no frames at all still does not jump on resume", () => {
    // The visibilitychange auto-pause is exactly this case: a hidden tab stops delivering
    // frames, so the clock reference is minutes stale by the time the player comes back.
    // Re-basing on the first frame after RESUME is what keeps that from arriving as a
    // clamped-and-dropped 0.25 s lurch the moment the globe is clicked.
    const { loop, host } = makeLoop();
    loop.start();
    host.frame(1000);
    loop.pause();
    loop.resume(); // not one frame in between
    host.frame(300000); // five minutes later
    host.frame(300000 + 1000 / 60);
    expect(loop.getState().timeS).toBeCloseTo(FIXED_DT, 9);
    loop.stop();
  });
});

describe("flight loop snapshots", () => {
  it("publishes about 10 snapshots per simulated second, not 60", () => {
    const { loop, host, snaps } = makeLoop();
    loop.start();
    let t = 1000;
    for (let i = 0; i < 60; i++) { t += 1000 / 60; host.frame(t); }
    expect(snaps.length).toBeGreaterThanOrEqual(8);
    expect(snaps.length).toBeLessThanOrEqual(14);
    expect(SNAPSHOT_INTERVAL_S).toBeCloseTo(0.1, 9);
    loop.stop();
  });
  it("the snapshot carries the callsign, the flap label and the honest model note", () => {
    const { loop, host, snaps } = makeLoop();
    loop.start();
    host.frame(1000);
    host.frame(1200);
    const s = snaps[snaps.length - 1];
    expect(s.callsign).toBe("SIM-A1B2C3");
    expect(s.classLabel).toBe(P.label); // "C172S" — spec §9 wants class beside the callsign
    expect(s.flapLabel).toBe("0");
    expect(s.modelNote).toBe(P.modelNote);
    expect(s.gear).toBe("fixed");
    loop.stop();
  });
  it("publishes the sampled trim so the cockpit control-state readout has a source (issue #7)", () => {
    const { loop, host, snaps, spawn } = makeLoop();
    loop.start();
    host.frame(1000);
    host.frame(1200);
    const s = snaps[snaps.length - 1];
    expect(Number.isFinite(s.trim)).toBe(true);
    // The spawn hands over a trimmed aircraft; left alone for two frames trim is unchanged.
    expect(s.trim).toBeCloseTo(spawn.controls.trim, 9);
    loop.stop();
  });
  it("reports overspeed against Vne and terrain clearance against the sampled ground", () => {
    const { loop, host, snaps } = makeLoop({ groundHeight: 500 });
    loop.start();
    host.frame(1000);
    host.frame(1200);
    const s = snaps[snaps.length - 1];
    expect(s.overspeed).toBe(false);
    expect(s.terrainClearanceM).toBeCloseTo(s.altitudeM - 500, 3);
    loop.stop();
  });
  it("reports terrainUnverified when the sampler never returns a height", () => {
    const { loop, host, snaps } = makeLoop({ groundHeight: undefined });
    loop.start();
    host.frame(1000);
    host.frame(1200);
    const s = snaps[snaps.length - 1];
    expect(s.terrainUnverified).toBe(true);
    expect(s.terrainClearanceM).toBeNull();
    loop.stop();
  });
});

describe("flight loop collision", () => {
  /*
   * The spawn hands over a TRIMMED, POWERED aircraft, so it holds altitude if left alone —
   * these tests must therefore fly it down on purpose. `KeyS` walks the throttle to idle
   * (about 2 s) and the trimmed 172 settles into a ~750 fpm glide, which covers 60 m in
   * roughly fifteen seconds. They also have to outlast the 3 s spawn grace before
   * collision can arm at all, which is why none of them is a short run.
   */
  const IDLE = () => new Set(["KeyS"]);
  const spawnAltitudeM = () => buildSpawnState(ga(), P, { terrainHeightM: 100 }).state.altitudeM;

  function fly(loopBits: ReturnType<typeof makeLoop>, frames: number) {
    let t = 1000;
    for (let i = 0; i < frames && loopBits.ends.length === 0; i++) {
      t += 1000 / 60;
      loopBits.host.frame(t);
    }
    return t;
  }

  it("ends the session when the aircraft glides down onto the sampled terrain", () => {
    const bits = makeLoop({ groundHeight: spawnAltitudeM() - 60, held: IDLE() });
    bits.loop.start();
    fly(bits, 2400); // 40 s of sim, well past both the glide time and the spawn grace
    expect(bits.ends).toHaveLength(1);
    expect(["LANDED", "CRASHED"]).toContain(bits.ends[0].classification);
    expect(bits.ends[0].airtimeS).toBeGreaterThan(3); // it flew, it did not spawn into the dirt
    bits.loop.stop();
  });
  it("emits one bounded mission evidence window with terminal surface contact", () => {
    const landingAssignment = {
      airportIdent: "KTST", airportName: "Test", airportLatDeg: 30.6944,
      airportLonDeg: -88.0399, airportElevationFt: 300, runwayId: "1",
      runwayIdent: "09/27", runwayEndIdent: "27", runwayHeadingDeg: 270,
      runwayLengthFt: 8_000, runwayWidthFt: 1_000, runwaySurface: "HARD",
      runwayLighted: true,
      assignedEnd: {
        ident: "27", latDeg: 30.6944, lonDeg: -88.0399, elevationFt: 300,
        headingDeg: 270, displacedThresholdFt: 0,
      },
      distanceNm: 1, estimatedMinutes: 1, suitability: 1,
    } satisfies RunwayAssignment;
    const bits = makeLoop({
      groundHeight: spawnAltitudeM() - 60,
      held: IDLE(),
      landing: { assignment: landingAssignment, profile: missionProfileForClass("c172s") },
    });
    bits.loop.start();
    fly(bits, 2_400);
    expect(bits.landings).toHaveLength(1);
    expect(bits.landings[0].evidence.samples.length).toBeLessThanOrEqual(512);
    expect(bits.landings[0].evidence.samples.at(-1)?.surfaceContact).toBe(true);
    expect(bits.ends[0].classification).toBe(
      bits.landings[0].evaluation.outcome === "landed" ? "LANDED" : "CRASHED",
    );
    bits.loop.stop();
  });
  it("a dive into terrain reads CRASHED with a real impact sink rate and speed", () => {
    // ArrowUp is stick FORWARD (Task 4 KEYMAP: "pitch down"), KeyS is throttle down —
    // nose down at idle, which arrives fast and steep.
    const held = new Set(["ArrowUp", "KeyS"]);
    const bits = makeLoop({ groundHeight: spawnAltitudeM() - 200, held });
    bits.loop.start();
    fly(bits, 3600);
    expect(bits.ends).toHaveLength(1);
    expect(bits.ends[0].classification).toBe("CRASHED");
    expect(bits.ends[0].impactSinkFpm).toBeGreaterThan(600);
    expect(msToKt(bits.ends[0].impactIasMs)).toBeGreaterThan(40);
    bits.loop.stop();
  });
  it("does not collide while the ground has never been sampled", () => {
    const bits = makeLoop({ groundHeight: undefined, held: IDLE() });
    bits.loop.start();
    fly(bits, 1800);
    expect(bits.ends).toHaveLength(0);
    bits.loop.stop();
  });
  it("does not collide inside the spawn grace, even with the ground above the aircraft", () => {
    // Ground 500 m ABOVE the spawn: armed, this collides on the very first armed tick.
    // Inside the grace it must not — that window is what stops a teleport reading as a crash.
    const bits = makeLoop({ groundHeight: spawnAltitudeM() + 500, held: IDLE() });
    bits.loop.start();
    fly(bits, 120); // 2 s of sim, inside the 3 s grace
    expect(bits.ends).toHaveLength(0);
    fly(bits, 300); // past the grace — now it must fire
    expect(bits.ends).toHaveLength(1);
    bits.loop.stop();
  });
  it("does not collide after terrain.disarm() — and WOULD have without it", () => {
    const ground = spawnAltitudeM() + 500;
    // Control arm first: prove the setup really does collide when collision is armed.
    const armed = makeLoop({ groundHeight: ground, held: IDLE() });
    armed.loop.start();
    fly(armed, 600);
    expect(armed.ends).toHaveLength(1);
    armed.loop.stop();

    const disarmed = makeLoop({ groundHeight: ground, held: IDLE() });
    disarmed.terrain.disarm();
    disarmed.loop.start();
    fly(disarmed, 600);
    expect(disarmed.ends).toHaveLength(0);
    disarmed.loop.stop();
  });
  it("stops stepping once the session has ended (no physics past the impact)", () => {
    const bits = makeLoop({ groundHeight: spawnAltitudeM() - 60, held: IDLE() });
    bits.loop.start();
    let t = fly(bits, 2400);
    expect(bits.ends).toHaveLength(1);
    const frozen = bits.loop.getState().timeS;
    for (let i = 0; i < 60; i++) { t += 1000 / 60; bits.host.frame(t); }
    expect(bits.loop.getState().timeS).toBeCloseTo(frozen, 9);
    bits.loop.stop();
  });
  it("the position at the end is at or below the ground it hit", () => {
    const ground = spawnAltitudeM() - 60;
    const bits = makeLoop({ groundHeight: ground, held: IDLE() });
    bits.loop.start();
    fly(bits, 2400);
    expect(bits.ends).toHaveLength(1);
    expect(ecefToGeodetic(bits.loop.getState().position).heightM).toBeLessThanOrEqual(ground);
    bits.loop.stop();
  });
});

describe("the 10 Hz snapshot carries everything the cockpit instruments need", () => {
  it("publishes pitch and roll, not just heading — the attitude indicator has no other source", () => {
    const { loop, host, snaps } = makeLoop();
    loop.start();
    host.frame(0);
    expect(snaps.length).toBeGreaterThan(0);
    const s = snaps[snaps.length - 1];
    expect(Number.isFinite(s.pitchRad)).toBe(true);
    expect(Number.isFinite(s.rollRad)).toBe(true);
    // buildSpawnState hands over trimmed and wings-level, so roll starts at (near) zero.
    expect(Math.abs(s.rollRad)).toBeLessThan(0.05);
    loop.stop();
  });

  it("publishes a POSITIVE rate of turn for a right turn", () => {
    // Right rudder, through the real physics — a sign error here is what puts the turn
    // coordinator's little aeroplane the wrong way up in a turn.
    const { loop, host, snaps } = makeLoop({ held: new Set(["KeyD"]) });
    loop.start();
    host.frame(0);
    for (let i = 1; i <= 120; i++) host.frame(i * 16.7);
    const s = snaps[snaps.length - 1];
    expect(s.turnRateRadS).toBeGreaterThan(0);
    loop.stop();
  });

  it("publishes a NEGATIVE rate of turn for a left turn", () => {
    const { loop, host, snaps } = makeLoop({ held: new Set(["KeyA"]) });
    loop.start();
    host.frame(0);
    for (let i = 1; i <= 120; i++) host.frame(i * 16.7);
    expect(snaps[snaps.length - 1].turnRateRadS).toBeLessThan(0);
    loop.stop();
  });

  it("publishes sideslip and the aircraft's own geodetic position", () => {
    const { loop, host, snaps } = makeLoop();
    loop.start();
    host.frame(0);
    const s = snaps[snaps.length - 1];
    expect(Number.isFinite(s.sideslipRad)).toBe(true);
    // The `ga()` contact this file spawns from sits at 30.6944 N, 88.0399 W.
    expect(s.latDeg).toBeCloseTo(30.69, 1);
    expect(s.lonDeg).toBeCloseTo(-88.04, 1);
    loop.stop();
  });
});

describe("flight loop analog input seam (mobile sub-feature 2, Option B)", () => {
  it("an analog throttle target drives the lever absolutely through the loop", () => {
    // The spawn hands over a trimmed, non-idle throttle; an analog throttle of 0.15 must
    // OVERRIDE it (absolute lever), which only the Option B seam can do.
    const { loop, host, snaps, spawn } = makeLoop({ analog: () => ({ throttle: 0.15 }) });
    expect(spawn.controls.throttle).toBeGreaterThan(0.15); // precondition: spawn is more open
    loop.start();
    host.frame(1000);
    host.frame(1200);
    expect(snaps[snaps.length - 1].throttle).toBeCloseTo(0.15, 6);
    loop.stop();
  });

  it("grabbing the virtual stick cancels the return-to-level assist", () => {
    // KeyL engages leveling; an analog roll deflection past the threshold must cancel it, the
    // same way an arrow key does — otherwise the stick would feel dead on a phone under assist.
    const bits = makeLoop({
      spawn: bankedSpawn(45),
      held: new Set(["KeyL"]),
      analog: () => ({ roll: 0.5 }),
    });
    bits.loop.start();
    bits.host.frame(0);
    bits.host.frame(1000 / 60);
    expect(bits.loop.isLeveling()).toBe(false);
    bits.loop.stop();
  });

  it("a below-threshold analog deflection does NOT cancel leveling", () => {
    const bits = makeLoop({
      spawn: bankedSpawn(45),
      held: new Set(["KeyL"]),
      analog: () => ({ roll: 0.05 }),
    });
    bits.loop.start();
    bits.host.frame(0);
    bits.host.frame(1000 / 60);
    expect(bits.loop.isLeveling()).toBe(true);
    bits.loop.stop();
  });
});

describe("flight loop return-to-level assist (issue #5a)", () => {
  const framesFor = (loop: ReturnType<typeof makeLoop>, count: number) => {
    loop.host.frame(0); // establish the clock
    for (let i = 1; i <= count; i++) loop.host.frame((i * 1000) / 60);
  };

  it("KeyL eases a 45-degree bank back to near level, through the real physics", () => {
    const bits = makeLoop({ spawn: bankedSpawn(45), held: new Set(["KeyL"]) });
    bits.loop.start();
    expect(Math.abs(bankDegOf(bits.loop))).toBeGreaterThan(40); // starts banked
    framesFor(bits, 150); // ~2.5 s
    expect(Math.abs(bankDegOf(bits.loop))).toBeLessThan(6);
    bits.loop.stop();
  });

  it("auto-disengages once it reaches level", () => {
    const bits = makeLoop({ spawn: bankedSpawn(45), held: new Set(["KeyL"]) });
    bits.loop.start();
    framesFor(bits, 150);
    expect(bits.loop.isLeveling()).toBe(false);
    bits.loop.stop();
  });

  it("a manual roll input cancels the assist — the bank does NOT level", () => {
    // KeyL would engage leveling, but a simultaneous right-roll command must win and cancel it.
    const bits = makeLoop({ spawn: bankedSpawn(45), held: new Set(["KeyL", "ArrowRight"]) });
    bits.loop.start();
    framesFor(bits, 30); // ~0.5 s
    expect(bits.loop.isLeveling()).toBe(false); // cancelled on the very first step
    expect(Math.abs(bankDegOf(bits.loop))).toBeGreaterThan(40); // still banked (rolling further)
    bits.loop.stop();
  });
});
