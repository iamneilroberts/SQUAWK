/*
 * Chevron billboard icons: colour, rotation, and the canvas that draws the shape.
 *
 * The canvas cache is lazy-initialized (not at module load) so `contactColor` and
 * `contactRotationRad` stay importable in vitest, which has no `document`.
 */
import type { Contact } from "../data/types";

/** Military contacts are amber; everything else is cyan (LORAN palette). */
export function contactColor(c: Contact): string {
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

const cache = new Map<string, HTMLCanvasElement>();

/** 32x32 stroked chevron pointing up, in the given colour. Cached per colour. */
export function makeChevronCanvas(colorHex: string): HTMLCanvasElement {
  const cached = cache.get(colorHex);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.id = colorHex; // stable identity contactBillboards.ts passes to Billboard.setImage
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.lineTo(28, 26);
    ctx.lineTo(16, 20);
    ctx.lineTo(4, 26);
    ctx.closePath();
    ctx.stroke();
  }

  cache.set(colorHex, canvas);
  return canvas;
}
