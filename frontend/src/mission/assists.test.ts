import { describe, expect, it } from "vitest";
import { initialAssistState, selectAssist } from "./assistState";
import {
  assistFeatures,
  assistModeFromPreference,
  finalTurnCue,
  missionNavigationCue,
  nextAssistMode,
} from "./assists";
import { finalApproachFix } from "./guidanceGeometry";
import { initialBearingDeg } from "./geo";
import { missionProfileForClass } from "./profiles";
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

describe("mission assist modes", () => {
  it("maps the legacy profile default into FULL/NAV/OFF without reducing medium accounts", () => {
    expect(assistModeFromPreference("none")).toBe("OFF");
    expect(assistModeFromPreference("low")).toBe("NAV");
    expect(assistModeFromPreference("medium")).toBe("FULL");
    expect(assistModeFromPreference("high")).toBe("FULL");
  });

  it("exposes the approved overlay matrix", () => {
    expect(assistFeatures("FULL")).toEqual({
      destinationCue: true,
      route: true,
      runwayHighlight: true,
      approachCorridor: true,
      glideGates: true,
      flareCue: true,
    });
    expect(assistFeatures("NAV")).toEqual({
      destinationCue: true,
      route: true,
      runwayHighlight: true,
      approachCorridor: false,
      glideGates: false,
      flareCue: false,
    });
    expect(Object.values(assistFeatures("OFF")).some(Boolean)).toBe(false);
  });

  it("records the highest assistance monotonically even after guidance is reduced", () => {
    let state = initialAssistState("OFF");
    state = selectAssist(state, "NAV");
    state = selectAssist(state, "FULL");
    state = selectAssist(state, "OFF");
    expect(state).toEqual({ current: "OFF", highestUsed: "FULL" });
  });

  it("cycles FULL to NAV to OFF and back", () => {
    expect(nextAssistMode("FULL")).toBe("NAV");
    expect(nextAssistMode("NAV")).toBe("OFF");
    expect(nextAssistMode("OFF")).toBe("FULL");
  });

  it("derives the live bearing and distance cue from the assigned threshold", () => {
    const cue = missionNavigationCue(
      { latDeg: 30, lonDeg: -88 },
      { assignedEnd: { latDeg: 30, lonDeg: -87 } } as never,
    );
    expect(cue.bearingDeg).toBeCloseTo(89.75, 1);
    expect(cue.distanceNm).toBeGreaterThan(50);
    expect(cue.distanceNm).toBeLessThan(53);
  });
});

describe("finalTurnCue", () => {
  const profile = missionProfileForClass("c172s");
  // Runway heading is 90 (assignment above) — aligned means tracking ~090.
  const ALIGNED_HEADING = 90;
  const CROSSING_HEADING = 0; // 90° off the runway heading — clearly crossing, not inbound

  it("points to the FAF and carries on-slope alt + approach speed when en route", () => {
    // own well outside the FAF distance, offset to the side of the centerline
    const own = {
      latDeg: assignment.assignedEnd.latDeg + 0.3, lonDeg: assignment.assignedEnd.lonDeg + 0.3,
      headingDeg: ALIGNED_HEADING,
    };
    const cue = finalTurnCue(own, assignment, profile);
    expect(cue).not.toBeNull();
    if (cue) {
      const faf = finalApproachFix(assignment, profile.guidance);
      expect(cue.bearingDeg).toBeCloseTo(initialBearingDeg(own.latDeg, own.lonDeg, faf.point.latDeg, faf.point.lonDeg), 6);
      expect(cue.targetAltFt).toBeCloseTo(faf.altitudeFt, 6);
      expect(cue.targetSpeedKt).toBe(profile.approach.targetSpeedKt);
    }
  });

  it("returns null once inside the FAF distance AND aligned with the runway heading (established)", () => {
    // own very close to the threshold, tracking the runway heading
    const own = {
      latDeg: assignment.assignedEnd.latDeg + 0.001, lonDeg: assignment.assignedEnd.lonDeg + 0.001,
      headingDeg: ALIGNED_HEADING,
    };
    expect(finalTurnCue(own, assignment, profile)).toBeNull();
  });

  it("still cues a turn inside the FAF distance if the aircraft is crossing at an angle", () => {
    // Same near-threshold position as the established case above, but tracking 90° off the
    // runway heading — crossing the corridor from the side, not inbound on it.
    const own = {
      latDeg: assignment.assignedEnd.latDeg + 0.001, lonDeg: assignment.assignedEnd.lonDeg + 0.001,
      headingDeg: CROSSING_HEADING,
    };
    const cue = finalTurnCue(own, assignment, profile);
    expect(cue).not.toBeNull();
  });

  it("treats a small heading error (within tolerance) as still aligned/established", () => {
    const own = {
      latDeg: assignment.assignedEnd.latDeg + 0.001, lonDeg: assignment.assignedEnd.lonDeg + 0.001,
      headingDeg: ALIGNED_HEADING + 15,
    };
    expect(finalTurnCue(own, assignment, profile)).toBeNull();
  });
});
