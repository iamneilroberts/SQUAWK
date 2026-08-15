import { describe, it, expect } from "vitest";
import { radiusRectangleDeg } from "./ContactLayer";

describe("radiusRectangleDeg (#42 — RADIUS chip camera framing)", () => {
  it("grows the rectangle as the radius grows, centered on the given point", () => {
    const centerLat = 40;
    const centerLon = -105;
    const r80 = radiusRectangleDeg(centerLat, centerLon, 80);
    const r250 = radiusRectangleDeg(centerLat, centerLon, 250);

    expect(r80.west).toBeLessThan(centerLon);
    expect(r80.east).toBeGreaterThan(centerLon);
    expect(r80.south).toBeLessThan(centerLat);
    expect(r80.north).toBeGreaterThan(centerLat);

    // Bigger radius -> bigger rectangle, symmetric around the center in both axes.
    expect(r250.east - r250.west).toBeGreaterThan(r80.east - r80.west);
    expect(r250.north - r250.south).toBeGreaterThan(r80.north - r80.south);
    expect(r80.east - centerLon).toBeCloseTo(centerLon - r80.west, 10);
    expect(r80.north - centerLat).toBeCloseTo(centerLat - r80.south, 10);
  });

  it("widens the longitude span at higher latitude for the same radius (meridian convergence)", () => {
    const equator = radiusRectangleDeg(0, 0, 80);
    const midLat = radiusRectangleDeg(60, 0, 80);
    const equatorLonSpan = equator.east - equator.west;
    const midLatLonSpan = midLat.east - midLat.west;
    expect(midLatLonSpan).toBeGreaterThan(equatorLonSpan);
    // Latitude span (north-south) is unaffected by longitude convergence.
    expect(midLat.north - midLat.south).toBeCloseTo(equator.north - equator.south, 10);
  });
});
