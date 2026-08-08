/*
 * Geographic moving-map geometry (issue #11): own ship at the centre, NORTH UP, linear range
 * rings. This is the deliberate complement to the radar PPI (radarMath.ts), which is heading-up
 * and traffic-only:
 *  - NORTH UP, not heading-up — so airport LABELS stay upright and legible without per-label
 *    counter-rotation, and north is a fixed frame you can read a chart against. The own-ship
 *    mark rotates to show heading instead of the whole map spinning.
 *  - it plots AIRPORTS (bundled OurAirports extract) as well as live traffic — the geographic
 *    context the traffic scope has no room for.
 *
 * Cesium-free and React-free, same as radarMath: the projection and the three filters are all
 * tested here rather than eyeballed on a globe.
 *
 * Honest-data rules encoded here:
 *  - airports come from the bundled extract, which is not a feed and never goes stale — so the
 *    feed's OFFLINE/STALE state freezes only the TRAFFIC layer, never the airports (see the
 *    component: `navStatus.dim` is applied to the traffic group alone).
 *  - traffic comes from the contact map handed in and nowhere else — no history, no dead
 *    reckoning. `navContacts` reuses `blipsFor` so the cap/nearest/military/ghost rules are the
 *    radar's, only north-up.
 */
import type { Airport } from "../data/airports";
import { airportLabelText } from "../data/airports";
import type { Contact, FeedStatus } from "../data/types";
import { bearingDeg, rangeNm } from "./geoRange";
import { blipsFor, type Blip } from "./radarMath";
import type { ScreenXY } from "./trafficProjection";

export const NAV_RANGE_PRESETS_NM: readonly number[] = [10, 25, 50, 100, 200];
export const DEFAULT_NAV_RANGE_NM = 50;
export const NAV_RADIUS_PX = 96;
export const MAX_NAV_AIRPORTS = 30;

export type AirportBlip = {
  ident: string;
  label: string;
  x: number;
  y: number;
  rangeNm: number;
  size: "large" | "medium";
};

export type NavStatus = { text: string | null; dim: boolean };

/**
 * Map-centred pixels: +x east/right, +y down (SVG's own axes), origin = own ship. NORTH UP —
 * bearing alone places a point, with no own-heading term. That missing term is the whole
 * difference from `scopeXY`, and it is why the map does not spin.
 */
export function navXY(o: {
  rangeNm: number;
  bearingDeg: number;
  navRangeNm: number;
  radiusPx?: number;
}): ScreenXY {
  const radiusPx = o.radiusPx ?? NAV_RADIUS_PX;
  const r = (o.rangeNm / o.navRangeNm) * radiusPx;
  const rad = (o.bearingDeg * Math.PI) / 180;
  return { x: r * Math.sin(rad), y: -r * Math.cos(rad) };
}

export function airportBlips(o: {
  airports: Airport[];
  own: { latDeg: number; lonDeg: number };
  navRangeNm: number;
  radiusPx?: number;
  maxAirports?: number;
}): AirportBlip[] {
  const { airports, own, navRangeNm } = o;
  const maxAirports = o.maxAirports ?? MAX_NAV_AIRPORTS;

  const out: AirportBlip[] = [];
  for (const a of airports) {
    const r = rangeNm(own.latDeg, own.lonDeg, a.latDeg, a.lonDeg);
    if (r > navRangeNm) continue;
    const b = bearingDeg(own.latDeg, own.lonDeg, a.latDeg, a.lonDeg);
    const xy = navXY({ rangeNm: r, bearingDeg: b, navRangeNm, radiusPx: o.radiusPx });
    out.push({ ident: a.ident, label: airportLabelText(a), x: xy.x, y: xy.y, rangeNm: r, size: a.size });
  }
  // Nearest first, so the cap drops the far edge rather than an array-order arbitrary subset.
  out.sort((x, y) => x.rangeNm - y.rangeNm);
  return out.slice(0, maxAirports);
}

/** Live traffic, north-up. Reuses the radar's blip logic with the heading term zeroed out. */
export function navContacts(o: {
  contacts: Map<string, Contact>;
  own: { latDeg: number; lonDeg: number };
  navRangeNm: number;
  ghostHex: string | null;
  radiusPx?: number;
  maxBlips?: number;
}): Blip[] {
  return blipsFor({
    contacts: o.contacts,
    own: o.own,
    ownHeadingDeg: 0, // north-up: no rotation
    scopeRangeNm: o.navRangeNm,
    ghostHex: o.ghostHex,
    radiusPx: o.radiusPx ?? NAV_RADIUS_PX,
    maxBlips: o.maxBlips,
  });
}

/**
 * The feed's state, said out loud on the map face. Distinct from `scopeStatus` because only the
 * traffic layer freezes: the airports are bundled, not polled, so they stay honest offline.
 */
export function navStatus(feedStatus: FeedStatus): NavStatus {
  if (feedStatus === "offline") return { text: "FEED OFFLINE · TRAFFIC FROZEN", dim: true };
  if (feedStatus === "stale") return { text: "FEED STALE · TRAFFIC FROZEN", dim: true };
  return { text: null, dim: false };
}
