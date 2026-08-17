import { describe, it, expect } from "vitest";
import { projectBorderPolys, coastPolylines, borderPolylines } from "./navBorders";
import { NAV_RADIUS_PX } from "./navMath";

// projectBorderPolys takes the internal Poly shape; build a couple by hand.
function poly(pts: number[]) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minLon = Math.min(minLon, pts[i]); maxLon = Math.max(maxLon, pts[i]);
    minLat = Math.min(minLat, pts[i + 1]); maxLat = Math.max(maxLat, pts[i + 1]);
  }
  return { pts, minLon, minLat, maxLon, maxLat };
}

const own = { latDeg: 30, lonDeg: -88 };

describe("projectBorderPolys", () => {
  it("projects a nearby polyline to an SVG point string (east point → +x, ~0 y)", () => {
    // Two points just east of own, well within 50 NM.
    const out = projectBorderPolys([poly([-88.0, 30.0, -87.9, 30.0])], own, 50, NAV_RADIUS_PX);
    expect(out).toHaveLength(1);
    const coords = out[0].split(" ").map((p) => p.split(",").map(Number));
    // The eastward point sits to the right (x > 0) and near the horizontal (small |y|).
    const [x, y] = coords[1];
    expect(x).toBeGreaterThan(0);
    expect(Math.abs(y)).toBeLessThan(Math.abs(x));
  });

  it("culls a polyline whose bbox is entirely off-view", () => {
    const far = poly([100.0, -40.0, 100.1, -40.0]); // other side of the planet
    expect(projectBorderPolys([far], own, 50, NAV_RADIUS_PX)).toHaveLength(0);
  });

  it("splits a polyline, dropping vertices beyond ~1.6× range", () => {
    // One vertex in range, one absurdly far (same rough bbox direction) → no 2-point segment survives.
    const out = projectBorderPolys([poly([-88.0, 30.0, -80.0, 30.0])], own, 10, NAV_RADIUS_PX);
    // 10 NM range, the -80 lon point is ~415 NM away → dropped; the lone in-range vertex can't form a line.
    expect(out).toHaveLength(0);
  });
});

describe("bundled Natural Earth extract projects real geography", () => {
  it("has Gulf coastline near Mobile at 200 NM", () => {
    expect(coastPolylines({ latDeg: 30.7, lonDeg: -88.0 }, 200, NAV_RADIUS_PX).length).toBeGreaterThan(0);
  });

  it("has state borders near Mobile at 200 NM", () => {
    expect(borderPolylines({ latDeg: 30.7, lonDeg: -88.0 }, 200, NAV_RADIUS_PX).length).toBeGreaterThan(0);
  });

  it("shows nothing in the open ocean (bbox cull)", () => {
    expect(coastPolylines({ latDeg: 0, lonDeg: -140 }, 50, NAV_RADIUS_PX)).toHaveLength(0);
  });
});
