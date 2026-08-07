import { describe, it, expect } from "vitest";
import { levelingCommand, isLevel, C172_LEVELING } from "./leveling";
import { loadC172 } from "../sim/params";
import { buildSpawnState } from "../takeover/spawn";
import { stepAircraft, refreshDerived } from "../sim/aircraft";
import { hprFromQuat, quatFromHpr } from "../sim/quat";
import { degToRad, radToDeg } from "../sim/units";
import type { Contact } from "../data/types";
import type { ControlVector, SimState } from "../sim/types";

const P = loadC172();

const ga = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.6944, lon: -88.0399,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});

/**
 * A trimmed, powered spawn re-banked to `rollDeg`. The re-bank is a pure roll about the nose,
 * so the nose direction — and therefore the velocity vector, which lies along it — is unchanged
 * and no sideslip is introduced; only the bank differs from the wings-level spawn.
 */
function bankedFlight(rollDeg: number): { state: SimState; controls: ControlVector } {
  const spawn = buildSpawnState(ga(), P, { terrainHeightM: 100 });
  const pos = spawn.state.position;
  const hpr = hprFromQuat(spawn.state.attitude, pos);
  const attitude = quatFromHpr(pos, hpr.headingRad, hpr.pitchRad, degToRad(rollDeg));
  const state = refreshDerived({ ...spawn.state, attitude }, spawn.controls, P);
  return { state, controls: spawn.controls };
}

const bankDeg = (s: SimState): number => radToDeg(hprFromQuat(s.attitude, s.position).rollRad);

describe("levelingCommand (pure controller)", () => {
  it("commands opposite roll to the bank and eases off as it nears level", () => {
    const strong = levelingCommand(degToRad(45), 0, C172_LEVELING);
    expect(strong.roll).toBeLessThan(0); // banked right (positive) -> roll left (negative)
    const gentle = levelingCommand(degToRad(3), 0, C172_LEVELING);
    expect(Math.abs(gentle.roll)).toBeLessThan(Math.abs(strong.roll));
  });
  it("clamps its output to the stick range even at extreme attitudes", () => {
    const c = levelingCommand(degToRad(80), degToRad(-50), C172_LEVELING);
    expect(c.roll).toBeGreaterThanOrEqual(-1);
    expect(c.roll).toBeLessThanOrEqual(1);
    expect(c.pitch).toBeGreaterThanOrEqual(-1);
    expect(c.pitch).toBeLessThanOrEqual(1);
  });
  it("reports level only once inside tolerance on BOTH axes", () => {
    expect(isLevel(0, 0, C172_LEVELING)).toBe(true);
    expect(isLevel(degToRad(10), 0, C172_LEVELING)).toBe(false);
    expect(isLevel(0, degToRad(10), C172_LEVELING)).toBe(false);
  });
});

describe("leveling assist through the REAL sim (broken-arm)", () => {
  it("eases a 45-degree bank to near level within ~2 s — and a no-op assist would NOT", () => {
    // Engaged: apply the pure controller every fixed tick and step the real aircraft.
    const { controls } = bankedFlight(45);
    let leveled = bankedFlight(45).state;
    for (let i = 0; i < 130; i++) {
      const hpr = hprFromQuat(leveled.attitude, leveled.position);
      const cmd = levelingCommand(hpr.rollRad, hpr.pitchRad, C172_LEVELING);
      leveled = stepAircraft(leveled, { ...controls, roll: cmd.roll, pitch: cmd.pitch }, P);
    }
    expect(Math.abs(bankDeg(leveled))).toBeLessThan(5);

    // Control arm: the SAME banked scenario left alone holds its bank (self-centring stick on a
    // rate command = hold). If leveling were a no-op, `leveled` above would look like this and
    // the assertion pair could not tell the two apart — that is what this branch pins.
    let held = bankedFlight(45).state;
    for (let i = 0; i < 130; i++) {
      held = stepAircraft(held, { ...controls, roll: 0, pitch: 0 }, P);
    }
    expect(Math.abs(bankDeg(held))).toBeGreaterThan(25);
  });
});
