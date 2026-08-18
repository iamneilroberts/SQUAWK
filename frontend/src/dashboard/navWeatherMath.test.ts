import { describe, it, expect } from "vitest";
import {
  navPixelToRangeBearing,
  destPoint,
  lonLatToWorldPixel,
  navPixelToWorldPixel,
  resolveZoom,
  parseManifest,
  pickNewestFrame,
  buildTileUrl,
  buildTileUrlTemplate,
  radarChipText,
  radarFrameAgeMin,
  RADAR_MAX_Z,
  type NavWeatherState,
} from "./navWeatherMath";

// Broken-arm discipline: every warp assertion pins a specific geographic fact, so the test FAILS
// if the projection is wrong (axis swapped, sign flipped, bearing/coord confused) — not merely if
// "something rendered".

describe("navPixelToRangeBearing (inverse of navXY)", () => {
  it("centre pixel is range 0", () => {
    const rb = navPixelToRangeBearing(0, 0, 50, 96);
    expect(rb).not.toBeNull();
    expect(rb!.rangeNm).toBeCloseTo(0, 6);
  });

  it("a pixel straight up the face is due NORTH at half range", () => {
    const rb = navPixelToRangeBearing(0, -48, 50, 96)!;
    expect(rb.rangeNm).toBeCloseTo(25, 6);
    expect(rb.bearingDeg).toBeCloseTo(0, 6);
  });

  it("straight right is due EAST (090), not north — axis is not confused", () => {
    const rb = navPixelToRangeBearing(48, 0, 50, 96)!;
    expect(rb.rangeNm).toBeCloseTo(25, 6);
    expect(rb.bearingDeg).toBeCloseTo(90, 6);
  });

  it("down is 180 and left is 270", () => {
    expect(navPixelToRangeBearing(0, 48, 50, 96)!.bearingDeg).toBeCloseTo(180, 6);
    expect(navPixelToRangeBearing(-48, 0, 50, 96)!.bearingDeg).toBeCloseTo(270, 6);
  });

  it("excludes a pixel OUTSIDE the nav circle (no wrapped-around sky)", () => {
    expect(navPixelToRangeBearing(90, 90, 50, 96)).toBeNull(); // hypot ≈ 127 > 96
  });
});

describe("destPoint (spherical direct geodesic)", () => {
  it("25 NM due north from the equator/prime meridian moves LAT, not LON", () => {
    const p = destPoint(0, 0, 25, 0);
    expect(p.latDeg).toBeCloseTo(0.4164, 3); // 25 NM on the 3440.065-NM sphere
    expect(p.lonDeg).toBeCloseTo(0, 6);
  });

  it("25 NM due east moves LON, not LAT — bearing is not treated as a coordinate", () => {
    const p = destPoint(0, 0, 25, 90);
    expect(p.latDeg).toBeCloseTo(0, 6);
    expect(p.lonDeg).toBeCloseTo(0.4164, 3);
  });

  it("60 NM north from a mid-latitude adds ~1° of latitude", () => {
    const p = destPoint(51.5, 0, 60, 0);
    expect(p.latDeg).toBeCloseTo(52.499, 2);
    expect(p.lonDeg).toBeCloseTo(0, 6);
  });
});

describe("lonLatToWorldPixel (Web-Mercator)", () => {
  it("lon/lat 0,0 is the centre of the world at z=2", () => {
    const w = lonLatToWorldPixel(0, 0, 2); // scale = 4 * 256 = 1024
    expect(w.x).toBeCloseTo(512, 6);
    expect(w.y).toBeCloseTo(512, 6);
  });

  it("north is a SMALLER y and east is a LARGER x (right-way-up, not mirrored)", () => {
    const centre = lonLatToWorldPixel(0, 0, 4);
    const north = lonLatToWorldPixel(1, 0, 4);
    const east = lonLatToWorldPixel(0, 1, 4);
    expect(north.y).toBeLessThan(centre.y);
    expect(east.x).toBeGreaterThan(centre.x);
  });
});

describe("navPixelToWorldPixel (the whole warp composed)", () => {
  const own = { latDeg: 0, lonDeg: 0 };
  const base = { own, navRangeNm: 50, z: 4, radiusPx: 96 };

  it("returns null outside the circle", () => {
    expect(navPixelToWorldPixel({ ...base, px: 90, py: 90 })).toBeNull();
  });

  it("a north-of-centre nav pixel maps NORTH in world pixels (smaller y)", () => {
    const centre = navPixelToWorldPixel({ ...base, px: 0, py: 0 })!;
    const north = navPixelToWorldPixel({ ...base, px: 0, py: -48 })!;
    expect(north.y).toBeLessThan(centre.y);
    expect(north.x).toBeCloseTo(centre.x, 3); // due north: no east/west drift
  });

  it("an east-of-centre nav pixel maps EAST in world pixels (larger x)", () => {
    const centre = navPixelToWorldPixel({ ...base, px: 0, py: 0 })!;
    const east = navPixelToWorldPixel({ ...base, px: 48, py: 0 })!;
    expect(east.x).toBeGreaterThan(centre.x);
    expect(east.y).toBeCloseTo(centre.y, 3);
  });
});

describe("resolveZoom", () => {
  it("caps a small range at RADAR_MAX_Z and flags it COARSE", () => {
    const r = resolveZoom(10, 0, 96);
    expect(r.z).toBe(RADAR_MAX_Z);
    expect(r.capped).toBe(true);
  });

  it("a large range resolves under the cap and is not coarse", () => {
    const r = resolveZoom(200, 0, 96);
    expect(r.z).toBeLessThan(RADAR_MAX_Z);
    expect(r.capped).toBe(false);
  });
});

describe("parseManifest", () => {
  const good = {
    version: "2.0",
    host: "https://tilecache.rainviewer.com",
    radar: { past: [{ time: 100, path: "/v2/radar/aaa" }, { time: 200, path: "/v2/radar/bbb" }] },
  };

  it("takes host + past frames from a valid document", () => {
    const m = parseManifest(good)!;
    expect(m.host).toBe("https://tilecache.rainviewer.com");
    expect(m.frames).toEqual([
      { time: 100, path: "/v2/radar/aaa" },
      { time: 200, path: "/v2/radar/bbb" },
    ]);
  });

  it("returns null for a non-object, a missing radar, or an empty past (→ NO RADAR FEED)", () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest({})).toBeNull();
    expect(parseManifest({ host: "h", radar: {} })).toBeNull();
    expect(parseManifest({ host: "h", radar: { past: [] } })).toBeNull();
  });
});

describe("pickNewestFrame / buildTileUrl", () => {
  it("picks the max-time frame, null on empty", () => {
    const f = pickNewestFrame([
      { time: 5, path: "/a" },
      { time: 9, path: "/b" },
      { time: 3, path: "/c" },
    ]);
    expect(f).toEqual({ time: 9, path: "/b" });
    expect(pickNewestFrame([])).toBeNull();
  });

  it("builds the standard RainViewer XYZ URL", () => {
    const url = buildTileUrl({ host: "https://t", path: "/v2/radar/abc", z: 3, x: 2, y: 1 });
    expect(url).toBe("https://t/v2/radar/abc/256/3/2/1/2/1_1.png");
  });

  it("builds a Cesium {z}/{x}/{y} template URL with the same path and params", () => {
    const url = buildTileUrlTemplate({ host: "https://t", path: "/v2/radar/abc" });
    expect(url).toBe("https://t/v2/radar/abc/256/{z}/{x}/{y}/2/1_1.png");
  });
});

describe("radarChipText (honest-offline wording, distinct from ADS-B)", () => {
  const now = 1_800_000_000_000;

  it("unreachable is NO RADAR FEED — not the ADS-B feed wording", () => {
    const s: NavWeatherState = { kind: "unreachable" };
    const chip = radarChipText(s, now);
    expect(chip).toBe("NO RADAR FEED");
    expect(chip).not.toContain("TRAFFIC");
  });

  it("loading and no-position say the honest thing (and no-position stays silent)", () => {
    expect(radarChipText({ kind: "loading" }, now)).toBe("RADAR…");
    expect(radarChipText({ kind: "no-position" }, now)).toBeNull();
  });

  it("a fresh frame shows its real age, no STALE", () => {
    const frame = { time: now / 1000 - 4 * 60, path: "/p" };
    expect(radarChipText({ kind: "ok", host: "h", frame }, now)).toBe("WX 4 MIN");
  });

  it("an old frame is flagged STALE, never shown silently", () => {
    const frame = { time: now / 1000 - 20 * 60, path: "/p" };
    expect(radarFrameAgeMin(frame.time, now)).toBe(20);
    expect(radarChipText({ kind: "ok", host: "h", frame }, now)).toBe("WX 20 MIN · STALE");
  });

  it("a coarse (upscaled) overlay is flagged COARSE", () => {
    const frame = { time: now / 1000 - 60, path: "/p" };
    expect(radarChipText({ kind: "ok", host: "h", frame }, now, true)).toBe("WX 1 MIN · COARSE");
  });
});
