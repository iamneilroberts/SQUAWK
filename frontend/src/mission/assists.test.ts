import { describe, expect, it } from "vitest";
import { initialAssistState, selectAssist } from "./assistState";
import {
  assistFeatures,
  assistModeFromPreference,
  missionNavigationCue,
  nextAssistMode,
} from "./assists";

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
