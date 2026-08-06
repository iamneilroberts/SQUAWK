import { describe, it, expect } from "vitest";
import { WGS84_A, geodeticToEcef, ecefToGeodetic, geodeticSurfaceNormal, enuBasis } from "./geo";
import { vDot, vLength, vNormalize, vSub } from "./vec3";
import { degToRad, radToDeg } from "./units";

describe("geodeticToEcef", () => {
  it("puts 0N 0E at (a, 0, 0)", () => {
    const p = geodeticToEcef(0, 0, 0);
    expect(p.x).toBeCloseTo(WGS84_A, 3);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });
  it("puts 0N 90E on the +y axis", () => {
    const p = geodeticToEcef(0, Math.PI / 2, 0);
    expect(p.x).toBeCloseTo(0, 3);
    expect(p.y).toBeCloseTo(WGS84_A, 3);
  });
  it("adds height along the surface normal", () => {
    const a = geodeticToEcef(degToRad(30.6944), degToRad(-88.0399), 0);
    const b = geodeticToEcef(degToRad(30.6944), degToRad(-88.0399), 1000);
    // The displacement is exactly 1000 m along the ELLIPSOID NORMAL, which is not the
    // radial direction — so |b| - |a| falls ~4 mm short of 1000 m at this latitude. That
    // gap is the whole reason this module exists, so the assertion measures the
    // displacement itself and its direction, not the change in geocentric radius.
    expect(vLength(vSub(b, a))).toBeCloseTo(1000, 6);
    expect(vDot(vNormalize(vSub(b, a)), geodeticSurfaceNormal(a))).toBeCloseTo(1, 12);
  });
});

describe("ecefToGeodetic round-trip", () => {
  const cases: Array<[number, number, number]> = [
    [30.6944, -88.0399, 1500],
    [0, 0, 0],
    [-45.2, 170.5, 12000],
    [89.9, 12.0, 300],
    [-89.9, -12.0, 300],
  ];
  for (const [lat, lon, h] of cases) {
    it(`round-trips ${lat} ${lon} ${h}m`, () => {
      const g = ecefToGeodetic(geodeticToEcef(degToRad(lat), degToRad(lon), h));
      expect(radToDeg(g.latRad)).toBeCloseTo(lat, 7);
      expect(radToDeg(g.lonRad)).toBeCloseTo(lon, 7);
      expect(g.heightM).toBeCloseTo(h, 4);
    });
  }
});

describe("geodeticSurfaceNormal", () => {
  it("is a unit vector", () => {
    const n = geodeticSurfaceNormal(geodeticToEcef(degToRad(30.7), degToRad(-88), 3000));
    expect(vLength(n)).toBeCloseTo(1, 12);
  });
  it("points along +x at 0N 0E", () => {
    const n = geodeticSurfaceNormal(geodeticToEcef(0, 0, 0));
    expect(n.x).toBeCloseTo(1, 9);
  });
  it("is NOT the radial direction away from the equator (that is the whole point)", () => {
    const p = geodeticToEcef(degToRad(45), 0, 0);
    const radial = { x: p.x / vLength(p), y: p.y / vLength(p), z: p.z / vLength(p) };
    const n = geodeticSurfaceNormal(p);
    expect(vDot(radial, n)).toBeLessThan(1 - 1e-9);
  });
});

describe("enuBasis", () => {
  it("is orthonormal and right-handed", () => {
    const { east, north, up } = enuBasis(geodeticToEcef(degToRad(30.7), degToRad(-88), 0));
    expect(vLength(east)).toBeCloseTo(1, 12);
    expect(vLength(north)).toBeCloseTo(1, 12);
    expect(vLength(up)).toBeCloseTo(1, 12);
    expect(vDot(east, north)).toBeCloseTo(0, 12);
    expect(vDot(north, up)).toBeCloseTo(0, 12);
    expect(vDot(east, up)).toBeCloseTo(0, 12);
  });
  it("at 0N 0E: east is +y, north is +z, up is +x", () => {
    const { east, north, up } = enuBasis(geodeticToEcef(0, 0, 0));
    expect(east.y).toBeCloseTo(1, 9);
    expect(north.z).toBeCloseTo(1, 9);
    expect(up.x).toBeCloseTo(1, 9);
  });
});
