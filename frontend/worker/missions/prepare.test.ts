import { describe, expect, it } from "vitest";
import type { Contact, TrafficData } from "../../src/data/types";
import { assignMission } from "../../src/mission/assignment";
import {
  missionPreviewIdentity,
  type PrepareMissionRequest,
} from "../../src/mission/contract";
import { missionProfileForClass } from "../../src/mission/profiles";
import { missionSnapshotFromContact } from "../../src/mission/planning";
import type { AirportDatasetManifest, MissionAirport } from "../../src/mission/types";
import { DATA_VERSIONS } from "../../src/shared/versions";
import { verifyMissionPreparation } from "./authorization";
import { prepareAuthoritativeMission } from "./prepare";

const NOW = 1_700_000_000_000;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PREPARATION_ID = "22222222-2222-4222-8222-222222222222";
const SECRET = "test-only-mission-secret-with-at-least-32-bytes";

const contact: Contact = {
  hex: "a0b1c2",
  flight: "N123",
  t: "C172",
  lat: 30,
  lon: -88,
  alt_geom: 3_500,
  alt_baro: 3_400,
  gs: 110,
  track: 90,
  baro_rate: 0,
  military: false,
  seen_pos: 1,
};

const airport: MissionAirport = {
  ident: "KTST",
  iata: null,
  name: "TEST FIELD",
  size: "small",
  latDeg: 30,
  lonDeg: -87.8,
  elevationFt: 100,
  runways: [{
    id: "09-27",
    lengthFt: 5_000,
    widthFt: 100,
    surface: "HARD",
    surfaceRaw: "ASP",
    lighted: true,
    closed: false,
    lowEnd: { ident: "09", latDeg: 30, lonDeg: -87.8, elevationFt: 100, headingDeg: 90, displacedThresholdFt: 0 },
    highEnd: { ident: "27", latDeg: 30, lonDeg: -87.79, elevationFt: 100, headingDeg: 270, displacedThresholdFt: 0 },
  }],
};

const manifest: AirportDatasetManifest = {
  schemaVersion: 1,
  recordEncoding: "airport-runway-tuples-v1",
  datasetVersion: DATA_VERSIONS.airport,
  shardDegrees: 10,
  source: {
    date: "2026-08-10",
    airportsUrl: "https://fixture.test/airports.csv",
    runwaysUrl: "https://fixture.test/runways.csv",
    airportsSha256: "a".repeat(64),
    runwaysSha256: "b".repeat(64),
  },
  attribution: "fixture",
  bounds: { south: -90, west: -180, north: 90, east: 180 },
  counts: { airports: 1, runways: 1, shards: 1, bytes: 1 },
  shards: {
    fixture: {
      path: "shards/fixture.json",
      sha256: "c".repeat(64),
      bytes: 1,
      airportCount: 1,
      runwayCount: 1,
      bounds: { south: 20, west: -100, north: 40, east: -80 },
    },
  },
};

const shard = [[
  airport.ident,
  airport.iata,
  airport.name,
  airport.size,
  airport.latDeg,
  airport.lonDeg,
  airport.elevationFt,
  [[
    "09-27", 5_000, 100, "HARD", "ASP", 1, 0,
    ["09", 30, -87.8, 100, 90, 0],
    ["27", 30, -87.79, 100, 270, 0],
  ]],
]];

const source = {
  async fetch(path: string) {
    const body = path.endsWith("manifest.json") ? manifest : shard;
    return { ok: true, status: 200, json: async () => body };
  },
};

function traffic(overrides: Partial<TrafficData> = {}): TrafficData {
  return {
    contacts: [contact],
    source: "fixture",
    sourceTime: NOW / 1_000,
    fetchedAt: NOW / 1_000,
    cacheAgeSeconds: 0,
    freshness: "FRESH",
    providerAvailable: true,
    regionKey: "fixture",
    nextRefreshSeconds: 8,
    cacheStatus: "MISS",
    radiusNm: 25,
    ...overrides,
  };
}

function request(): PrepareMissionRequest {
  const assignment = assignMission({
    snapshot: missionSnapshotFromContact(contact),
    profile: missionProfileForClass("c172s"),
    datasetVersion: DATA_VERSIONS.airport,
    airports: [airport],
  });
  if (!assignment.assigned) throw new Error("fixture assignment failed");
  return {
    aircraftHex: contact.hex,
    position: { lat: contact.lat, lon: contact.lon },
    preview: missionPreviewIdentity({
      contact,
      classId: "c172s",
      assignment,
      selected: assignment.best,
    }),
  };
}

describe("authoritative mission preparation", () => {
  it("recomputes the same route and signs a short-lived authoritative eligible set", async () => {
    const prepared = await prepareAuthoritativeMission({
      now: NOW,
      uuid: () => PREPARATION_ID,
      userId: USER_ID,
      signingSecret: SECRET,
      traffic: traffic(),
      request: request(),
      airportSource: source,
    });

    expect(prepared.reconfirmationRequired).toBe(false);
    expect(prepared.preparation.selected.airportIdent).toBe("KTST");
    expect(prepared.preparation.expiresAt).toBeGreaterThan(NOW);
    await expect(verifyMissionPreparation({
      token: prepared.preparation.preparationToken,
      secret: SECRET,
      userId: USER_ID,
      now: NOW + 1,
    })).resolves.toMatchObject({ preparationId: PREPARATION_ID, userId: USER_ID });
  });

  it("requires reconfirmation when the provisional eligibility fingerprint changed", async () => {
    const changed = request();
    changed.preview = { ...changed.preview, eligibleChoiceKeys: ["KOLD:01-19:01"] };
    const prepared = await prepareAuthoritativeMission({
      now: NOW,
      uuid: () => PREPARATION_ID,
      userId: USER_ID,
      signingSecret: SECRET,
      traffic: traffic(),
      request: changed,
      airportSource: source,
    });
    expect(prepared.reconfirmationRequired).toBe(true);
    expect(prepared.preparation.selected.airportIdent).toBe("KTST");
  });

  it("refuses a stale provider snapshot", async () => {
    await expect(prepareAuthoritativeMission({
      now: NOW,
      uuid: () => PREPARATION_ID,
      userId: USER_ID,
      signingSecret: SECRET,
      traffic: traffic({ freshness: "STALE" }),
      request: request(),
      airportSource: source,
    })).rejects.toMatchObject({ code: "MISSION_AIRCRAFT_STALE" });
  });

  it("adds broker cache age before applying the selected-position freshness gate", async () => {
    await expect(prepareAuthoritativeMission({
      now: NOW,
      uuid: () => PREPARATION_ID,
      userId: USER_ID,
      signingSecret: SECRET,
      traffic: traffic({
        contacts: [{ ...contact, seen_pos: 10 }],
        cacheAgeSeconds: 6,
        cacheStatus: "HIT",
      }),
      request: request(),
      airportSource: source,
    })).rejects.toMatchObject({ code: "MISSION_AIRCRAFT_STALE" });
  });
});
