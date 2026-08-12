import { describe, expect, it } from "vitest";
import { approachWarningsFor } from "./approachAlerts";
import type { HudSnapshot } from "./snapshot";
import { destinationPoint } from "../mission/geo";
import { missionProfileForClass } from "../mission/profiles";
import type { RunwayAssignment } from "../mission/types";
import { degToRad, ftToM } from "../sim/units";

const assignment: RunwayAssignment = {
  airportIdent: "KTST",
  airportName: "Test Field",
  airportLatDeg: 0,
  airportLonDeg: 0,
  airportElevationFt: 100,
  runwayId: "01/19",
  runwayIdent: "01/19",
  runwayEndIdent: "01",
  runwayHeadingDeg: 0,
  runwayLengthFt: 5000,
  runwayWidthFt: 100,
  runwaySurface: "HARD",
  runwayLighted: true,
  assignedEnd: {
    ident: "01",
    latDeg: 0,
    lonDeg: 0,
    elevationFt: 100,
    headingDeg: 0,
    displacedThresholdFt: 0,
  },
  distanceNm: 8,
  estimatedMinutes: 5,
  suitability: 1,
};

const guidance = missionProfileForClass("c172s").guidance;
const FEET_PER_NM = 6076.11549;

function approachPoint(distanceNm: number, lateralNm = 0): { latDeg: number; lonDeg: number } {
  const center = destinationPoint(0, 0, 180, distanceNm);
  return lateralNm === 0
    ? center
    : destinationPoint(center.latDeg, center.lonDeg, 90, lateralNm);
}

function glidepathAltitudeFt(distanceNm: number): number {
  return 100 + Math.tan(guidance.glideSlopeDeg * Math.PI / 180) * distanceNm * FEET_PER_NM;
}

const snap = (distanceNm: number, o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: 55, tasMs: 60, altitudeM: ftToM(glidepathAltitudeFt(distanceNm)),
  verticalSpeedMs: -2.5, headingRad: degToRad(0),
  pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  ...approachPoint(distanceNm),
  aoaRad: 0, loadFactor: 1,
  throttle: 0.4, trim: 0, flapLabel: "10", gear: "fixed", gearPosition: 1,
  stalled: false, overspeed: false, gLimited: false,
  machNumber: 0, machOverspeed: false, gearOverspeed: false,
  terrainClearanceM: ftToM(800), terrainUnverified: false,
  simRate: 1, airtimeS: 60, classLabel: "C172S", callsign: "SIM-TEST",
  modelNote: "TEST", lightPhase: "day",
  ...o,
});

describe("approachWarningsFor", () => {
  it("stays silent outside the configured approach and when guidance is off", () => {
    expect(approachWarningsFor(snap(6), assignment, guidance, "FULL")).toEqual([]);
    expect(approachWarningsFor(snap(2), assignment, guidance, "OFF")).toEqual([]);
  });

  it("calls NOT LINED UP inside three miles and suppresses competing vertical calls", () => {
    const offset = approachPoint(2, 0.2);
    const highAndOffset = snap(2, {
      ...offset,
      altitudeM: ftToM(glidepathAltitudeFt(2) + 600),
    });
    expect(approachWarningsFor(highAndOffset, assignment, guidance, "FULL"))
      .toEqual(["NOT LINED UP"]);
  });

  it("uses HIGH and LOW only for FULL guidance while roughly established", () => {
    expect(approachWarningsFor(
      snap(2, { altitudeM: ftToM(glidepathAltitudeFt(2) + 500) }),
      assignment,
      guidance,
      "FULL",
    )).toEqual(["HIGH"]);
    expect(approachWarningsFor(
      snap(2, { altitudeM: ftToM(glidepathAltitudeFt(2) - 500) }),
      assignment,
      guidance,
      "FULL",
    )).toEqual(["LOW"]);
    expect(approachWarningsFor(
      snap(2, { altitudeM: ftToM(glidepathAltitudeFt(2) + 500) }),
      assignment,
      guidance,
      "NAV",
    )).toEqual([]);
  });

  it("does not nag while established on the configured glidepath", () => {
    expect(approachWarningsFor(snap(2), assignment, guidance, "FULL")).toEqual([]);
  });

  it("stays silent after crossing the assigned threshold", () => {
    const beyond = destinationPoint(0, 0, 0, 1);
    expect(approachWarningsFor(
      snap(1, { ...beyond }),
      assignment,
      guidance,
      "FULL",
    )).toEqual([]);
  });
});
