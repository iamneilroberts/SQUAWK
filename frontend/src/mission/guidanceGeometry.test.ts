import { describe, expect, it } from "vitest";
import { missionProfileForClass } from "./profiles";
import { approachGuidance, approachSurface, runwayOutline, surfaceQuads } from "./guidanceGeometry";
import { greatCircleDistanceNm } from "./geo";
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
