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

describe("flight loop time compression (#87)", () => {
  it("defaults to 1x", () => {
    const { loop } = makeLoop();
    expect(loop.getTimeCompression()).toBe(1);
  });

  it("scales elapsed WALL time, not the fixed physics dt — 4x runs ~4x the steps for the same wall-clock gap", () => {
    const { loop: loop1x, host: host1x } = makeLoop();
    loop1x.start();
    host1x.frame(1000);
    host1x.frame(1050); // 50 ms real -> 3 steps at 1x
    const flown1x = loop1x.getState().timeS;
    loop1x.stop();

    const { loop: loop4x, host: host4x } = makeLoop();
    loop4x.start();
    loop4x.setTimeCompression(4);
    host4x.frame(1000);
    host4x.frame(1050); // the SAME 50 ms real, scaled to 200 ms of sim time -> 12 steps
    const flown4x = loop4x.getState().timeS;
    loop4x.stop();

    expect(flown4x).toBeCloseTo(flown1x * 4, 9);
    // Every one of those steps is still exactly FIXED_DT — the physics dt itself never grew,
    // only the number of 1/60 s steps taken per rendered frame did.
    expect(flown4x / FIXED_DT).toBeCloseTo(12, 9);
  });

  it("publishes the active factor on the HUD snapshot", () => {
    const { loop, host, snaps } = makeLoop();
    loop.start();
    loop.setTimeCompression(2);
    host.frame(1000);
    host.frame(1100);
    expect(snaps[snaps.length - 1].timeCompression).toBe(2);
    loop.stop();
  });

  it("auto-resets to 1x once the aircraft is within the near-ground floor", () => {
    // 500 ft over flat ground: inside the ~1000 ft auto-reset floor from the very first tick.
    const spawn = buildSpawnState(ga(), P, { terrainHeightM: 0, spawnAltitudeFtOverride: 500 });
    const { loop, host } = makeLoop({ spawn, groundHeight: 0 });
    loop.start();
    loop.setTimeCompression(4);
    expect(loop.getTimeCompression()).toBe(4);
    host.frame(1000);
    host.frame(1016); // one real tick is enough to sample terrain and trip the auto-reset
    expect(loop.getTimeCompression()).toBe(1);
    loop.stop();
  });

  it("does not auto-reset comfortably above the floor", () => {
    const { loop, host } = makeLoop(); // default spawn: ~3400 ft AGL over 100 m ground
    loop.start();
    loop.setTimeCompression(4);
    host.frame(1000);
    host.frame(1100);
    expect(loop.getTimeCompression()).toBe(4);
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

describe("flight loop absolute altitude floor (#58)", () => {
  // Root cause: ground collision is the ONLY existing end path, and it is gated on
  // `collisionArmed`. When terrain is unverified (never sampled, or disarmed) that gate
  // never opens, so a plane that falls underground never ends — the player is trapped.
  // These tests drive that exact scenario: terrain permanently unverified, altitude
  // crossing the absolute floor, and confirm the loop still ends.
  const IDLE = () => new Set(["KeyS"]);

  function fly(loopBits: ReturnType<typeof makeLoop>, frames: number) {
    let t = 1000;
    for (let i = 0; i < frames && loopBits.ends.length === 0; i++) {
      t += 1000 / 60;
      loopBits.host.frame(t);
    }
    return t;
  }

  it("ends a flight that falls through unverified terrain past the absolute floor", () => {
    // groundHeight: undefined -> the sampler never returns a usable height, so
    // collisionArmed stays false for the entire flight (see "does not collide while the
    // ground has never been sampled" above). Spawn already close to the -500 m floor so a
    // short idle glide (~1.7 m/s sink here) crosses it well inside the test budget.
    const contact = ga({ alt_geom: -1575 }); // ftToM(-1575) ~= -480 m: above the floor, underground
    const spawn = buildSpawnState(contact, P, { terrainHeightM: null });
    const bits = makeLoop({ groundHeight: undefined, held: IDLE(), spawn });
    bits.loop.start();
    fly(bits, 1800); // 30 s of idle glide -- crosses the floor around the 12 s mark
    expect(bits.ends).toHaveLength(1);
    bits.loop.stop();
  });

  it("does not end a normal flight at/above the floor while terrain is unverified", () => {
    // Default spawn (~1066 m) with terrain never sampled: collision can never arm, and the
    // ~30 s idle glide only sheds ~120 m — nowhere near the -500 m floor. Must not end.
    const bits = makeLoop({ groundHeight: undefined, held: IDLE() });
    bits.loop.start();
    fly(bits, 1800); // 30 s of idle glide
    expect(bits.ends).toHaveLength(0);
    bits.loop.stop();
  });

  it("ends a flight whose altitude has gone non-finite, even with terrain unverified", () => {
    // NaN is the exact trap the finite check exists for: `NaN < ABSOLUTE_FLOOR_M` and
    // `NaN <= ground.heightM` are BOTH false, so without an explicit Number.isFinite guard a
    // NaN altitude (a degenerate quaternion / divide-by-zero in aero at some edge) would slip
    // past both end conditions and never end. A NaN alt_geom is the smallest seam that
    // produces a real, physics-propagated NaN altitude through the actual spawn/step path
    // (a degenerate quaternion is far harder to hand-construct and inject through this
    // harness, which has no state-injection seam by design).
    const contact = ga({ alt_geom: NaN });
    const spawn = buildSpawnState(contact, P, { terrainHeightM: null });
    expect(spawn.state.altitudeM).toBeNaN(); // confirm the seam actually produces NaN
    const bits = makeLoop({ groundHeight: undefined, held: IDLE(), spawn });
    bits.loop.start();
    fly(bits, 60); // NaN never resolves back to finite -- a couple of ticks is enough
    expect(bits.ends).toHaveLength(1);
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

describe("flight loop re-sync to live position (issue #5b)", () => {
  // A stateful frame driver: `fly(n)` advances n frames at 60 Hz on a wall clock that keeps
  // running across calls (the loop rejects a clock that jumps backwards), so a re-sync in the
  // middle of a test does not need the caller to thread the wall time by hand.
  const driverFor = (host: ReturnType<typeof fakeHost>) => {
    let ms = 0;
    return (frames: number) => {
      for (let i = 0; i < frames; i++) {
        host.frame(ms);
        ms += 1000 / 60;
      }
    };
  };

  it("teleports the aircraft to the live spawn and resets the sim clock", () => {
    const bits = makeLoop({ contact: ga({ alt_geom: 5000 }), groundHeight: 0 });
    const fly = driverFor(bits.host);
    bits.loop.start();
    fly(150); // ~2.5 s of flight so the clock and position have moved on
    expect(bits.loop.getState().timeS).toBeGreaterThan(1);

    const resyncSpawn = buildSpawnState(ga({ lat: 40.1, lon: -100.2, alt_geom: 9000 }), P, {
      terrainHeightM: 0,
    });
    bits.loop.resync(resyncSpawn);

    // Exactly the new spawn, and the clock is rebased so the terrain spawn grace re-applies.
    expect(bits.loop.getState().timeS).toBe(resyncSpawn.state.timeS);
    expect(bits.loop.getState().position.x).toBeCloseTo(resyncSpawn.state.position.x, 3);
    expect(bits.loop.getState().position.y).toBeCloseTo(resyncSpawn.state.position.y, 3);
    expect(bits.loop.getState().position.z).toBeCloseTo(resyncSpawn.state.position.z, 3);
    bits.loop.stop();
  });

  it("reseeds the control sampler so the next tick does not clobber the trimmed controls", () => {
    // Drift the throttle wide open, then re-sync: the reseeded sampler must hold the new spawn's
    // trimmed throttle, not the pre-resync full-throttle it had drifted to.
    const held = new Set<string>(["KeyW"]);
    const bits = makeLoop({ contact: ga({ alt_geom: 5000 }), groundHeight: 0, held });
    const fly = driverFor(bits.host);
    bits.loop.start();
    fly(150); // ~2.5 s of throttle-up
    expect(bits.snaps[bits.snaps.length - 1].throttle).toBeGreaterThan(0.9);

    const resyncSpawn = buildSpawnState(ga({ alt_geom: 5000 }), P, { terrainHeightM: 0 });
    held.clear();
    bits.loop.resync(resyncSpawn);
    fly(30); // half a second, hands off the keys

    expect(bits.snaps[bits.snaps.length - 1].throttle).toBeCloseTo(
      resyncSpawn.controls.throttle,
      2,
    );
    bits.loop.stop();
  });

  it("re-arms the terrain spawn grace so the teleport is not an instant crash", () => {
    // Ground sits at 1000 m; the loop flies safely above it, then re-syncs to a spawn BELOW it.
    // With the clock rebased to zero the grace window must keep collision disarmed for one frame.
    const bits = makeLoop({ contact: ga({ alt_geom: 5000 }), groundHeight: 1000 });
    const fly = driverFor(bits.host);
    bits.loop.start();
    fly(240); // >3 s: collision is armed, aircraft still above ground
    expect(bits.ends.length).toBe(0);

    const underground = buildSpawnState(ga({ lat: 40.1, lon: -100.2, alt_geom: 2000 }), P, {
      terrainHeightM: 1000,
    });
    bits.loop.resync(underground);
    fly(1); // one frame: still inside the re-armed grace
    expect(bits.ends.length).toBe(0);

    fly(240); // past the grace: now it collides with the ground it is under
    expect(bits.ends.length).toBe(1);
    bits.loop.stop();
  });

  it("resets the stats accumulator so the teleport jump is not counted as distance flown", () => {
    // The teleport moves the aircraft ~1000 km; without a stats reset that jump would be folded
    // into the path length. Only the short post-resync flight should count.
    const bits = makeLoop({ contact: ga({ alt_geom: 5000 }), groundHeight: 1000 });
    const fly = driverFor(bits.host);
    bits.loop.start();
    fly(240);
    const underground = buildSpawnState(ga({ lat: 40.1, lon: -100.2, alt_geom: 2000 }), P, {
      terrainHeightM: 1000,
    });
    bits.loop.resync(underground);
    fly(300); // fly on until it collides with the ground below
    expect(bits.ends.length).toBe(1);
    expect(bits.ends[0].distanceM).toBeLessThan(50_000); // km-scale teleport excluded
    bits.loop.stop();
  });

  it("is a no-op once the flight has already ended", () => {
    const bits = makeLoop({ contact: ga({ alt_geom: 500 }), groundHeight: 300 });
    const fly = driverFor(bits.host);
    bits.loop.start();
    fly(300); // fly into the ground
    expect(bits.ends.length).toBe(1);
    const ended = bits.loop.getState();

    const resyncSpawn = buildSpawnState(ga({ lat: 40.1, lon: -100.2, alt_geom: 9000 }), P, {
      terrainHeightM: 0,
    });
    bits.loop.resync(resyncSpawn); // must not revive the crashed flight
    expect(bits.loop.getState().position.x).toBe(ended.position.x);
    expect(bits.ends.length).toBe(1);
    bits.loop.stop();
  });
});
