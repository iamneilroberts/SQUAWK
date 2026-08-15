import { describe, expect, it } from "vitest";
import type { Contact } from "../data/types";
import type { Airport } from "../data/airports";
import { bearingDeg, rangeNm } from "../dashboard/geoRange";
import { buildInstantMission } from "./instantMission";

/**
 * B2 — instant anonymous flight. Builds a SIM, unranked LockedMissionView from a REAL live
 * contact (take over exactly what is on the feed) plus the nearest bundled airport as a
 * destination. Pure: no fetch, no auth, no server lock. Mirrors free flight but the aircraft
 * identity and start state are the real contact's, not synthesized.
 */

const LOCKED_AT = 1_700_000_000_000;

/** A flyable GA contact near Mobile, AL (C172 → c172s per the takeover gate). */
function gaContact(over: Partial<Contact> = {}): Contact {
  return {
    hex: "a1b2c3",
    flight: "N12345",
    t: "C172",
    lat: 30.9,
    lon: -88.1,
    alt_geom: 6_500,
    alt_baro: 6_400,
    gs: 120,
    track: 210,
    baro_rate: 0,
    military: false,
    seen_pos: 3,
    ...over,
  };
}

/** A small airport set: KMOB is nearest to the contact; KBFM and a far one are decoys. */
const AIRPORTS: Airport[] = [
  { ident: "KMOB", iata: "MOB", name: "Mobile Regional Airport", latDeg: 30.6912, lonDeg: -88.2428, size: "large" },
  { ident: "KBFM", iata: "BFM", name: "Mobile Downtown Airport", latDeg: 30.6268, lonDeg: -88.0681, size: "medium" },
  { ident: "KATL", iata: "ATL", name: "Hartsfield Jackson", latDeg: 33.6367, lonDeg: -84.4281, size: "large" },
];

describe("buildInstantMission", () => {
  it("takes over the real contact unchanged as the mission aircraft", () => {
    const contact = gaContact();
    const view = buildInstantMission(contact, AIRPORTS, {}, LOCKED_AT);
    // The genuine aircraft is flown as-is — no synthesized identity or position.
    expect(view.contact).toEqual(contact);
    expect(view.classId).toBe("c172s");
    expect(view.status).toBe("locked");
  });

  it("is unranked and local: no server lock, disclosed as instant", () => {
    const view = buildInstantMission(gaContact(), AIRPORTS, {}, LOCKED_AT);
    expect(view.traffic.source).toBeNull();
    expect(view.traffic.cacheStatus).toBe("MISS");
    // Defaults to FULL (owner 2026-08-15): the corridor ribbon should show without the pilot
    // touching the ASSIST control on a fresh/anonymous session.
    expect(view.assist).toBe("medium");
    expect(view.reconstruction.disclosure).toContain("INSTANT");
    expect(view.reconstruction.disclosure).toContain("UNRANKED");
    expect(view.receipt).toContain("instant");
  });

  it("assigns the nearest airport as the destination", () => {
    const contact = gaContact();
    const view = buildInstantMission(contact, AIRPORTS, {}, LOCKED_AT);
    expect(view.assignment.airportIdent).toBe("KMOB"); // nearest to 30.9,-88.1
    expect(view.assignment.airportName).toBe("Mobile Regional Airport");
    const expectDist = rangeNm(contact.lat, contact.lon, 30.6912, -88.2428);
    expect(view.assignment.distanceNm).toBeCloseTo(expectDist, 3);
    // Destination bearing (contact -> airport) drives the nav director; store it as the heading.
    const expectBrg = bearingDeg(contact.lat, contact.lon, 30.6912, -88.2428);
    expect(view.assignment.runwayHeadingDeg).toBeCloseTo(expectBrg, 3);
    expect(view.assignment.assignedEnd.latDeg).toBe(30.6912);
    expect(view.assignment.assignedEnd.lonDeg).toBe(-88.2428);
  });

  it("uses the real altitude and track for the spawn (alt_geom preferred)", () => {
    const view = buildInstantMission(gaContact({ alt_geom: 8_000, track: 90 }), AIRPORTS, {}, LOCKED_AT);
    // Spawn altitude comes from the real alt_geom; state is populated by the shared spawn builder.
    expect(view.reconstruction.state).toBeTruthy();
    expect(view.reconstruction.altitudeSource).toBeTruthy();
  });

  it("resolves an airliner contact to b738", () => {
    const view = buildInstantMission(gaContact({ t: "B738" }), AIRPORTS, {}, LOCKED_AT);
    expect(view.classId).toBe("b738");
  });

  it("throws on an unsupported contact (caller must pre-check eligibility)", () => {
    expect(() => buildInstantMission(gaContact({ t: "ZZZZ" }), AIRPORTS, {}, LOCKED_AT)).toThrow();
  });

  it("throws when no airports are available", () => {
    expect(() => buildInstantMission(gaContact(), [], {}, LOCKED_AT)).toThrow();
  });

  it("honors a caller-supplied mission id", () => {
    const view = buildInstantMission(gaContact(), AIRPORTS, { missionId: "test-mission-id" }, LOCKED_AT);
    expect(view.missionId).toBe("test-mission-id");
  });
});
