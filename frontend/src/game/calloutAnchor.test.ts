import { describe, it, expect } from "vitest";
import { calloutAnchor, CALLOUT_PANEL_SIZE } from "./calloutAnchor";

const viewport = { widthPx: 1200, heightPx: 800 };
const panel = CALLOUT_PANEL_SIZE; // { widthPx: 200, heightPx: 260 }
const margins = { top: 72, right: 12, bottom: 24, left: 12 };

describe("calloutAnchor (#86)", () => {
  it("falls back to the top-left corner when the target is not projectable", () => {
    expect(calloutAnchor(null, viewport, panel, margins)).toEqual({ leftPx: 12, topPx: 72 });
  });

  it("offsets the panel down-right of an on-screen point, fully within the viewport", () => {
    const result = calloutAnchor({ x: 600, y: 400 }, viewport, panel, margins);
    expect(result).toEqual({ leftPx: 624, topPx: 360 });
    expect(result.leftPx).toBeGreaterThanOrEqual(margins.left);
    expect(result.leftPx + panel.widthPx).toBeLessThanOrEqual(viewport.widthPx - margins.right);
    expect(result.topPx).toBeGreaterThanOrEqual(margins.top);
    expect(result.topPx + panel.heightPx).toBeLessThanOrEqual(viewport.heightPx - margins.bottom);
  });

  it("pulls the panel left when the target is near the right edge, so it doesn't overflow", () => {
    const result = calloutAnchor({ x: 1190, y: 400 }, viewport, panel, margins);
    expect(result).toEqual({ leftPx: 988, topPx: 360 });
    expect(result.leftPx + panel.widthPx).toBeLessThanOrEqual(viewport.widthPx - margins.right);
  });

  it("pulls the panel up when the target is near the bottom edge, so it doesn't overflow", () => {
    const result = calloutAnchor({ x: 600, y: 780 }, viewport, panel, margins);
    expect(result).toEqual({ leftPx: 624, topPx: 516 });
    expect(result.topPx + panel.heightPx).toBeLessThanOrEqual(viewport.heightPx - margins.bottom);
  });

  it("pushes the panel below the top margin when the target is near the top edge", () => {
    const result = calloutAnchor({ x: 600, y: 50 }, viewport, panel, margins);
    expect(result).toEqual({ leftPx: 624, topPx: 72 });
    expect(result.topPx).toBeGreaterThanOrEqual(margins.top);
  });

  it("never inverts the clamp range when the panel is larger than the viewport", () => {
    const tinyViewport = { widthPx: 150, heightPx: 150 };
    const result = calloutAnchor({ x: 60, y: 60 }, tinyViewport, panel, margins);
    expect(result.leftPx).toBe(margins.left);
    expect(result.topPx).toBe(margins.top);
  });
});
