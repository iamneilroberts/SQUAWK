import { describe, expect, it } from "vitest";

import rawAdsbFi from "../../test/fixtures/adsb/raw-adsb-fi.json";
import rawAirplanesLive from "../../test/fixtures/adsb/raw-airplanes-live.json";
import groundContact from "../../test/fixtures/adsb/ground-contact.json";
import malformedEnvelope from "../../test/fixtures/adsb/malformed-envelope.json";
import missingPosition from "../../test/fixtures/adsb/missing-position.json";
import {
  adsbRows,
  normalizeAdsbContacts,
  normalizeAdsbPayload,
} from "../../worker/adsb/normalize";

describe("ADS-B normalization parity", () => {
  it("matches the approved legacy airplanes.live snapshot", () => {
    expect(normalizeAdsbContacts(rawAirplanesLive)).toMatchSnapshot();
  });

  it("matches the approved legacy adsb.fi snapshot", () => {
    expect(normalizeAdsbContacts(rawAdsbFi)).toMatchSnapshot();
  });

  it("accepts ac and aircraft envelopes and normalizes their timestamp units", () => {
    expect(adsbRows(rawAirplanesLive)).not.toBeNull();
    expect(adsbRows(rawAdsbFi)).not.toBeNull();
    expect(normalizeAdsbPayload(rawAirplanesLive).sourceTime).toBe(1_785_118_036.001);
    expect(normalizeAdsbPayload(rawAdsbFi).sourceTime).toBe(1_785_118_044.001);
  });

  it("preserves ground, trims strings, and applies the military dbFlags bit", () => {
    expect(normalizeAdsbContacts(groundContact)).toEqual([
      {
        hex: "a1b2c3",
        flight: "GROUND1",
        t: null,
        lat: 30,
        lon: -88,
        alt_geom: null,
        alt_baro: "ground",
        gs: null,
        track: null,
        baro_rate: null,
        military: true,
        seen_pos: null,
      },
    ]);
  });

  it("drops missing positions and non-object rows without losing valid contacts", () => {
    expect(normalizeAdsbContacts(missingPosition).map(({ hex }) => hex)).toEqual(["d4e5f6"]);
    expect(
      normalizeAdsbContacts({
        ac: ["junk", 42, { hex: "ok", lat: 1, lon: 2 }],
      }).map(({ hex }) => hex),
    ).toEqual(["ok"]);
  });

  it("returns no contacts for a malformed envelope, preserving legacy behavior", () => {
    expect(adsbRows(malformedEnvelope)).toBeNull();
    expect(normalizeAdsbContacts(malformedEnvelope)).toEqual([]);
  });
});
