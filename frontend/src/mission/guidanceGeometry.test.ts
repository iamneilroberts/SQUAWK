import { describe, expect, it } from "vitest";
import { missionProfileForClass } from "./profiles";
import { approachGuidance, runwayOutline } from "./guidanceGeometry";
import type { RunwayAssignment } from "./types";

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
