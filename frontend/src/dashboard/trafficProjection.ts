/*
 * Which live contacts get a windscreen tag, and where on the screen it goes (spec D-3).
 *
 * Cesium-free by construction: the caller injects `project`, a world -> window function, and
 * this module does the rest with plain arithmetic. That is what makes every culling and
 * decluttering rule below a unit test rather than a thing you squint at in a browser.
 *
 * Honest-data rules encoded here:
 *  - the ONLY source of tags is the contact map handed in. There is no cache, no last-known
 *    position, no dead reckoning; a contact that left the feed has no tag on the next call.
 *  - a contact without `alt_geom` gets no tag, exactly as it gets no billboard
 *    (`contactHeightM`): its 3D position is unknown, and putting it at a plausible baro height
 *    would place a real aeroplane somewhere it is not.
 *  - fields the feed does not carry render as an em-dash, never as a guess.
 */
import type { Contact } from "../data/types";
// data/contactGeo.ts, NOT globe/contactBillboards.ts: the latter imports Cesium, and importing
// it here would make this module transitively Cesium-dependent (see this task's preamble).
import { contactHeightM } from "../data/contactGeo";
import { EM_DASH } from "../hud/format";
import { mToFt } from "../sim/units";
import { rangeNm } from "./geoRange";

export type ScreenXY = { x: number; y: number };
/** Injected by the render layer. Returns null when the point cannot be put on screen. */
export type ProjectFn = (lonDeg: number, latDeg: number, heightM: number) => ScreenXY | null;

export type TrafficTag = {
  hex: string;
  x: number;
  y: number;
  rangeNm: number;
  label: string;
  typeLine: string;
  altLine: string;
  military: boolean;
  ghost: boolean;
  /** The nearest 3 tags get the full label/type/alt box; the rest are bare markers. */
  detailed: boolean;
};

/** Keep tags clear of the screen edge, where half a tag reads as a glitch. */
export const TAG_MARGIN_PX = 24;
/** Two tags closer than this collapse into one — the nearer contact wins. */
export const TAG_MIN_SPACING_PX = 34;
export const TAG_MAX_COUNT = 12;
/** Past this the tag is unreadable clutter and the radar scope is the right instrument. */
export const TAG_MAX_RANGE_NM = 40;

export function tagLabel(c: Contact): string {
  const flight = c.flight?.trim();
  return flight ? flight : c.hex.toUpperCase();
}

export function tagTypeLine(c: Contact): string {
  return c.t ?? EM_DASH;
}

export function tagAltLine(c: Contact): string {
  const h = contactHeightM(c);
  return h === null ? EM_DASH : `${Math.round(mToFt(h))} FT`;
}

export function projectTraffic(input: {
  contacts: Map<string, Contact>;
  own: { latDeg: number; lonDeg: number };
  project: ProjectFn;
  viewport: { widthPx: number; heightPx: number };
  ghostHex: string | null;
  maxRangeNm?: number;
  maxCount?: number;
}): TrafficTag[] {
  const {
    contacts, own, project, viewport, ghostHex,
    maxRangeNm = TAG_MAX_RANGE_NM, maxCount = TAG_MAX_COUNT,
  } = input;

  const candidates: TrafficTag[] = [];
  for (const [hex, c] of contacts) {
    const heightM = contactHeightM(c);
    if (heightM === null) continue;

    const r = rangeNm(own.latDeg, own.lonDeg, c.lat, c.lon);
    if (r > maxRangeNm) continue;

    const xy = project(c.lon, c.lat, heightM);
    if (xy === null) continue;
    if (
      xy.x < TAG_MARGIN_PX || xy.x > viewport.widthPx - TAG_MARGIN_PX ||
      xy.y < TAG_MARGIN_PX || xy.y > viewport.heightPx - TAG_MARGIN_PX
    ) continue;

    candidates.push({
      hex,
      x: xy.x,
      y: xy.y,
      rangeNm: r,
      label: tagLabel(c),
      typeLine: tagTypeLine(c),
      altLine: tagAltLine(c),
      military: c.military,
      ghost: hex === ghostHex,
      detailed: false, // filled in below once the nearest-first order is settled
    });
  }

  // Nearest first, then drop anything that would land on top of a nearer tag, then cap.
  candidates.sort((a, b) => a.rangeNm - b.rangeNm);
  const kept: TrafficTag[] = [];
  for (const tag of candidates) {
    if (kept.length >= maxCount) break;
    const collides = kept.some(
      (k) => Math.hypot(k.x - tag.x, k.y - tag.y) < TAG_MIN_SPACING_PX,
    );
    if (!collides) kept.push(tag);
  }
  // kept is still nearest-first: the closest 3 get the full label box, the rest a bare marker.
  kept.forEach((tag, i) => { tag.detailed = i < 3; });
  return kept;
}
