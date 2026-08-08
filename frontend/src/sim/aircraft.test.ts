import { describe, it, expect } from "vitest";
import { stepAircraft, refreshDerived } from "./aircraft";
import { loadC172 } from "./params";
import { geodeticToEcef, ecefToGeodetic } from "./geo";
import { quatFromHpr, qRotate, hprFromQuat } from "./quat";
import { enuBasis } from "./geo";
import { vDot } from "./vec3";
import { degToRad, radToDeg } from "./units";
import { FIXED_DT } from "./integrator";
import type { ControlVector, SimState } from "./types";

/** Ground-track heading of the velocity vector, radians clockwise from north. */
function trackRad(s: SimState): number {
  const { east, north } = enuBasis(s.position);
  return Math.atan2(vDot(s.velocity, east), vDot(s.velocity, north));
}

/** Signed shortest-arc difference, degrees. */
function headingDeltaDeg(from: number, to: number): number {
  return (((radToDeg(to - from) % 360) + 540) % 360) - 180;
}

const P = loadC172();
const LAT = degToRad(30.6944);
const LON = degToRad(-88.0399);

const CONTROLS: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle: 0.75, flapDetent: 0, trim: 0, gearDown: false, afterburner: false };

function levelState(altM: number, tasMs: number): SimState {
  const position = geodeticToEcef(LAT, LON, altM);
  const attitude = quatFromHpr(position, 0, 0, 0);
  const state: SimState = {
    position,
    velocity: qRotate(attitude, { x: tasMs, y: 0, z: 0 }),
    attitude,
    rates: { x: 0, y: 0, z: 0 },
    timeS: 0,
    altitudeM: altM, tasMs, iasMs: 0, aoaRad: 0, sideslipRad: 0,
    verticalSpeedMs: 0, loadFactor: 1, gLimited: false, stalled: false, machNumber: 0, gearPosition: 0,
  };
  return refreshDerived(state, CONTROLS, P);
}

describe("stepAircraft", () => {
  it("advances sim time by exactly one fixed step", () => {
    const s = stepAircraft(levelState(2000, 60), CONTROLS, P);
    expect(s.timeS).toBeCloseTo(FIXED_DT, 12);
  });
  it("keeps the attitude quaternion unit-norm", () => {
    let s = levelState(2000, 60);
    for (let i = 0; i < 600; i++) s = stepAircraft(s, { ...CONTROLS, roll: 0.5, pitch: 0.2 }, P);
    const q = s.attitude;
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
  });
  it("never produces NaN, even from a dead stop", () => {
    let s = levelState(2000, 0);
    for (let i = 0; i < 600; i++) s = stepAircraft(s, CONTROLS, P);
    expect(Number.isFinite(s.position.x)).toBe(true);
    expect(Number.isFinite(s.velocity.z)).toBe(true);
    expect(Number.isFinite(s.altitudeM)).toBe(true);
  });
  it("an unpowered aircraft loses altitude", () => {
    let s = levelState(2000, 60);
    for (let i = 0; i < 600; i++) s = stepAircraft(s, { ...CONTROLS, throttle: 0 }, P);
    expect(s.altitudeM).toBeLessThan(2000);
    expect(s.verticalSpeedMs).toBeLessThan(0);
  });
  it("full power at a trimmed climb attitude gains altitude", () => {
    let s = levelState(500, 40);
    for (let i = 0; i < 900; i++) s = stepAircraft(s, { ...CONTROLS, throttle: 1, trim: 1 }, P);
    expect(s.altitudeM).toBeGreaterThan(500);
  });
  it("roll input rolls the aircraft right (positive roll = right wing down)", () => {
    let s = levelState(2000, 60);
    for (let i = 0; i < 60; i++) s = stepAircraft(s, { ...CONTROLS, roll: 1 }, P);
    expect(s.rates.x).toBeGreaterThan(0);
    expect(hprFromQuat(s.attitude, s.position).rollRad).toBeGreaterThan(degToRad(5));
  });
  it("a banked aircraft turns — the ground track swings toward the low wing", () => {
    // Roll right for 0.75 s (rate damping then holds the bank), then hold it with back
    // pressure for 10 s. Tilting the lift vector is what turns the velocity, so the GROUND
    // TRACK is the direct evidence — a position that merely moved would also pass in
    // straight flight, which is why this asserts a heading change and not a displacement.
    let s = levelState(2000, 60);
    for (let i = 0; i < 45; i++) s = stepAircraft(s, { ...CONTROLS, roll: 1 }, P);
    const before = trackRad(s);
    for (let i = 0; i < 600; i++) s = stepAircraft(s, { ...CONTROLS, pitch: 0.3 }, P);
    expect(headingDeltaDeg(before, trackRad(s))).toBeGreaterThan(20); // right turn
  });
  it("wings level, the ground track holds — the turn above came from the bank", () => {
    let s = levelState(2000, 60);
    const before = trackRad(s);
    for (let i = 0; i < 600; i++) s = stepAircraft(s, { ...CONTROLS, pitch: 0.3 }, P);
    expect(Math.abs(headingDeltaDeg(before, trackRad(s)))).toBeLessThan(5);
  });
  it("derived readouts stay consistent with the raw state", () => {
    const s = stepAircraft(levelState(2000, 60), CONTROLS, P);
    expect(s.altitudeM).toBeCloseTo(ecefToGeodetic(s.position).heightM, 6);
    expect(s.tasMs).toBeGreaterThan(50);
    expect(s.iasMs).toBeLessThan(s.tasMs); // 2000 m up, IAS reads low
  });
  it("does not mutate the state object it was given", () => {
    const s0 = levelState(2000, 60);
    const snapshot = JSON.stringify(s0);
    stepAircraft(s0, CONTROLS, P);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});
