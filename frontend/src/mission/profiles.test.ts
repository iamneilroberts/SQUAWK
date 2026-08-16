import { describe, expect, it } from "vitest";
import { allMissionProfiles, missionProfileForClass, validateMissionProfile } from "./profiles";

describe("versioned mission profiles", () => {
  it("defines one data-only profile for every launch class", () => {
    expect(allMissionProfiles().map((profile) => profile.classId)).toEqual(["c172s", "b738", "f5e", "biz", "tprop", "r44", "t6", "c130"]);
    for (const profile of allMissionProfiles()) {
      expect(profile.reachability.maxMinutes).toBe(30);
      expect(profile.profileVersion).toMatch(/^mission-/);
      expect(profile.assignmentVersion).toBe("assignment-2026-08-10-v1");
      expect(profile.scoringVersion).toBe("scoring-2026-08-10-v1");
      expect(profile.runway.surfaces.length).toBeGreaterThan(0);
      expect(Object.keys(profile.scoreCurves)).toHaveLength(7);
    }
  });

  it("retains small-airport eligibility for GA", () => {
    expect(missionProfileForClass("c172s").runway.airportSizes).toContain("small");
  });

  it("freezes loaded definitions so one caller cannot change later assignments", () => {
    expect(Object.isFrozen(missionProfileForClass("c172s"))).toBe(true);
    expect(Object.isFrozen(missionProfileForClass("c172s").runway.surfaces)).toBe(true);
  });

  it("rejects an over-30-minute profile instead of weakening the product cap", () => {
    const invalid = structuredClone(missionProfileForClass("c172s"));
    invalid.reachability.maxMinutes = 31;
    expect(() => validateMissionProfile(invalid)).toThrow(/product cap/);
  });

  it("publishes a per-class approach speed band with a positive floor", () => {
    for (const profile of allMissionProfiles()) {
      expect(profile.approach.targetSpeedKt).toBeGreaterThan(0);
      expect(profile.approach.bandKt).toBeGreaterThan(0);
      // lo = target - band must stay above zero so the HUD never shows a negative speed.
      expect(profile.approach.targetSpeedKt - profile.approach.bandKt).toBeGreaterThan(0);
    }
  });

  it("rejects an approach band wider than its target speed", () => {
    const invalid = structuredClone(missionProfileForClass("c172s"));
    invalid.approach.bandKt = invalid.approach.targetSpeedKt + 1;
    expect(() => validateMissionProfile(invalid)).toThrow(/approach/);
  });
});
