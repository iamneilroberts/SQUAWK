import { describe, it, expect } from "vitest";
import {
  classificationFromMissionOutcome, classifyEnd, readImpact, MAX_LANDING_SINK_FPM, MAX_LANDING_BANK_DEG,
  LANDING_PITCH_RANGE_DEG, LANDING_SPEED_FACTOR,
} from "./classify";
import type { ImpactReading } from "./classify";
import { loadC172 } from "../sim/params";
import { stallSpeedIasMs } from "../sim/forces";
import { geodeticToEcef } from "../sim/geo";
import { quatFromHpr, qRotate } from "../sim/quat";
import { degToRad, ktToMs } from "../sim/units";
import type { SimState } from "../sim/types";

const P = loadC172();
const VS = stallSpeedIasMs(P, 0);

const reading = (o: Partial<ImpactReading> = {}): ImpactReading => ({
  sinkRateFpm: 200,
  pitchDeg: 2,
  bankDeg: 0,
  iasMs: VS * 1.1,
  stallIasMs: VS,
  ...o,
});

describe("mission landing classification", () => {
  it("maps only a verified mission landing to LANDED", () => {
    expect(classificationFromMissionOutcome("landed")).toBe("LANDED");
    expect(classificationFromMissionOutcome("crashed")).toBe("CRASHED");
    expect(classificationFromMissionOutcome("invalid")).toBe("CRASHED");
  });
});

describe("classifyEnd — a good touchdown", () => {
  it("gentle, level and slow reads LANDED", () => {
    expect(classifyEnd(reading())).toBe("LANDED");
  });
  it("a nose-up flare still reads LANDED", () => {
    expect(classifyEnd(reading({ pitchDeg: 8 }))).toBe("LANDED");
  });
});

describe("classifyEnd — each gate on its own", () => {
  it("too much sink is CRASHED", () => {
    expect(classifyEnd(reading({ sinkRateFpm: 900 }))).toBe("CRASHED");
  });
  it("too much bank is CRASHED", () => {
    expect(classifyEnd(reading({ bankDeg: 35 }))).toBe("CRASHED");
    expect(classifyEnd(reading({ bankDeg: -35 }))).toBe("CRASHED");
  });
  it("nose-down into the ground is CRASHED", () => {
    expect(classifyEnd(reading({ pitchDeg: -20 }))).toBe("CRASHED");
  });
  it("an extreme nose-high arrival is CRASHED", () => {
    expect(classifyEnd(reading({ pitchDeg: 40 }))).toBe("CRASHED");
  });
  it("too fast is CRASHED", () => {
    expect(classifyEnd(reading({ iasMs: VS * 2 }))).toBe("CRASHED");
  });
});

describe("classifyEnd — the thresholds themselves", () => {
  it("pins every constant, so a silent tweak fails here and not in someone's flight", () => {
    expect(MAX_LANDING_SINK_FPM).toBe(600);
    expect(MAX_LANDING_BANK_DEG).toBe(10);
    expect(LANDING_PITCH_RANGE_DEG).toEqual([-5, 15]);
    expect(LANDING_SPEED_FACTOR).toBe(1.3);
  });
});

describe("classifyEnd — exact boundaries", () => {
  it("exactly 600 fpm of sink is CRASHED (the threshold is strictly less than)", () => {
    expect(classifyEnd(reading({ sinkRateFpm: MAX_LANDING_SINK_FPM }))).toBe("CRASHED");
    expect(classifyEnd(reading({ sinkRateFpm: MAX_LANDING_SINK_FPM - 0.001 }))).toBe("LANDED");
  });
  it("exactly 10 deg of bank is still LANDED", () => {
    expect(classifyEnd(reading({ bankDeg: MAX_LANDING_BANK_DEG }))).toBe("LANDED");
    expect(classifyEnd(reading({ bankDeg: MAX_LANDING_BANK_DEG + 0.001 }))).toBe("CRASHED");
  });
  it("exactly 1.3 Vs is CRASHED, a hair under is LANDED", () => {
    expect(classifyEnd(reading({ iasMs: VS * LANDING_SPEED_FACTOR }))).toBe("CRASHED");
    expect(classifyEnd(reading({ iasMs: VS * LANDING_SPEED_FACTOR - 0.001 }))).toBe("LANDED");
  });
  it("the pitch window ends are inclusive", () => {
    const [lo, hi] = LANDING_PITCH_RANGE_DEG;
    expect(classifyEnd(reading({ pitchDeg: lo }))).toBe("LANDED");
    expect(classifyEnd(reading({ pitchDeg: hi }))).toBe("LANDED");
    expect(classifyEnd(reading({ pitchDeg: lo - 0.001 }))).toBe("CRASHED");
    expect(classifyEnd(reading({ pitchDeg: hi + 0.001 }))).toBe("CRASHED");
  });
});

describe("classifyEnd — the stall speed is flap-dependent", () => {
  // Full flap lowers Vs (40 kt vs 48 kt clean, per decisions.md B-010), so a speed that is
  // comfortably slow against the clean Vs can still be too fast for the tighter full-flap
  // margin — never the other way around, since dividing by the smaller flap Vs always
  // yields the larger, stricter ratio.
  it("a speed that is fine clean is too fast for full flap", () => {
    const ias = stallSpeedIasMs(P, 0) * 1.25;
    expect(classifyEnd(reading({ iasMs: ias, stallIasMs: stallSpeedIasMs(P, 0) }))).toBe("LANDED");
    expect(classifyEnd(reading({ iasMs: ias, stallIasMs: stallSpeedIasMs(P, 3) }))).toBe("CRASHED");
  });
});

describe("readImpact", () => {
  function stateWith(pitchDeg: number, bankDeg: number, tasMs: number, sinkMs: number): SimState {
    const position = geodeticToEcef(degToRad(30.7), degToRad(-88), 300);
    const attitude = quatFromHpr(position, 0, degToRad(pitchDeg), degToRad(bankDeg));
    const flightPath = quatFromHpr(position, 0, -Math.asin(sinkMs / tasMs), 0);
    return {
      position,
      velocity: qRotate(flightPath, { x: tasMs, y: 0, z: 0 }),
      attitude,
      rates: { x: 0, y: 0, z: 0 },
      timeS: 10,
      altitudeM: 300, tasMs, iasMs: tasMs, aoaRad: 0, sideslipRad: 0,
      verticalSpeedMs: -sinkMs, loadFactor: 1, gLimited: false, stalled: false, machNumber: 0, gearPosition: 0,
    };
  }
  it("reports sink rate as a positive fpm number when descending", () => {
    const r = readImpact(stateWith(2, 0, ktToMs(60), 2), P, 0);
    expect(r.sinkRateFpm).toBeGreaterThan(300);
    expect(r.sinkRateFpm).toBeLessThan(500);
  });
  it("reports pitch and bank in degrees", () => {
    const r = readImpact(stateWith(6, -12, ktToMs(60), 1), P, 0);
    expect(r.pitchDeg).toBeCloseTo(6, 3);
    expect(r.bankDeg).toBeCloseTo(-12, 3);
  });
  it("uses the stall speed for the flap setting actually selected", () => {
    expect(readImpact(stateWith(2, 0, ktToMs(60), 1), P, 3).stallIasMs)
      .toBeCloseTo(stallSpeedIasMs(P, 3), 9);
  });
  it("classifies a real gentle arrival as LANDED end to end", () => {
    expect(classifyEnd(readImpact(stateWith(4, 1, ktToMs(48), 1.5), P, 3))).toBe("LANDED");
  });
  it("classifies a real dive into terrain as CRASHED end to end", () => {
    expect(classifyEnd(readImpact(stateWith(-30, 40, ktToMs(140), 30), P, 0))).toBe("CRASHED");
  });
});
