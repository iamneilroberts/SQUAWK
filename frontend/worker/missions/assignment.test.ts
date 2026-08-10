import { describe, expect, it } from "vitest";

import { assignMission } from "../../src/mission/assignment";
import { destinationPoint } from "../../src/mission/geo";
import { missionProfileForClass } from "../../src/mission/profiles";
import type { MissionAirport, Runway } from "../../src/mission/types";

const start = { latDeg: 30, lonDeg: 179.8, altitudeFt: 12000, groundSpeedKt: 240, trackDeg: 90 };
const point = destinationPoint(start.latDeg, start.lonDeg, 90, 80);
const runway: Runway = {
  id: "fixture-runway",
  lengthFt: 7000,
  widthFt: 120,
  surface: "HARD",
  surfaceRaw: "ASPH",
  lighted: true,
  closed: false,
  lowEnd: { ident: "09", latDeg: point.latDeg, lonDeg: point.lonDeg, elevationFt: 20, headingDeg: 90, displacedThresholdFt: 0 },
  highEnd: { ident: "27", latDeg: point.latDeg, lonDeg: point.lonDeg, elevationFt: 20, headingDeg: 270, displacedThresholdFt: 0 },
};
const airport: MissionAirport = {
  ident: "PARITY",
  iata: null,
  name: "Runtime parity fixture",
  size: "medium",
  latDeg: point.latDeg,
  lonDeg: point.lonDeg,
  elevationFt: 20,
  runways: [runway],
};

describe("mission assignment in workerd", () => {
  it("runs the same pure versioned assignment contract used by the browser", () => {
    const result = assignMission({
      snapshot: start,
      profile: missionProfileForClass("b738"),
      datasetVersion: "parity-v1",
      airports: [airport],
    });
    expect(result).toMatchObject({
      assigned: true,
      datasetVersion: "parity-v1",
      profileVersion: "mission-b738-2026-08-10-v2",
      assignmentVersion: "assignment-2026-08-10-v1",
      scoringVersion: "scoring-2026-08-10-v1",
      planningSpeedKt: 240,
      best: { airportIdent: "PARITY", runwayEndIdent: "09", distanceNm: 80, estimatedMinutes: 20 },
      alternatives: [],
    });
  });
});
