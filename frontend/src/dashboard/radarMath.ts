/*
 * PPI scope geometry (spec D-4): own ship at the centre, heading up, linear range rings.
 * Cesium-free and React-free — the scope is a coordinate transform plus three filters, and all
 * three are tested here rather than eyeballed on a globe.
 *
 * Honest-data rules encoded here:
 *  - blips come from the contact map handed in and from nowhere else. No plot history, no
 *    extrapolation, no synthetic returns.
 *  - a contact whose ALTITUDE is unknown is still plotted: a PPI plot needs lat/lon, which the
 *    feed gave us. (That is different from the globe billboards, which need a 3D position and so
 *    skip a contact without alt_geom.)
 *  - `scopeStatus` turns the feed's own state into a statement on the face, so an empty scope is
 *    never ambiguous between "no traffic" and "no feed".
 */
import type { Contact, FeedStatus } from "../data/types";
import { bearingDeg, rangeNm } from "./geoRange";
import type { ScreenXY } from "./trafficProjection";

export const RANGE_PRESETS_NM: readonly number[] = [10, 40, 80, 150, 250];
export const DEFAULT_RANGE_NM = 40;
export const SCOPE_RADIUS_PX = 96;
export const MAX_BLIPS = 60;

export type Blip = {
  hex: string;
  x: number;
  y: number;
  rangeNm: number;
  military: boolean;
  ghost: boolean;
};

export type ScopeStatus = { text: string | null; dim: boolean };

/** Scope-centred pixels: +x right, +y down (SVG's own axes), origin = own ship. */
export function scopeXY(o: {
  rangeNm: number;
  bearingDeg: number;
  ownHeadingDeg: number;
  scopeRangeNm: number;
  radiusPx?: number;
}): ScreenXY {
  const radiusPx = o.radiusPx ?? SCOPE_RADIUS_PX;
  const r = (o.rangeNm / o.scopeRangeNm) * radiusPx;
  const relRad = ((o.bearingDeg - o.ownHeadingDeg) * Math.PI) / 180;
  return { x: r * Math.sin(relRad), y: -r * Math.cos(relRad) };
}

/** Three rings at thirds of the selected range; labels are whole NM, never fake decimals. */
export function ringsFor(
  scopeRangeNm: number,
  radiusPx: number = SCOPE_RADIUS_PX,
): { radiusPx: number; labelNm: number }[] {
  return [1, 2, 3].map((i) => ({
    radiusPx: (radiusPx * i) / 3,
    labelNm: Math.round((scopeRangeNm * i) / 3),
  }));
}

export function blipsFor(o: {
  contacts: Map<string, Contact>;
  own: { latDeg: number; lonDeg: number };
  ownHeadingDeg: number;
  scopeRangeNm: number;
  ghostHex: string | null;
  radiusPx?: number;
  maxBlips?: number;
}): Blip[] {
  const { contacts, own, ownHeadingDeg, scopeRangeNm, ghostHex } = o;
  const maxBlips = o.maxBlips ?? MAX_BLIPS;

  const out: Blip[] = [];
  for (const [hex, c] of contacts) {
    const r = rangeNm(own.latDeg, own.lonDeg, c.lat, c.lon);
    if (r > scopeRangeNm) continue;
    const b = bearingDeg(own.latDeg, own.lonDeg, c.lat, c.lon);
    const xy = scopeXY({
      rangeNm: r, bearingDeg: b, ownHeadingDeg, scopeRangeNm, radiusPx: o.radiusPx,
    });
    out.push({
      hex, x: xy.x, y: xy.y, rangeNm: r, military: c.military, ghost: hex === ghostHex,
    });
  }
  // Nearest first, so the cap drops the far edge of a 250 NM sweep rather than a Map-order
  // arbitrary subset.
  out.sort((a, b) => a.rangeNm - b.rangeNm);
  return out.slice(0, maxBlips);
}

/** The feed's state, said out loud on the scope face. Same semantics as the status-bar chip. */
export function scopeStatus(feedStatus: FeedStatus): ScopeStatus {
  if (feedStatus === "offline") return { text: "RADAR OFFLINE · BLIPS FROZEN", dim: true };
  if (feedStatus === "stale") return { text: "FEED STALE · BLIPS FROZEN", dim: true };
  return { text: null, dim: false };
}

/**
 * The feed is polled home-centred at a fixed radius (`radiusNm` in the store), but the scope
 * dials out to 250 NM aircraft-centred. Beyond the feed's radius, an empty ring is not confirmed
 * empty sky — it is simply unpolled — so the face has to say so rather than imply an unqualified
 * "nothing out there".
 */
export function coverageNote(scopeRangeNm: number, feedRadiusNm: number): string | null {
  if (scopeRangeNm <= feedRadiusNm) return null;
  return `FEED ${feedRadiusNm} NM`;
}
