import { describe, expect, it } from "vitest";
import type { Contact } from "../data/types";
import type { MissionAirport } from "../mission/types";
import {
  assignContactMission,
  assignmentKey,
  briefingPrelude,
  missionSearchRadiusNm,
  missionSnapshotFromContact,
  prepareRequestForBriefing,
  selectBriefingAssignment,
} from "./briefingState";
import { missionProfileForClass } from "../mission/profiles";

function contact(over: Partial<Contact> = {}): Contact {
  return {
    hex: "a0b1c2", flight: "N123", t: "C172", lat: 30, lon: -88,
    alt_geom: 3_500, alt_baro: 3_400, gs: 110, track: 90, baro_rate: 0,
    military: false, seen_pos: 1, ...over,
  };
}

function airport(ident: string, lonDeg: number): MissionAirport {
  return {
    ident,
    iata: null,
    name: `${ident} FIELD`,
    size: "small",
    latDeg: 30,
    lonDeg,
    elevationFt: 100,
    runways: [{
      id: `${ident}-09-27`, lengthFt: 5_000, widthFt: 100, surface: "HARD",
      surfaceRaw: "ASP", lighted: true, closed: false,
      lowEnd: { ident: "09", latDeg: 30, lonDeg, elevationFt: 100, headingDeg: 90, displacedThresholdFt: 0 },
      highEnd: { ident: "27", latDeg: 30, lonDeg: lonDeg + 0.01, elevationFt: 100, headingDeg: 270, displacedThresholdFt: 0 },
    }],
  };
}

describe("briefingPrelude", () => {
  it("distinguishes idle, unsupported, stale, and provider-down states", () => {
    expect(briefingPrelude(null, "live", true)).toEqual({ status: "idle" });
    expect(briefingPrelude(contact({ t: "C130" }), "live", true)).toMatchObject({ status: "unavailable", kind: "unsupported" });
    expect(briefingPrelude(contact(), "stale", true)).toMatchObject({ status: "unavailable", kind: "stale" });
    expect(briefingPrelude(contact(), "offline", false)).toMatchObject({ status: "unavailable", kind: "provider-down" });
  });

  it("names a stale position even when the feed itself is live", () => {
    expect(briefingPrelude(contact({ seen_pos: 40 }), "live", true))
      .toMatchObject({ status: "unavailable", kind: "stale", reason: "POSITION STALE (40S)" });
  });
});

describe("provisional mission assignment", () => {
  it("builds an eligible route from the frozen contact snapshot", () => {
    const state = assignContactMission({
      contact: contact(),
      classId: "c172s",
      airports: [airport("KONE", -87.8), airport("KTWO", -87.7)],
      datasetVersion: "fixture-v1",
    });
    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    expect(state.assignment.datasetVersion).toBe("fixture-v1");
    expect(state.selected.airportIdent).toBe(state.assignment.best.airportIdent);
    const alternative = state.assignment.alternatives[0];
    expect(alternative).toBeDefined();
    const selected = selectBriefingAssignment(state, assignmentKey(alternative));
    expect(selected).toMatchObject({ status: "ready", selected: { airportIdent: alternative.airportIdent } });
    expect(selectBriefingAssignment(state, "fabricated:choice")).toBe(state);
  });

  it("returns no-runway without fabricating an assignment", () => {
    const state = assignContactMission({
      contact: contact(), classId: "c172s", airports: [], datasetVersion: "fixture-v1",
    });
    expect(state).toMatchObject({ status: "unavailable", kind: "no-runway" });
  });

  it("derives the bounded search radius and snapshot from real fields", () => {
    const snapshot = missionSnapshotFromContact(contact({ gs: 120 }));
    expect(snapshot).toEqual({ latDeg: 30, lonDeg: -88, altitudeFt: 3_500, groundSpeedKt: 120, trackDeg: 90 });
    expect(missionSearchRadiusNm(snapshot, missionProfileForClass("c172s"))).toBe(60);
  });

  it("builds a bounded provisional fingerprint for Worker revalidation", () => {
    const state = assignContactMission({
      contact: contact(),
      classId: "c172s",
      airports: Array.from({ length: 15 }, (_, index) =>
        airport(`K${String(index).padStart(3, "0")}`, -87.8 + index * 0.01)),
      datasetVersion: "fixture-v1",
    });
    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    const request = prepareRequestForBriefing(state);
    expect(request.aircraftHex).toBe("a0b1c2");
    expect(request.preview.selectedChoiceKey).toBe(assignmentKey(state.selected));
    expect(request.preview.eligibleChoiceKeys.length).toBeLessThanOrEqual(12);
    expect(request.preview.eligibleChoiceKeys).toContain(request.preview.selectedChoiceKey);
  });
});
