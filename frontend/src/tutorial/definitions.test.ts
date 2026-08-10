import { describe, expect, it } from "vitest";

import { greatCircleDistanceNm, headingDeltaDeg } from "../mission/geo";
import { msToKt } from "../sim/units";
import { TUTORIAL_DEFINITIONS, buildTutorialMission } from "./definitions";

describe("tutorial definitions", () => {
  it("pins one deterministic, unranked approach to each supported aircraft class", () => {
    expect(TUTORIAL_DEFINITIONS.map((definition) => definition.classId)).toEqual([
      "c172s",
      "b738",
      "f5e",
    ]);
    for (const definition of TUTORIAL_DEFINITIONS) {
      expect(definition.unranked).toBe(true);
      expect(definition.lessons.length).toBeGreaterThanOrEqual(3);
      expect(definition.assignment.runwaySurface).toBe("HARD");
      expect(definition.assignment.runwayLighted).toBe(true);
    }
  });

  it("uses Keesler AFB runway 04 as the fighter default", () => {
    const fighter = TUTORIAL_DEFINITIONS.find((definition) => definition.classId === "f5e");
    expect(fighter?.assignment).toMatchObject({
      airportIdent: "KBIX",
      airportName: "Keesler AFB",
      runwayId: "241583",
      runwayEndIdent: "04",
      runwayLengthFt: 7_630,
      runwayWidthFt: 150,
    });
  });

  it("builds the same stable on-slope mission without any live-feed provenance", () => {
    for (const definition of TUTORIAL_DEFINITIONS) {
      const first = buildTutorialMission(definition.classId, 1_700_000_000_000);
      const second = buildTutorialMission(definition.classId, 1_700_000_000_000);
      expect(first).toEqual(second);
      expect(first.traffic).toMatchObject({ source: null, sourceTime: null, fetchedAt: null });
      expect(first.contact.baro_rate).toBeLessThan(0);
      expect(first.reconstruction.controls.flapDetent).toBe(first.aircraftProfile.flaps.length - 1);
      expect(first.reconstruction.controls.gearDown).toBe(true);
      expect(msToKt(first.reconstruction.state.iasMs)).toBeLessThanOrEqual(
        first.missionProfile.landing.maxTouchdownSpeedKt,
      );
      expect(headingDeltaDeg(first.contact.track ?? 0, first.assignment.runwayHeadingDeg)).toBe(0);
      expect(greatCircleDistanceNm(
        first.contact.lat,
        first.contact.lon,
        first.assignment.assignedEnd.latDeg,
        first.assignment.assignedEnd.lonDeg,
      )).toBeCloseTo(definition.startDistanceNm, 2);
    }
  });
});
