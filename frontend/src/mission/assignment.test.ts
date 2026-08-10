import { describe, expect, it } from "vitest";
import { assignMission } from "./assignment";
import { destinationPoint } from "./geo";
import { missionProfileForClass } from "./profiles";
import type { MissionAirport, MissionStartSnapshot, Runway } from "./types";

const snapshot: MissionStartSnapshot = {
  latDeg: 0,
  lonDeg: 179.5,
  altitudeFt: 8000,
  groundSpeedKt: 120,
  trackDeg: 90,
};

function runway(over: Partial<Runway> = {}): Runway {
  return {
    id: "1",
    lengthFt: 3000,
    widthFt: 60,
    surface: "HARD",
    surfaceRaw: "ASPH",
    lighted: true,
    closed: false,
    lowEnd: { ident: "09", latDeg: 0, lonDeg: 0, elevationFt: 10, headingDeg: 90, displacedThresholdFt: 0 },
    highEnd: { ident: "27", latDeg: 0, lonDeg: 0, elevationFt: 10, headingDeg: 270, displacedThresholdFt: 0 },
    ...over,
  };
}

function airport(ident: string, distanceNm: number, over: Partial<MissionAirport> = {}): MissionAirport {
  const point = destinationPoint(snapshot.latDeg, snapshot.lonDeg, 90, distanceNm);
  return {
    ident,
    iata: null,
    name: ident,
    size: "small",
    latDeg: point.latDeg,
    lonDeg: point.lonDeg,
    elevationFt: 10,
    runways: [runway()],
    ...over,
  };
}

function assign(airports: MissionAirport[]) {
  return assignMission({
    snapshot,
    profile: missionProfileForClass("c172s"),
    datasetVersion: "fixture-v1",
    airports,
  });
}

describe("deterministic mission assignment", () => {
  it("accepts exactly 30 minutes and rejects just beyond it", () => {
    const exact = assign([airport("EXACT", 60)]);
    expect(exact.assigned).toBe(true);
    if (exact.assigned) expect(exact.best.estimatedMinutes).toBeCloseTo(30, 6);
    expect(assign([airport("OUT", 60.001)])).toMatchObject({ assigned: false, reason: "NO_SUITABLE_RUNWAY" });
  });

  it("honors the exact 30-minute cap for every launch profile", () => {
    for (const classId of ["c172s", "b738", "f5e"] as const) {
      const profile = missionProfileForClass(classId);
      const speed = profile.reachability.defaultPlanningSpeedKt;
      const exactPoint = destinationPoint(0, 0, 90, speed / 2);
      const exactAirport: MissionAirport = {
        ...airport(`EXACT-${classId}`, 20),
        size: "large",
        latDeg: exactPoint.latDeg,
        lonDeg: exactPoint.lonDeg,
        runways: [runway({
          lengthFt: profile.runway.minLengthFt,
          widthFt: profile.runway.minWidthFt,
          surface: profile.runway.surfaces[0],
          lighted: profile.runway.requireLighted,
        })],
      };
      const exact = assignMission({
        snapshot: { ...snapshot, lonDeg: 0, groundSpeedKt: speed },
        profile,
        datasetVersion: "fixture-v1",
        airports: [exactAirport],
      });
      expect(exact.assigned, classId).toBe(true);
      const outsidePoint = destinationPoint(0, 0, 90, speed / 2 + 0.001);
      const outside = assignMission({
        snapshot: { ...snapshot, lonDeg: 0, groundSpeedKt: speed },
        profile,
        datasetVersion: "fixture-v1",
        airports: [{ ...exactAirport, latDeg: outsidePoint.latDeg, lonDeg: outsidePoint.lonDeg }],
      });
      expect(outside.assigned, classId).toBe(false);
    }
  });

  it("uses the profile's exact runway boundaries", () => {
    expect(assign([airport("OK", 20, { runways: [runway({ lengthFt: 1800, widthFt: 35 })] })]).assigned).toBe(true);
    expect(assign([airport("SHORT", 20, { runways: [runway({ lengthFt: 1799 })] })]).assigned).toBe(false);
    expect(assign([airport("NARROW", 20, { runways: [runway({ widthFt: 34 })] })]).assigned).toBe(false);
  });

  it("rejects closed, no-runway, incomplete, and disallowed-surface airports", () => {
    expect(assign([airport("NONE", 20, { runways: [] })]).assigned).toBe(false);
    expect(assign([airport("CLOSED", 20, { runways: [runway({ closed: true })] })]).assigned).toBe(false);
    expect(assign([airport("WATER", 20, { runways: [runway({ surface: "WATER" })] })]).assigned).toBe(false);
    expect(assign([airport("ONEEND", 20, { runways: [runway({ highEnd: null })] })]).assigned).toBe(false);
  });

  it("crosses the antimeridian and remains deterministic under input shuffling", () => {
    const airports = [airport("ZZZZ", 40), airport("AAAA", 40), airport("MMMM", 45)];
    const forward = assign(airports);
    const reverse = assign([...airports].reverse());
    expect(forward).toEqual(reverse);
    expect(forward.assigned).toBe(true);
    if (forward.assigned) {
      expect(forward.best.airportIdent).toBe("AAAA");
      expect(forward.alternatives.map((candidate) => candidate.airportIdent)).toEqual(["ZZZZ", "MMMM"]);
      expect(forward.best.airportLonDeg).toBeLessThan(-179);
    }
  });

  it("produces stable finite assignments near the pole", () => {
    const polarSnapshot = { ...snapshot, latDeg: 89.8, lonDeg: 170 };
    const point = destinationPoint(polarSnapshot.latDeg, polarSnapshot.lonDeg, 90, 20);
    const result = assignMission({
      snapshot: polarSnapshot,
      profile: missionProfileForClass("c172s"),
      datasetVersion: "fixture-v1",
      airports: [{ ...airport("POLAR", 20), latDeg: point.latDeg, lonDeg: point.lonDeg }],
    });
    expect(result.assigned).toBe(true);
    if (result.assigned) expect(Number.isFinite(result.best.distanceNm)).toBe(true);
  });
});
