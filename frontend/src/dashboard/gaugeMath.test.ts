import { describe, it, expect } from "vitest";
import {
  ASI_START_DEG, ASI_SWEEP_DEG,
  VSI_FULL_SCALE_FPM, VSI_ZERO_DEG, AI_PX_PER_DEG,
  STANDARD_RATE_DEG_S, TC_SYMBOL_BANK_AT_STD_DEG, TC_MAX_SYMBOL_BANK_DEG,
  SLIP_FULL_SCALE_BETA_DEG, SLIP_BALL_TRAVEL_PX, SLIP_BALL_SIGN,
  asiNeedle, asiArcs, asiTicks, altimeterNeedle, altimeterDrum, vsiNeedle,
  attitudePitchOffsetPx, attitudeRollDeg, pitchLadderRungs,
  headingCardDeg, turnSymbolBankDeg, slipBallOffsetPx,
} from "./gaugeMath";
import { loadC172 } from "../sim/params";
import { stallSpeedIasMs } from "../sim/forces";
import { ktToMs, ftToM, fpmToMs, degToRad, msToKt } from "../sim/units";
import { EM_DASH } from "../hud/format";

const P = loadC172();
/** The scale the tests expect, written out independently of the implementation. */
const asiDeg = (kt: number) =>
  ASI_START_DEG + ((kt - 40) / (180 - 40)) * ASI_SWEEP_DEG;

describe("airspeed indicator needle", () => {
  it("puts the bottom and top of the scale on the dial's stops", () => {
    expect(asiNeedle(ktToMs(40), 40, 180)!.deg).toBeCloseTo(ASI_START_DEG, 6);
    expect(asiNeedle(ktToMs(180), 40, 180)!.deg).toBeCloseTo(ASI_START_DEG + ASI_SWEEP_DEG, 6);
  });
  it("places Vne inside the dial, short of the top stop", () => {
    const vne = asiNeedle(P.limits.vneIasMs, P.display.asiMinKt, P.display.asiMaxKt)!;
    expect(vne.deg).toBeCloseTo(asiDeg(msToKt(P.limits.vneIasMs)), 6);
    expect(vne.deg).toBeLessThan(ASI_START_DEG + ASI_SWEEP_DEG);
    expect(vne.pegged).toBe(false);
  });
  it("pegs against the bottom stop below the scale instead of running off the face", () => {
    const slow = asiNeedle(ktToMs(12), 40, 180)!;
    expect(slow.deg).toBe(ASI_START_DEG);
    expect(slow.pegged).toBe(true);
  });
  it("pegs against the top stop above the scale", () => {
    const fast = asiNeedle(ktToMs(400), 40, 180)!;
    expect(fast.deg).toBe(ASI_START_DEG + ASI_SWEEP_DEG);
    expect(fast.pegged).toBe(true);
  });
  it("returns null for an unknown airspeed — the view em-dashes it, it does not read zero", () => {
    expect(asiNeedle(null, 40, 180)).toBeNull();
    expect(asiNeedle(Number.NaN, 40, 180)).toBeNull();
  });
});

describe("airspeed indicator arcs", () => {
  const arcs = asiArcs(P);
  const byKind = (k: string) => arcs.find((a) => a.kind === k)!;

  it("runs the white arc from the full-flap stall to Vfe", () => {
    const vs0 = msToKt(stallSpeedIasMs(P, P.flaps.length - 1));
    expect(byKind("white").fromDeg).toBeCloseTo(asiDeg(vs0), 6);
    expect(byKind("white").toDeg).toBeCloseTo(asiDeg(msToKt(P.limits.vfeIasMs)), 6);
  });
  it("runs the green arc from the clean stall to Vno", () => {
    const vs1 = msToKt(stallSpeedIasMs(P, 0));
    expect(vs1).toBeCloseTo(48, 0); // the envelope test's Vs1, restated where the arc uses it
    expect(byKind("green").fromDeg).toBeCloseTo(asiDeg(vs1), 6);
    expect(byKind("green").toDeg).toBeCloseTo(asiDeg(msToKt(P.limits.vnoIasMs)), 6);
  });
  it("runs the yellow caution band from Vno to Vne", () => {
    expect(byKind("yellow").fromDeg).toBeCloseTo(asiDeg(msToKt(P.limits.vnoIasMs)), 6);
    expect(byKind("yellow").toDeg).toBeCloseTo(asiDeg(msToKt(P.limits.vneIasMs)), 6);
  });
  it("draws the red line AT Vne, as a zero-width mark", () => {
    const red = byKind("red");
    expect(red.fromDeg).toBeCloseTo(asiDeg(msToKt(P.limits.vneIasMs)), 6);
    expect(red.toDeg).toBeCloseTo(red.fromDeg, 6);
  });
  it("never produces an inverted or backwards arc", () => {
    for (const a of arcs) expect(a.toDeg).toBeGreaterThanOrEqual(a.fromDeg);
  });
});

describe("per-class ASI face", () => {
  it("C172 needle math is unchanged at the 40–180 range", () => {
    // 40 kt sits at the ASI_START_DEG stop; 180 at the far end.
    expect(asiNeedle(ktToMs(40), 40, 180)!.deg).toBeCloseTo(ASI_START_DEG, 4);
    expect(asiNeedle(ktToMs(180), 40, 180)!.deg).toBeCloseTo(ASI_START_DEG + ASI_SWEEP_DEG, 4);
  });
  it("maps a wide jet range linearly across the same sweep", () => {
    expect(asiNeedle(ktToMs(60), 60, 400)!.deg).toBeCloseTo(ASI_START_DEG, 4);
    expect(asiNeedle(ktToMs(230), 60, 400)!.deg).toBeCloseTo(ASI_START_DEG + ASI_SWEEP_DEG / 2, 1);
  });
  it("pegs past the ends of the class range", () => {
    expect(asiNeedle(ktToMs(20), 40, 180)!.pegged).toBe(true);
    expect(asiNeedle(ktToMs(500), 60, 400)!.pegged).toBe(true);
  });
  it("derives major tick labels from the range endpoints", () => {
    const t = asiTicks(60, 400);
    expect(t[0].kt).toBe(60);
    expect(t[t.length - 1].kt).toBe(400);
    expect(t.map((x) => x.label)).toContain("400");
  });
});

describe("altimeter", () => {
  it("sweeps the hundreds hand once per thousand feet", () => {
    expect(altimeterNeedle(ftToM(0))!.deg).toBeCloseTo(0, 6);
    expect(altimeterNeedle(ftToM(250))!.deg).toBeCloseTo(90, 6);
    expect(altimeterNeedle(ftToM(500))!.deg).toBeCloseTo(180, 6);
  });
  it("wraps at the thousand rather than pegging — an altimeter has no stop", () => {
    expect(altimeterNeedle(ftToM(3500))!.deg).toBeCloseTo(180, 6);
    expect(altimeterNeedle(ftToM(3500))!.pegged).toBe(false);
    expect(altimeterNeedle(ftToM(12000))!.deg).toBeCloseTo(0, 6);
  });
  it("keeps a legitimate negative altitude on the face instead of clamping it to zero", () => {
    // -40 ft (Schiphol) is 960 ft into the wrap, exactly where a real altimeter puts it.
    expect(altimeterNeedle(ftToM(-40))!.deg).toBeCloseTo(345.6, 4);
  });
  it("shows whole signed feet in the drum window", () => {
    expect(altimeterDrum(ftToM(3499.6))).toBe("3500");
    expect(altimeterDrum(ftToM(-40))).toBe("-40");
  });
  it("em-dashes the drum and nulls the needle when altitude is unknown", () => {
    expect(altimeterDrum(null)).toBe(EM_DASH);
    expect(altimeterNeedle(null)).toBeNull();
  });
});

describe("vertical speed indicator", () => {
  it("puts level flight at the 9 o'clock position", () => {
    expect(vsiNeedle(0)!.deg).toBeCloseTo(VSI_ZERO_DEG, 6);
    expect(vsiNeedle(0)!.pegged).toBe(false);
  });
  it("reaches the vertical stops at full scale, climb up and descent down", () => {
    expect(vsiNeedle(fpmToMs(VSI_FULL_SCALE_FPM))!.deg).toBeCloseTo(360, 6);
    expect(vsiNeedle(fpmToMs(-VSI_FULL_SCALE_FPM))!.deg).toBeCloseTo(180, 6);
  });
  it("clamps beyond full scale and says it is pegged rather than wrapping past vertical", () => {
    const dive = vsiNeedle(fpmToMs(-4200))!;
    expect(dive.deg).toBeCloseTo(180, 6);
    expect(dive.pegged).toBe(true);
  });
  it("returns null for an unknown vertical speed", () => {
    expect(vsiNeedle(null)).toBeNull();
  });
});

describe("attitude indicator", () => {
  it("puts the horizon on the centre line in level flight", () => {
    expect(attitudePitchOffsetPx(0)!.px).toBeCloseTo(0, 6);
  });
  it("moves the horizon down the face as the nose comes up, linearly", () => {
    expect(attitudePitchOffsetPx(degToRad(10))!.px).toBeCloseTo(10 * AI_PX_PER_DEG, 6);
    expect(attitudePitchOffsetPx(degToRad(-10))!.px).toBeCloseTo(-10 * AI_PX_PER_DEG, 6);
  });
  it("treats +/-90 as the real limit of hprFromQuat, not as a peg", () => {
    // hprFromQuat's pitch is atan2(up, |horizontal|), so it CANNOT exceed +/-90. Flagging
    // these as pegged would invent a stop the aeroplane never hits.
    expect(attitudePitchOffsetPx(degToRad(90))!.px).toBeCloseTo(90 * AI_PX_PER_DEG, 6);
    expect(attitudePitchOffsetPx(degToRad(90))!.pegged).toBe(false);
    expect(attitudePitchOffsetPx(degToRad(-90))!.pegged).toBe(false);
  });
  it("rotates the horizon opposite the roll — right wing down tips the horizon left", () => {
    expect(attitudeRollDeg(degToRad(30))).toBeCloseTo(-30, 6);
    expect(attitudeRollDeg(degToRad(-45))).toBeCloseTo(45, 6);
  });
  it("normalizes a roll past half a turn into (-180, 180]", () => {
    expect(attitudeRollDeg(degToRad(190))).toBeCloseTo(170, 6);
    expect(attitudeRollDeg(degToRad(180))).toBeCloseTo(180, 6);
  });
  it("lays the pitch ladder symmetrically and skips the horizon itself", () => {
    const rungs = pitchLadderRungs();
    expect(rungs.map((r) => r.deg)).toEqual([-30, -20, -10, 10, 20, 30]);
    expect(rungs.every((r) => r.label === String(Math.abs(r.deg)))).toBe(true);
    const ten = rungs.find((r) => r.deg === 10)!;
    const minusTen = rungs.find((r) => r.deg === -10)!;
    expect(ten.px).toBeCloseTo(-minusTen.px, 6);
  });
  it("returns null when attitude is unknown", () => {
    expect(attitudePitchOffsetPx(null)).toBeNull();
    expect(attitudeRollDeg(null)).toBeNull();
  });
});

describe("directional gyro", () => {
  it("rotates the card opposite the heading so the current heading sits under the lubber line", () => {
    expect(headingCardDeg(degToRad(0))).toBeCloseTo(0, 6);
    expect(headingCardDeg(degToRad(90))).toBeCloseTo(270, 6);
  });
  it("wraps 359 -> 0 without ever producing 360", () => {
    expect(headingCardDeg(degToRad(1))).toBeCloseTo(359, 6);
    expect(headingCardDeg(degToRad(359))).toBeCloseTo(1, 6);
    expect(headingCardDeg(degToRad(360))).toBeCloseTo(0, 6);
    expect(headingCardDeg(degToRad(360))).not.toBeCloseTo(360, 6);
  });
  it("normalizes a negative heading", () => {
    expect(headingCardDeg(degToRad(-90))).toBeCloseTo(90, 6);
  });
  it("returns null when heading is unknown", () => {
    expect(headingCardDeg(null)).toBeNull();
  });
});

describe("turn coordinator", () => {
  it("banks the symbol to the index at standard rate", () => {
    const std = turnSymbolBankDeg(degToRad(STANDARD_RATE_DEG_S))!;
    expect(std.deg).toBeCloseTo(TC_SYMBOL_BANK_AT_STD_DEG, 6);
    expect(std.pegged).toBe(false);
  });
  it("mirrors for a left turn", () => {
    expect(turnSymbolBankDeg(degToRad(-STANDARD_RATE_DEG_S))!.deg)
      .toBeCloseTo(-TC_SYMBOL_BANK_AT_STD_DEG, 6);
  });
  it("pegs at twice standard rate", () => {
    const fast = turnSymbolBankDeg(degToRad(3 * STANDARD_RATE_DEG_S))!;
    expect(fast.deg).toBeCloseTo(TC_MAX_SYMBOL_BANK_DEG, 6);
    expect(fast.pegged).toBe(true);
  });
  it("is wings level at zero rate of turn", () => {
    expect(turnSymbolBankDeg(0)!.deg).toBeCloseTo(0, 6);
  });
  it("returns null when the rate of turn is unknown", () => {
    expect(turnSymbolBankDeg(null)).toBeNull();
  });
});

describe("slip ball", () => {
  it("is centred in coordinated flight", () => {
    expect(slipBallOffsetPx(0)!.px).toBeCloseTo(0, 6);
  });
  it("runs to the edge of its race at full-scale sideslip and pegs beyond", () => {
    const full = slipBallOffsetPx(degToRad(SLIP_FULL_SCALE_BETA_DEG))!;
    expect(full.px).toBeCloseTo(SLIP_BALL_SIGN * SLIP_BALL_TRAVEL_PX, 6);
    expect(full.pegged).toBe(false);
    const past = slipBallOffsetPx(degToRad(3 * SLIP_FULL_SCALE_BETA_DEG))!;
    expect(Math.abs(past.px)).toBeCloseTo(SLIP_BALL_TRAVEL_PX, 6);
    expect(past.pegged).toBe(true);
  });
  it("returns null when sideslip is unknown", () => {
    expect(slipBallOffsetPx(null)).toBeNull();
  });
});
