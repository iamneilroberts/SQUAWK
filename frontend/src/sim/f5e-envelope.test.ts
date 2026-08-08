/*
 * The F-5E performance envelope. The F-5E is DATA driving the SAME 6-DOF force model as the
 * C172 and 737 (spec §5, CLAUDE.md iron rule) — no per-class branch. The near-flat-rated J85
 * turbojets are expressed through the shared power-limited-prop thrust formula with a high
 * propPeakSpeedMs and the shared turbofan density lapse; the afterburner is the shared dry/wet
 * `afterburnerFactor` (Task 3), NOT a fighter-only code path. These tests are the honesty check
 * on that claim: the shared formula, tuned only via the f5e data file, must produce a physically
 * sane fighter — a real dry-vs-wet thrust delta, a strong burner climb, a subsonic Mmo cap, and
 * a high fighter g-clamp that actually bites.
 *
 * Climb is found by search over the real force balance, not hard-coded, so the test proves the
 * model produces the number. The helpers mirror b738-envelope.test.ts but carry the afterburner
 * flag through the excess-thrust calc, so the dry-vs-wet climb delta is real thrust physics.
 *
 * NOTE on the shared turbofan corner (decisions AF-002): TURBOFAN_CORNER_M is FL380 (11582 m),
 * pinned by the b738 ceiling test. Every altitude exercised below is <= 20000 ft (6096 m), well
 * under the corner where turbofanPowerLapse returns 1.0 — so the shared corner is inert here and
 * these targets are met without re-tuning it. The F-5E's ~15700 m ceiling sits above the corner
 * but no envelope test reaches it (airborne-spawn sim, spec non-goals: no ceiling-hang test).
 */
import { describe, it, expect } from "vitest";
import { loadF5e } from "./params";
import { dragCoefficient, thrustNewtons } from "./forces";
import { isaDensity } from "./isa";
import { stepAircraft, refreshDerived } from "./aircraft";
import { geodeticToEcef } from "./geo";
import { quatFromHpr, qRotate } from "./quat";
import { degToRad, ftToM, ktToMs, msToFpm } from "./units";
import type { ClassParams, ControlVector, SimState } from "./types";

const P = loadF5e();
const G0 = 9.80665;
const LAT = degToRad(30.6944);
const LON = degToRad(-88.0399);

/** Thrust (dry or wet) minus the drag required to hold level flight at this speed. */
function levelFlightExcessThrustN(
  params: ClassParams,
  altM: number,
  throttle: number,
  flapIndex: number,
  tasMs: number,
  afterburner: boolean,
): number {
  const qBar = 0.5 * isaDensity(altM) * tasMs * tasMs;
  const cl = (params.massKg * G0) / (qBar * params.wingAreaM2);
  const cd = dragCoefficient(cl, params, params.flaps[flapIndex]);
  return thrustNewtons(params, throttle, tasMs, altM, afterburner) - cd * qBar * params.wingAreaM2;
}

/** Best rate of climb at this altitude and power, m/s, by scanning the (jet) speed range. */
function bestClimbRateMs(
  params: ClassParams,
  altM: number,
  throttle: number,
  afterburner: boolean,
): number {
  let best = -Infinity;
  for (let v = 30; v <= 400; v += 0.25) {
    const excess = levelFlightExcessThrustN(params, altM, throttle, 0, v, afterburner);
    const climb = (excess * v) / (params.massKg * G0);
    if (climb > best) best = climb;
  }
  return best;
}

function levelState(params: ClassParams, altM: number, tasMs: number, controls: ControlVector): SimState {
  const position = geodeticToEcef(LAT, LON, altM);
  const attitude = quatFromHpr(position, 0, 0, 0);
  return refreshDerived(
    {
      position,
      velocity: qRotate(attitude, { x: tasMs, y: 0, z: 0 }),
      attitude,
      rates: { x: 0, y: 0, z: 0 },
      timeS: 0,
      altitudeM: altM, tasMs, iasMs: 0, aoaRad: 0, sideslipRad: 0,
      verticalSpeedMs: 0, loadFactor: 1, gLimited: false, stalled: false, machNumber: 0, gearPosition: 0,
    },
    controls,
    params,
  );
}

describe("F5E envelope", () => {
  it("dry-vs-wet thrust delta is exactly afterburnerFactor (real dry->wet physics)", () => {
    const dry = thrustNewtons(P, 1, 200, ftToM(20000), false);
    const wet = thrustNewtons(P, 1, 200, ftToM(20000), true);
    expect(wet / dry).toBeCloseTo(P.propulsion.afterburnerFactor, 3);
  });

  it("climbs strongly with the burner lit and more strongly than dry", () => {
    const dryClimb = msToFpm(bestClimbRateMs(P, ftToM(10000), 1, /*afterburner*/ false));
    const wetClimb = msToFpm(bestClimbRateMs(P, ftToM(10000), 1, /*afterburner*/ true));
    expect(wetClimb).toBeGreaterThan(dryClimb);
    expect(wetClimb).toBeGreaterThan(5000); // fighter-class wet climb
  });

  it("caps at Mmo ~0.95 (no supersonic / wave-drag path, deferred to issue #2)", () => {
    expect(P.limits.mmo).toBeLessThanOrEqual(0.95);
    expect(P.limits.mmo).toBeGreaterThan(0.9);
  });

  it("g clamps at the fighter limit and actually reaches it", () => {
    // Broken-arm structure (as b738/c172): prove the clamp is HIT, not merely never exceeded.
    // The +7.33 g clamp only bites from a fast enough entry — at 15000 ft the wing cannot make
    // 7.33 g until the dynamic pressure is high enough; 550 kt TAS (well under Mmo, ~M0.86) gets
    // there with the burner lit. A slower 450 kt entry tops out around 5.5 g without reaching it.
    const controls: ControlVector = { pitch: 1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: 1, gearDown: false, afterburner: true };
    let s = levelState(P, ftToM(15000), ktToMs(550), controls);
    let maxG = 0;
    let sawLimit = false;
    for (let i = 0; i < 600; i++) {
      s = stepAircraft(s, controls, P);
      maxG = Math.max(maxG, s.loadFactor);
      if (s.gLimited) sawLimit = true;
    }
    expect(sawLimit).toBe(true);
    expect(maxG).toBeLessThanOrEqual(P.limits.gLimitPos + 1e-9);
    expect(maxG).toBeCloseTo(P.limits.gLimitPos, 6);
  });
});
