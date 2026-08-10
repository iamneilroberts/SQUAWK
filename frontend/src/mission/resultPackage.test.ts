import { describe, expect, it } from "vitest";
import { destinationPoint } from "./geo";
import type { LandingEvidence, LandingEvidenceSample } from "./landingEvidence";
import { inspectLandingEvidence, isLandingEvidence, evaluateLandingEvidence } from "./resultPackage";
import { missionProfileForClass } from "./profiles";
import type { RunwayAssignment } from "./types";

const assignment = {
  airportIdent: "KMOB", airportName: "Mobile", airportLatDeg: 30, airportLonDeg: -88,
  airportElevationFt: 100, runwayId: "1", runwayIdent: "09/27", runwayEndIdent: "09",
  runwayHeadingDeg: 90, runwayLengthFt: 8_000, runwayWidthFt: 200, runwaySurface: "HARD",
  runwayLighted: true,
  assignedEnd: { ident: "09", latDeg: 30, lonDeg: -88, elevationFt: 100, headingDeg: 90, displacedThresholdFt: 0 },
  distanceNm: 10, estimatedMinutes: 5, suitability: 1,
} satisfies RunwayAssignment;

function evidence(overrides: Partial<LandingEvidenceSample> = {}): LandingEvidence {
  const p0 = destinationPoint(30, -88, 90, 500 / 6076.11549);
  const p1 = destinationPoint(30, -88, 90, 510 / 6076.11549);
  const base = {
    altitudeFt: 100, iasKt: 61, sinkRateFpm: 100, headingDeg: 90, pitchDeg: 3,
    bankDeg: 0, loadFactor: 1, gearPosition: 1,
  };
  return {
    schemaVersion: 1,
    sampleIntervalMs: 100,
    samples: [
      { timeMs: 0, latDeg: p0.latDeg, lonDeg: p0.lonDeg, surfaceContact: false, ...base },
      { timeMs: 100, latDeg: p1.latDeg, lonDeg: p1.lonDeg, surfaceContact: true, ...base, ...overrides },
    ],
  };
}

describe("shared mission result evaluation", () => {
  it("produces a browser preview only after every safety gate passes", () => {
    expect(evaluateLandingEvidence(
      evidence(), assignment, missionProfileForClass("c172s"),
    )).toMatchObject({ outcome: "landed", failure: null, score: { total: expect.any(Number) } });
    expect(evaluateLandingEvidence(
      evidence({ sinkRateFpm: 601 }), assignment, missionProfileForClass("c172s"),
    )).toMatchObject({ outcome: "crashed", failure: "SINK_RATE_EXCEEDED", score: null });
  });

  it("distinguishes complete, incomplete, and suspicious evidence", () => {
    expect(inspectLandingEvidence(evidence(), 1_000)).toBe("complete");
    expect(inspectLandingEvidence({ ...evidence(), samples: [evidence().samples[0]] }, 1_000))
      .toBe("incomplete");
    const jumped = evidence();
    jumped.samples[1] = { ...jumped.samples[1], latDeg: 40 };
    expect(inspectLandingEvidence(jumped, 1_000)).toBe("suspicious");
  });

  it("rejects corrupt shapes and extra telemetry fields", () => {
    expect(isLandingEvidence(evidence())).toBe(true);
    expect(isLandingEvidence({ ...evidence(), samples: [{ ...evidence().samples[0], email: "x@y.test" }] }))
      .toBe(false);
    expect(isLandingEvidence({ ...evidence(), samples: [{ ...evidence().samples[0], latDeg: NaN }] }))
      .toBe(false);
  });
});
