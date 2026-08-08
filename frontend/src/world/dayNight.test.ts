import { describe, it, expect } from "vitest";
import { solarElevationDeg, classifyLightPhase } from "./dayNight";

/*
 * Pure solar geometry — no Cesium, no browser. Anchored on J2000-era instants whose sun
 * position is textbook: at the equator, local solar noon puts the sun ~67° up in early
 * January (90° − 23° declination), and twelve hours later it is deep below the horizon.
 * The thresholds follow the civil-twilight convention (sun 0 … −6°).
 */
describe("solarElevationDeg", () => {
  it("puts the sun high overhead at equatorial local noon", () => {
    // 2000-01-01 12:00 UTC at lon 0 is local solar noon; declination is ~−23°.
    const elev = solarElevationDeg(new Date("2000-01-01T12:00:00Z"), 0, 0);
    expect(elev).toBeGreaterThan(60);
    expect(elev).toBeLessThan(72);
  });
  it("puts the sun well below the horizon at equatorial local midnight", () => {
    const elev = solarElevationDeg(new Date("2000-01-02T00:00:00Z"), 0, 0);
    expect(elev).toBeLessThan(-50);
  });
  it("accounts for longitude: same instant, opposite side of the globe is night", () => {
    // Noon UTC at lon 0 is midnight at lon 180 — the sun must be below the horizon there.
    const elev = solarElevationDeg(new Date("2000-01-01T12:00:00Z"), 0, 180);
    expect(elev).toBeLessThan(0);
  });
  it("accounts for latitude: winter pole is in polar night", () => {
    // Northern high latitude in early January sees the sun below the horizon all day.
    const elev = solarElevationDeg(new Date("2000-01-01T12:00:00Z"), 80, 0);
    expect(elev).toBeLessThan(0);
  });
});

describe("classifyLightPhase", () => {
  it("is day when the sun is at or above the horizon", () => {
    expect(classifyLightPhase(45)).toBe("day");
    expect(classifyLightPhase(0)).toBe("day");
  });
  it("is civil twilight from the horizon down to −6°", () => {
    expect(classifyLightPhase(-0.5)).toBe("civil-twilight");
    expect(classifyLightPhase(-6)).toBe("civil-twilight");
  });
  it("is night below −6°", () => {
    expect(classifyLightPhase(-6.01)).toBe("night");
    expect(classifyLightPhase(-30)).toBe("night");
  });
});
