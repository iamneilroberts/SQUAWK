import { describe, expect, it } from "vitest";
import {
  buildFreeFlightMission,
  clampFreeFlightAltitudeFt,
  cruiseSpeedKtForClass,
  FREE_FLIGHT_CLASSES,
  FREE_FLIGHT_HOME,
} from "./freeFlight";
import { missionProfileForClass } from "../mission/profiles";
import type { AircraftClassId } from "../mission/types";

const CLASSES: AircraftClassId[] = ["c172s", "b738", "f5e"];

describe("buildFreeFlightMission", () => {
  it("spawns straight-and-level over HOME at the chosen altitude and heading", () => {
    const mission = buildFreeFlightMission("c172s", { altitudeFt: 4_500, headingDeg: 270 });
    expect(mission.contact.lat).toBe(FREE_FLIGHT_HOME.latDeg);
    expect(mission.contact.lon).toBe(FREE_FLIGHT_HOME.lonDeg);
    expect(mission.contact.alt_geom).toBe(4_500);
    expect(mission.contact.track).toBe(270);
    expect(mission.contact.baro_rate).toBe(0);
  });

  it("accepts a caller HOME so the builder stays pure", () => {
    const mission = buildFreeFlightMission("b738", {
      altitudeFt: 18_000,
      headingDeg: 90,
      homeLatDeg: 40,
      homeLonDeg: -80,
    });
    expect(mission.contact.lat).toBe(40);
    expect(mission.contact.lon).toBe(-80);
  });

  it("normalizes the heading into 0..359", () => {
    expect(buildFreeFlightMission("c172s", { altitudeFt: 4_500, headingDeg: 361 }).contact.track).toBe(1);
    expect(buildFreeFlightMission("c172s", { altitudeFt: 4_500, headingDeg: -10 }).contact.track).toBe(350);
  });

  it.each(CLASSES)("maps %s to its params and a sane cruise speed inside the envelope", (classId) => {
    const mission = buildFreeFlightMission(classId, { altitudeFt: FREE_FLIGHT_CLASSES[classId].defaultAltitudeFt, headingDeg: 0 });
    const reach = missionProfileForClass(classId).reachability;
    expect(mission.classId).toBe(classId);
    expect(mission.aircraftProfile.id).toBe(classId);
    expect(mission.contact.gs).toBe(cruiseSpeedKtForClass(classId));
    // Cruise is a real planning speed for the class — never below stall, never over Vne.
    expect(mission.contact.gs).toBeGreaterThanOrEqual(reach.minPlanningSpeedKt);
    expect(mission.contact.gs).toBeLessThanOrEqual(reach.maxPlanningSpeedKt);
    // The spawn builder made no SPEED adjustment: the aircraft is not spawning stalled or overspeed.
    expect(mission.reconstruction.adjustments.some((a) => a.field === "SPEED")).toBe(false);
  });

  it("is always a locked, SIM, unranked, feed-free mission", () => {
    const mission = buildFreeFlightMission("f5e", { altitudeFt: 20_000, headingDeg: 45 });
    expect(mission.status).toBe("locked");
    expect(mission.assist).toBe("none");
    expect(mission.traffic.source).toBeNull();
    expect(mission.traffic.cacheStatus).toBe("MISS");
    expect(mission.receipt.startsWith("freeflight:")).toBe(true);
    // Fighter is military; the SIM callsign is derived from the synthetic hex downstream.
    expect(mission.contact.military).toBe(true);
    expect(mission.contact.hex).toBe(FREE_FLIGHT_CLASSES.f5e.hex);
  });

  it("uses a caller-supplied mission id when given (browser crypto), else a stable id", () => {
    const custom = buildFreeFlightMission("c172s", { altitudeFt: 4_500, headingDeg: 0, missionId: "custom-id" });
    expect(custom.missionId).toBe("custom-id");
    const stable = buildFreeFlightMission("c172s", { altitudeFt: 4_500, headingDeg: 0 });
    expect(stable.missionId).toMatch(/^[0-9a-f-]+$/);
  });

  it("has an inert self-referential destination at the spawn point", () => {
    const mission = buildFreeFlightMission("c172s", { altitudeFt: 4_500, headingDeg: 200 });
    expect(mission.assignment.assignedEnd.latDeg).toBe(mission.contact.lat);
    expect(mission.assignment.assignedEnd.lonDeg).toBe(mission.contact.lon);
    expect(mission.assignment.distanceNm).toBe(0);
  });
});

describe("clampFreeFlightAltitudeFt", () => {
  it("clamps to the per-class bounds and rounds", () => {
    expect(clampFreeFlightAltitudeFt("c172s", 100)).toBe(FREE_FLIGHT_CLASSES.c172s.minAltitudeFt);
    expect(clampFreeFlightAltitudeFt("c172s", 999_999)).toBe(FREE_FLIGHT_CLASSES.c172s.maxAltitudeFt);
    expect(clampFreeFlightAltitudeFt("c172s", 4_500.7)).toBe(4_501);
  });
  it("falls back to the default for a non-finite altitude", () => {
    expect(clampFreeFlightAltitudeFt("b738", Number.NaN)).toBe(FREE_FLIGHT_CLASSES.b738.defaultAltitudeFt);
  });
});
