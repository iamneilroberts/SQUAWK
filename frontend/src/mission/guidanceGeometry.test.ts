import { describe, expect, it } from "vitest";
import { missionProfileForClass } from "./profiles";
import {
  approachGuidance,
  approachRibbon,
  approachSurface,
  directorDistanceNm,
  DIRECTOR_LEAD_NM,
  finalApproachFix,
  glidepathToleranceFt,
  glideSlopeAltitudeFt,
  positionAlongApproach,
  runwayOutline,
  surfaceQuads,
} from "./guidanceGeometry";
import { destinationPoint, greatCircleDistanceNm } from "./geo";
import { projectToRunwayFrame } from "./runwayGeometry";
import type { RunwayAssignment } from "./types";

const FEET_PER_NM = 6076.11549;

const assignment = {
  airportElevationFt: 100,
  runwayHeadingDeg: 90,
  runwayLengthFt: 6000,
  runwayWidthFt: 100,
  assignedEnd: {
    ident: "09",
    latDeg: 30,
    lonDeg: -88,
    elevationFt: 110,
    headingDeg: 90,
    displacedThresholdFt: 0,
  },
} as RunwayAssignment;

const surfaceAssignment: RunwayAssignment = {
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

const surfaceGuidance = missionProfileForClass("c172s").guidance;

function widthFt(section: { left: { latDeg: number; lonDeg: number }; right: { latDeg: number; lonDeg: number } }): number {
  return greatCircleDistanceNm(
    section.left.latDeg, section.left.lonDeg,
    section.right.latDeg, section.right.lonDeg,
  ) * FEET_PER_NM;
}

describe("profile-driven guidance geometry", () => {
  it("closes the physical assigned-runway outline", () => {
    const outline = runwayOutline(assignment);
    expect(outline).toHaveLength(5);
    expect(outline[0]).toEqual(outline[4]);
    expect(outline.every((point) => Number.isFinite(point.latDeg) && Number.isFinite(point.lonDeg))).toBe(true);
  });

  it.each(["c172s", "b738", "f5e"] as const)(
    "builds %s corridor, glide gates, and flare entirely from its mission profile",
    (classId) => {
      const profile = missionProfileForClass(classId);
      const result = approachGuidance(assignment, profile.guidance);
      expect(result.corridorEdges).toHaveLength(2);
      expect(result.gates).toHaveLength(
        Math.floor(profile.guidance.approachLengthNm / profile.guidance.gateSpacingNm),
      );
      expect(result.flare.altitudeFt).toBeCloseTo(110 + profile.guidance.flareHeightFt, 6);
    },
  );
});

describe("glideSlopeAltitudeFt", () => {
  const guidance = missionProfileForClass("c172s").guidance; // 3° slope

  it("returns the runway threshold elevation at the threshold (distance 0)", () => {
    expect(glideSlopeAltitudeFt(assignment, guidance, 0)).toBeCloseTo(110, 6);
  });

  it("rides the glide slope one nautical mile out", () => {
    const expected = 110 + Math.tan((3 * Math.PI) / 180) * 1 * FEET_PER_NM;
    expect(glideSlopeAltitudeFt(assignment, guidance, 1)).toBeCloseTo(expected, 6);
  });
});

describe("positionAlongApproach", () => {
  const guidance = missionProfileForClass("c172s").guidance; // 3° slope

  it("returns the threshold centerline point at distance 0, on the runway heading", () => {
    const { point, approachHeadingDeg } = positionAlongApproach(assignment, guidance, 0);
    expect(point.latDeg).toBeCloseTo(30, 6);
    expect(point.lonDeg).toBeCloseTo(-88, 6);
    expect(point.altitudeFt).toBeCloseTo(110, 6);
    expect(approachHeadingDeg).toBe(90);
  });

  it("rides the shared glide slope on the centerline, outbound on the approach side", () => {
    const { point } = positionAlongApproach(assignment, guidance, 1);
    // altitude continuity with the gates + flyable surface
    expect(point.altitudeFt).toBeCloseTo(glideSlopeAltitudeFt(assignment, guidance, 1), 6);
    // exactly on the centerline (no cross-track), 1 nm back on the approach side (negative along-track)
    const frame = projectToRunwayFrame(assignment, point);
    expect(frame.crossTrackFt).toBeCloseTo(0, 3);
    expect(frame.alongTrackFt).toBeCloseTo(-1 * FEET_PER_NM, 0);
  });
});

describe("finalApproachFix", () => {
  const baseGuidance = missionProfileForClass("c172s").guidance; // 3° slope

  it("sits on the centerline at finalApproachFixNm, on-slope", () => {
    const guidance = { ...baseGuidance, finalApproachFixNm: 5.5, approachLengthNm: 5, glideSlopeDeg: 3 };
    const faf = finalApproachFix(assignment, guidance);
    expect(faf.headingDeg).toBeCloseTo(assignment.runwayHeadingDeg, 6);
    expect(faf.altitudeFt).toBeCloseTo(glideSlopeAltitudeFt(assignment, guidance, 5.5), 6);
    // point matches positionAlongApproach at the same distance
    const ref = positionAlongApproach(assignment, guidance, 5.5).point;
    expect(faf.point.latDeg).toBeCloseTo(ref.latDeg, 9);
    expect(faf.point.lonDeg).toBeCloseTo(ref.lonDeg, 9);
  });
});

describe("directorDistanceNm", () => {
  it("leads own-ship toward the threshold by the default lead distance", () => {
    expect(directorDistanceNm(5, 8)).toBeCloseTo(5 - DIRECTOR_LEAD_NM, 6);
  });

  it("parks at the threshold (0) once own-ship is within the lead distance", () => {
    expect(directorDistanceNm(0.3, 8)).toBe(0);
    expect(directorDistanceNm(0, 8)).toBe(0);
  });

  it("clamps to the approach length far out", () => {
    expect(directorDistanceNm(20, 8)).toBe(8);
  });

  it("honors a custom lead distance", () => {
    expect(directorDistanceNm(5, 8, 1.5)).toBeCloseTo(3.5, 6);
  });
});

describe("glidepathToleranceFt", () => {
  const guidance = missionProfileForClass("c172s").guidance; // 3° slope

  it("holds a 120 ft floor close to the threshold", () => {
    // glide height at 1 nm (~318 ft) × 0.18 ≈ 57 ft, below the floor.
    expect(glidepathToleranceFt(guidance, 1)).toBeCloseTo(120, 6);
  });

  it("widens to 18% of glide height far out", () => {
    const glideHeight = Math.tan((3 * Math.PI) / 180) * 5 * FEET_PER_NM;
    expect(glidepathToleranceFt(guidance, 5)).toBeCloseTo(glideHeight * 0.18, 6);
  });
});

describe("approachSurface", () => {
  it("tapers linearly from runway width at the threshold to corridor width at the far end", () => {
    const sections = approachSurface(surfaceAssignment, surfaceGuidance);
    expect(widthFt(sections[0])).toBeCloseTo(surfaceAssignment.runwayWidthFt, 0);
    expect(widthFt(sections[sections.length - 1])).toBeCloseTo(surfaceGuidance.corridorWidthFt, 0);
    const midDistanceNm = surfaceGuidance.approachLengthNm / 2;
    const expectedMidFt =
      surfaceAssignment.runwayWidthFt +
      (surfaceGuidance.corridorWidthFt - surfaceAssignment.runwayWidthFt) * 0.5;
    // find the section closest to the midpoint and check interpolation there
    const spacingCount = Math.round(midDistanceNm / surfaceGuidance.gateSpacingNm);
    const mid = sections[spacingCount];
    const midT = (spacingCount * surfaceGuidance.gateSpacingNm) / surfaceGuidance.approachLengthNm;
    const expectedAtMidSection =
      surfaceAssignment.runwayWidthFt +
      (surfaceGuidance.corridorWidthFt - surfaceAssignment.runwayWidthFt) * midT;
    expect(widthFt(mid)).toBeCloseTo(expectedAtMidSection, 0);
    expect(expectedMidFt).toBeGreaterThan(surfaceAssignment.runwayWidthFt); // sanity: taper is real
  });

  it("falls back to constant corridor width when the runway width is missing (0)", () => {
    const noWidth = { ...surfaceAssignment, runwayWidthFt: 0 };
    const sections = approachSurface(noWidth, surfaceGuidance);
    expect(widthFt(sections[0])).toBeCloseTo(surfaceGuidance.corridorWidthFt, 0);
    expect(widthFt(sections[sections.length - 1])).toBeCloseTo(surfaceGuidance.corridorWidthFt, 0);
  });

  it("lies exactly on the glide slope the gates mark (altitude continuity)", () => {
    const sections = approachSurface(surfaceAssignment, surfaceGuidance);
    const slope = Math.tan((surfaceGuidance.glideSlopeDeg * Math.PI) / 180);
    sections.forEach((section, i) => {
      const distanceNm = Math.min(i * surfaceGuidance.gateSpacingNm, surfaceGuidance.approachLengthNm);
      const expected = 100 + slope * distanceNm * FEET_PER_NM;
      expect(section.left.altitudeFt).toBeCloseTo(expected, 6);
      expect(section.right.altitudeFt).toBeCloseTo(expected, 6);
    });
    // gates from the existing guidance ride ON the surface by construction
    const { gates } = approachGuidance(surfaceAssignment, surfaceGuidance);
    const gateAltitudes = gates.map((gate) => gate.left.altitudeFt);
    const sectionAltitudes = sections.map((section) => section.left.altitudeFt);
    for (const alt of gateAltitudes) {
      expect(sectionAltitudes.some((sectionAlt) => Math.abs(sectionAlt - alt) < 1e-6)).toBe(true);
    }
  });

  it("handles a legitimately negative runway elevation", () => {
    const belowSea = {
      ...surfaceAssignment,
      assignedEnd: { ...surfaceAssignment.assignedEnd, elevationFt: -14 },
    };
    const sections = approachSurface(belowSea, surfaceGuidance);
    expect(sections[0].left.altitudeFt).toBeCloseTo(-14, 6);
  });

  it("always includes the far edge at exactly approachLengthNm", () => {
    const odd = { ...surfaceGuidance, approachLengthNm: surfaceGuidance.gateSpacingNm * 3.5 };
    const sections = approachSurface(surfaceAssignment, odd);
    const slope = Math.tan((odd.glideSlopeDeg * Math.PI) / 180);
    const last = sections[sections.length - 1];
    expect(last.left.altitudeFt).toBeCloseTo(100 + slope * odd.approachLengthNm * FEET_PER_NM, 6);
  });
});

describe("approachRibbon", () => {
  // Fixed, world-anchored 3-point path: base-leg entry -> FAF -> threshold. Unlike
  // approachSurface (threshold..approachLengthNm), the ribbon runs the full
  // threshold..finalApproachFixNm..(FAF+baseLegOffsetNm) length so it reaches the base-leg
  // spawn point (spawnPlacement.baseLegPlacement uses the same FAF + baseLegOffset geometry).
  const guidance = surfaceGuidance; // c172s: finalApproachFixNm 5.5, baseLegOffsetNm 3, baseLegOffsetDeg 45

  it("tapers from corridorWidthFt at the far (base-entry) end to the runway width at the threshold", () => {
    const sections = approachRibbon(surfaceAssignment, guidance);
    expect(widthFt(sections[0])).toBeCloseTo(surfaceAssignment.runwayWidthFt, 0);
    expect(widthFt(sections[sections.length - 1])).toBeCloseTo(guidance.corridorWidthFt, 0);
  });

  it("falls back to constant corridor width at the threshold when runway width is missing (0)", () => {
    const noWidth = { ...surfaceAssignment, runwayWidthFt: 0 };
    const sections = approachRibbon(noWidth, guidance);
    expect(widthFt(sections[0])).toBeCloseTo(guidance.corridorWidthFt, 0);
  });

  it("passes through the FAF point, where the path bends (the dogleg)", () => {
    const sections = approachRibbon(surfaceAssignment, guidance);
    const faf = finalApproachFix(surfaceAssignment, guidance);
    const midpoints = sections.map((section) => ({
      latDeg: (section.left.latDeg + section.right.latDeg) / 2,
      lonDeg: (section.left.lonDeg + section.right.lonDeg) / 2,
      altitudeFt: (section.left.altitudeFt + section.right.altitudeFt) / 2,
    }));
    const atFaf = midpoints.some(
      (mid) =>
        greatCircleDistanceNm(mid.latDeg, mid.lonDeg, faf.point.latDeg, faf.point.lonDeg) < 1e-6 &&
        Math.abs(mid.altitudeFt - faf.altitudeFt) < 1e-6,
    );
    expect(atFaf).toBe(true);
  });

  it("rides the glide slope from the threshold to the FAF", () => {
    const sections = approachRibbon(surfaceAssignment, guidance);
    const faf = finalApproachFix(surfaceAssignment, guidance);
    for (const section of sections) {
      const mid = {
        latDeg: (section.left.latDeg + section.right.latDeg) / 2,
        lonDeg: (section.left.lonDeg + section.right.lonDeg) / 2,
      };
      const distanceNm = greatCircleDistanceNm(
        surfaceAssignment.assignedEnd.latDeg, surfaceAssignment.assignedEnd.lonDeg,
        mid.latDeg, mid.lonDeg,
      );
      if (distanceNm > guidance.finalApproachFixNm + 1e-6) continue; // base-leg segment: see next test
      const expected = glideSlopeAltitudeFt(surfaceAssignment, guidance, distanceNm);
      expect(section.left.altitudeFt).toBeCloseTo(expected, 0);
      expect(section.right.altitudeFt).toBeCloseTo(expected, 0);
    }
    // sanity: the FAF altitude itself is the boundary value between the two segments
    expect(faf.altitudeFt).toBeCloseTo(
      glideSlopeAltitudeFt(surfaceAssignment, guidance, guidance.finalApproachFixNm),
      6,
    );
  });

  it("flies level at FAF altitude on the base leg (matches spawnPlacement.baseLegPlacement)", () => {
    const sections = approachRibbon(surfaceAssignment, guidance);
    const faf = finalApproachFix(surfaceAssignment, guidance);
    const last = sections[sections.length - 1];
    // The far end is the base-leg entry: level with the FAF, not descending further.
    expect(last.left.altitudeFt).toBeCloseTo(faf.altitudeFt, 0);
    expect(last.right.altitudeFt).toBeCloseTo(faf.altitudeFt, 0);
  });

  it("reaches the base-leg entry point spawnPlacement uses (fixed, world-anchored — no live-position input)", () => {
    const sections = approachRibbon(surfaceAssignment, guidance);
    const faf = finalApproachFix(surfaceAssignment, guidance);
    const outbound = faf.headingDeg + 180;
    const expectedEntry = destinationPoint(
      faf.point.latDeg, faf.point.lonDeg,
      outbound + guidance.baseLegOffsetDeg,
      guidance.baseLegOffsetNm,
    );
    const last = sections[sections.length - 1];
    const midLat = (last.left.latDeg + last.right.latDeg) / 2;
    const midLon = (last.left.lonDeg + last.right.lonDeg) / 2;
    expect(greatCircleDistanceNm(midLat, midLon, expectedEntry.latDeg, expectedEntry.lonDeg)).toBeLessThan(1e-6);
  });

  it("produces enough continuous samples for a smooth bend at the FAF", () => {
    const sections = approachRibbon(surfaceAssignment, guidance);
    // At least one sample per gate spacing across the full (threshold + base-leg) length.
    const totalLengthNm = guidance.finalApproachFixNm + guidance.baseLegOffsetNm;
    expect(sections.length).toBeGreaterThanOrEqual(Math.floor(totalLengthNm / guidance.gateSpacingNm));
    for (const section of sections) {
      expect(Number.isFinite(section.left.latDeg)).toBe(true);
      expect(Number.isFinite(section.left.altitudeFt)).toBe(true);
      expect(Number.isFinite(section.right.latDeg)).toBe(true);
      expect(Number.isFinite(section.right.altitudeFt)).toBe(true);
    }
    const quads = surfaceQuads(sections);
    expect(quads).toHaveLength(sections.length - 1);
  });
});

describe("surfaceQuads", () => {
  it("builds one 4-corner ring per consecutive section pair, wound near-left → far-left → far-right → near-right", () => {
    const sections = approachSurface(surfaceAssignment, surfaceGuidance);
    const quads = surfaceQuads(sections);
    expect(quads).toHaveLength(sections.length - 1);
    expect(quads[0]).toEqual([
      sections[0].left, sections[1].left, sections[1].right, sections[0].right,
    ]);
    for (const quad of quads) expect(quad).toHaveLength(4);
  });
});
