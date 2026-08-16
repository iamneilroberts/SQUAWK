/*
 * Type-shaped billboard icons: colour, rotation, shape, and the canvas that draws it.
 *
 * The canvas cache is lazy-initialized (not at module load) so `contactColor`,
 * `contactRotationRad`, and `contactShape` stay importable in vitest, which has no `document`.
 */
import type { Contact } from "../data/types";
import type { AircraftClassId } from "../mission/types";
import { checkEligibility, resolveClass } from "../takeover/eligibility";

/** Muted gray for contacts that fail the takeover gate (#55) — dimmed, not hidden. */
export const INELIGIBLE_COLOR = "#5a6b70";

/**
 * Ineligible contacts (checkEligibility, computed live — no cached verdict) render dimmed
 * gray so eligible ones stand out; among eligible contacts, military is amber and civil is
 * cyan (LORAN palette).
 */
export function contactColor(c: Contact): string {
  if (!checkEligibility(c).eligible) return INELIGIBLE_COLOR;
  return c.military ? "#ffb000" : "#5fd7e0";
}

/**
 * Cesium billboard `rotation` is counter-clockwise-positive; ADS-B `track` is degrees
 * clockwise from north. Negating converts one to the other. `null` (no heading data)
 * renders upright, not rotated by some invented default. `track: 0` is a real heading
 * (due north) and must NOT be treated as "no track" just because it's falsy.
 */
export function contactRotationRad(track: number | null): number {
  if (track === null) return 0;
  return -track * (Math.PI / 180);
}

/**
 * Aircraft planform silhouette for a contact's billboard icon. Covers the flyable classes plus
 * a generic fallback for anything unresolved (ground rule 3 — unknown renders as unknown, not
 * invented).
 */
export type ContactShape = "light" | "narrowbody" | "regional" | "turboprop" | "fighter" | "helicopter" | "generic";

/*
 * Top-down planform paths, copied verbatim from LORAN's globe/icons.ts `PATHS` (64x64
 * viewBox, nose at top/y=0, tail at bottom) so Cesium's billboard rotation maps directly to
 * ADS-B `track` the same way LORAN's does. Only the fixed-wing shapes are copied from LORAN;
 * "helicopter" (#30) is a simple hand-drawn silhouette — rotor disc, cabin, tail boom, tail
 * rotor — not lifted from LORAN.
 */
const PATHS: Record<ContactShape, string> = {
  narrowbody:
    "M32 2 L34.5 11 L35 26 L61 43 L61 48 L35 39 L34 51 L42 58 L42 61 L32 57.5 L22 61 L22 58 L30 51 L29 39 L3 48 L3 43 L29 26 L29.5 11 Z",
  regional:
    "M32 4 L34 12 L34.5 28 L57 44 L57 48 L34.5 40 L34 50 L41 57 L41 60 L32 56.5 L23 60 L23 57 L30 50 L29.5 40 L7 48 L7 44 L29.5 28 L30 12 Z",
  turboprop:
    "M32 3 L34.5 12 L35 28 L35 33 L60 33 L60 38 L35 38 L34.5 52 L43 59 L43 62 L32 58 L21 62 L21 59 L29.5 52 L29 38 L4 38 L4 33 L29 33 L29.5 12 Z" +
    "M44 28 L47 28 L47 43 L44 43 Z M17 28 L20 28 L20 43 L17 43 Z",
  fighter:
    "M32 1 L34 14 L35 30 L52 48 L52 54 L35 46 L34.5 54 L40 60 L40 62 L32 58 L24 62 L24 60 L29.5 54 L29 46 L12 54 L12 48 L29 30 L30 14 Z",
  light:
    "M32 6 L34 14 L34 27 L56 27 L56 32 L34 32 L34 48 L42 55 L42 58 L32 55 L22 58 L22 55 L30 48 L30 32 L8 32 L8 27 L30 27 L30 14 Z",
  helicopter:
    "M46 16 L42 26 L32 30 L22 26 L18 16 L22 6 L32 2 L42 6 Z" + // rotor disc (octagon)
    " M36 18 L37 26 L34 34 L30 34 L27 26 L28 18 Z" + // cabin
    " M31 34 L33 34 L33 56 L31 56 Z" + // tail boom
    " M32 54 L36 58 L32 62 L28 58 Z", // tail rotor
  generic:
    "M32 3 L34 12 L34.5 30 L56 45 L56 49 L34.5 41 L34 52 L41 58 L41 61 L32 57 L23 61 L23 58 L30 52 L29.5 41 L8 49 L8 45 L29.5 30 L30 12 Z",
};

/** Which flyable class's silhouette a resolved contact should use. */
const CLASS_TO_SHAPE: Record<AircraftClassId, ContactShape> = {
  c172s: "light",
  b738: "narrowbody",
  biz: "regional",
  tprop: "turboprop",
  f5e: "fighter",
  r44: "helicopter",
  t6: "turboprop",
  c130: "turboprop",
};

/**
 * Pure mapping from a contact's real ICAO type (via `resolveClass`, the same class resolver
 * the takeover gate uses) to a billboard silhouette. Unsupported/missing types get "generic" —
 * never a guessed shape.
 */
export function contactShape(c: Contact): ContactShape {
  const resolution = resolveClass(c);
  if (!resolution.supported) return "generic";
  return CLASS_TO_SHAPE[resolution.classId];
}

const cache = new Map<string, HTMLCanvasElement>();

/** Canvas size the 64-unit LORAN viewBox is scaled into. */
const ICON_SIZE = 40;
const ICON_SCALE = ICON_SIZE / 64;

/** Stroked type silhouette in the given colour. Cached per shape+colour pair. */
export function makeIconCanvas(shape: ContactShape, colorHex: string): HTMLCanvasElement {
  const key = `${shape}|${colorHex}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.id = key; // stable identity contactBillboards.ts passes to Billboard.setImage
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 2 / ICON_SCALE; // stays ~2px after the scale below
    ctx.lineJoin = "round";
    ctx.scale(ICON_SCALE, ICON_SCALE);
    ctx.stroke(new Path2D(PATHS[shape]));
  }

  cache.set(key, canvas);
  return canvas;
}
