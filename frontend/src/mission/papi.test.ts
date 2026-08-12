import { describe, expect, it } from "vitest";
import { papiColors, papiLightPositions, papiPosition } from "./papi";
import { destinationPoint, greatCircleDistanceNm, initialBearingDeg } from "./geo";
import type { RunwayAssignment } from "./types";

const FEET_PER_NM = 6076.11549;

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

describe("papiPosition", () => {
  it("sits abeam the threshold on the left, half runway width + 50 ft out, at runway elevation", () => {
    const papi = papiPosition(assignment);
    const offsetFt =
      greatCircleDistanceNm(0, 0, papi.latDeg, papi.lonDeg) * FEET_PER_NM;
    expect(offsetFt).toBeCloseTo(assignment.runwayWidthFt / 2 + 50, 0);
    // runway heading 0 → left side is bearing 270 (west of the threshold)
    expect(initialBearingDeg(0, 0, papi.latDeg, papi.lonDeg)).toBeCloseTo(270, 0);
    expect(papi.altitudeFt).toBe(100);
  });

  it("uses airportElevationFt when the assigned end has no elevation", () => {
    const noEndElevation = {
      ...assignment,
      assignedEnd: { ...assignment.assignedEnd, elevationFt: null },
    };
    expect(papiPosition(noEndElevation).altitudeFt).toBe(100);
  });
});

describe("papiLightPositions", () => {
  it("returns four lights spread 25 ft apart extending further left, all at runway elevation", () => {
    const lights = papiLightPositions(assignment);
    expect(lights).toHaveLength(4);
    const base = papiPosition(assignment);
    lights.forEach((light, i) => {
      const spreadFt =
        greatCircleDistanceNm(base.latDeg, base.lonDeg, light.latDeg, light.lonDeg) * FEET_PER_NM;
      expect(spreadFt).toBeCloseTo(i * 25, 0);
      expect(light.altitudeFt).toBe(100);
    });
  });
});

describe("papiColors", () => {
  const papi = papiPosition(assignment);
  const GLIDE = 3;

  /** Aircraft on the approach side (runway 01 → approach from the south, bearing 180). */
  function aircraftAtAngle(angleDeg: number, distanceNm = 3) {
    const { latDeg, lonDeg } = destinationPoint(papi.latDeg, papi.lonDeg, 180, distanceNm);
    const altitudeFt =
      papi.altitudeFt + Math.tan((angleDeg * Math.PI) / 180) * distanceNm * FEET_PER_NM;
    return { latDeg, lonDeg, altitudeFt };
  }

  it.each([
    [3 - 0.6, [false, false, false, false]], // 2.4° — four red, well low
    [3 - 0.3, [true, false, false, false]],  // 2.7° — slightly low
    [3 - 0.1, [true, true, false, false]],   // 2.9° — on slope (2W2R)
    [3 + 0.1, [true, true, false, false]],   // 3.1° — on slope (2W2R)
    [3 + 0.3, [true, true, true, false]],    // 3.3° — slightly high
    [3 + 0.6, [true, true, true, true]],     // 3.6° — four white, well high
  ])("elevation angle %f° → %j", (angleDeg, expected) => {
    expect(papiColors(aircraftAtAngle(angleDeg), papi, GLIDE)).toEqual(expected);
  });

  it("works at a negative-elevation runway (legitimate)", () => {
    const below = { ...papi, altitudeFt: -14 };
    const { latDeg, lonDeg } = destinationPoint(below.latDeg, below.lonDeg, 180, 3);
    const altitudeFt = -14 + Math.tan((3 * Math.PI) / 180) * 3 * FEET_PER_NM;
    expect(papiColors({ latDeg, lonDeg, altitudeFt }, below, GLIDE)).toEqual([
      true, true, false, false,
    ]);
  });
});
