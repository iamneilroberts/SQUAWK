import { describe, expect, it } from "vitest";
import { destinationPoint } from "./geo";
import type { LandingEvidence, LandingEvidenceSample } from "./landingEvidence";
import { checkLandingSafety } from "./landingSafety";
import { missionProfileForClass } from "./profiles";
import type { AircraftClassId, RunwayAssignment } from "./types";

const assignment: RunwayAssignment = {
  airportIdent: "KMOB", airportName: "Mobile", airportLatDeg: 30, airportLonDeg: -88,
  airportElevationFt: 100, runwayId: "1", runwayIdent: "09/27", runwayEndIdent: "09",
  runwayHeadingDeg: 90, runwayLengthFt: 8_000, runwayWidthFt: 200, runwaySurface: "HARD",
  runwayLighted: true,
  assignedEnd: {
    ident: "09", latDeg: 30, lonDeg: -88, elevationFt: 100, headingDeg: 90,
    displacedThresholdFt: 0,
  },
  distanceNm: 10, estimatedMinutes: 5, suitability: 1,
};

function point(alongFt: number, crossFt = 0) {
  const center = destinationPoint(30, -88, 90, alongFt / 6076.11549);
  return destinationPoint(center.latDeg, center.lonDeg, 180, crossFt / 6076.11549);
}

function sample(classId: AircraftClassId, overrides: Partial<LandingEvidenceSample> = {}): LandingEvidenceSample {
  const profile = missionProfileForClass(classId);
  const location = point(600);
  return {
    timeMs: 100,
    latDeg: location.latDeg,
    lonDeg: location.lonDeg,
    altitudeFt: 100,
    iasKt: (profile.landing.minTouchdownSpeedKt + profile.landing.maxTouchdownSpeedKt) / 2,
    sinkRateFpm: 100,
    headingDeg: 90,
    pitchDeg: 3,
    bankDeg: 0,
    loadFactor: 1,
    gearPosition: 1,
    surfaceContact: true,
    ...overrides,
  };
}

function evidence(classId: AircraftClassId, final: Partial<LandingEvidenceSample> = {}, first: Partial<LandingEvidenceSample> = {}): LandingEvidence {
  return {
    schemaVersion: 1,
    sampleIntervalMs: 100,
    samples: [
      { ...sample(classId, { timeMs: 0, surfaceContact: false }), ...first },
      sample(classId, final),
    ],
  };
}

describe.each(["c172s", "b738", "f5e"] as const)("%s landing hard gates", (classId) => {
  const profile = missionProfileForClass(classId);

  it("passes every exact inclusive profile boundary", () => {
    const result = checkLandingSafety(evidence(classId, {
      sinkRateFpm: profile.landing.maxSinkRateFpm,
      bankDeg: profile.landing.maxAbsBankDeg,
      pitchDeg: profile.landing.maxPitchDeg,
      iasKt: profile.landing.maxTouchdownSpeedKt,
      loadFactor: profile.landing.maxLoadFactor,
    }), assignment, profile);
    expect(result).toMatchObject({ passed: true, failure: null });
  });

  it("passes exact lower pitch/speed and gear boundaries, then fails one step beyond", () => {
    expect(checkLandingSafety(evidence(classId, {
      pitchDeg: profile.landing.minPitchDeg,
      iasKt: profile.landing.minTouchdownSpeedKt,
      gearPosition: 0.95,
    }), assignment, profile)).toMatchObject({ passed: true });
    expect(checkLandingSafety(evidence(classId, {
      pitchDeg: profile.landing.minPitchDeg - 0.01,
    }), assignment, profile)).toMatchObject({ passed: false, failure: "ATTITUDE_EXCEEDED" });
    expect(checkLandingSafety(evidence(classId, {
      iasKt: profile.landing.minTouchdownSpeedKt - 0.01,
    }), assignment, profile)).toMatchObject({ passed: false, failure: "SPEED_OUT_OF_RANGE" });
    expect(checkLandingSafety(evidence(classId, {
      gearPosition: 0.949,
    }), assignment, profile)).toMatchObject({ passed: false, failure: "GEAR_NOT_DOWN" });
  });

  it.each([
    ["SINK_RATE_EXCEEDED", { sinkRateFpm: profile.landing.maxSinkRateFpm + 0.01 }],
    ["BANK_EXCEEDED", { bankDeg: profile.landing.maxAbsBankDeg + 0.01 }],
    ["ATTITUDE_EXCEEDED", { pitchDeg: profile.landing.maxPitchDeg + 0.01 }],
    ["SPEED_OUT_OF_RANGE", { iasKt: profile.landing.maxTouchdownSpeedKt + 0.01 }],
  ] as const)("returns stable %s without a score", (failure, final) => {
    expect(checkLandingSafety(evidence(classId, final), assignment, profile)).toMatchObject({
      passed: false,
      failure,
    });
  });

  it("rejects a structural exceedance anywhere in the retained window", () => {
    expect(checkLandingSafety(evidence(classId, {}, {
      loadFactor: profile.landing.maxLoadFactor + 0.01,
    }), assignment, profile)).toMatchObject({
      passed: false,
      failure: "STRUCTURAL_LOAD_EXCEEDED",
    });
  });

  it("pins the controlled-path cross-track boundary", () => {
    const exact = point(550, profile.landing.maxRolloutCrossTrackFt);
    const beyond = point(550, profile.landing.maxRolloutCrossTrackFt + 0.01);
    expect(checkLandingSafety(evidence(classId, {}, {
      latDeg: exact.latDeg, lonDeg: exact.lonDeg, altitudeFt: 101,
    }), assignment, profile)).toMatchObject({ passed: true });
    expect(checkLandingSafety(evidence(classId, {}, {
      latDeg: beyond.latDeg, lonDeg: beyond.lonDeg, altitudeFt: 101,
    }), assignment, profile)).toMatchObject({ passed: false, failure: "ROLLOUT_UNCONTROLLED" });
  });
});

describe("assigned surface, direction, gear, and controlled path gates", () => {
  const profile = missionProfileForClass("c172s");

  it("names each non-profile landing failure precisely", () => {
    const outside = point(600, 101);
    expect(checkLandingSafety(evidence("c172s", {
      latDeg: outside.latDeg, lonDeg: outside.lonDeg,
    }), assignment, profile)?.failure).toBe("OUTSIDE_ASSIGNED_SURFACE");
    expect(checkLandingSafety(evidence("c172s", { headingDeg: 180.01 }), assignment, profile)?.failure)
      .toBe("WRONG_LANDING_DIRECTION");
    expect(checkLandingSafety(evidence("c172s", { gearPosition: 0.949 }), assignment, profile)?.failure)
      .toBe("GEAR_NOT_DOWN");
    const wandering = point(550, profile.landing.maxRolloutCrossTrackFt + 0.01);
    expect(checkLandingSafety(evidence("c172s", {}, {
      latDeg: wandering.latDeg, lonDeg: wandering.lonDeg, altitudeFt: 101,
    }), assignment, profile)?.failure).toBe("ROLLOUT_UNCONTROLLED");
  });
});
