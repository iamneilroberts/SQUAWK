/*
 * Where to place the identify callout panel (#86) relative to the tapped target's projected
 * screen position, so the panel sits NEXT TO the target instead of pinned to a fixed corner.
 *
 * Pure arithmetic — no Cesium here. The caller (IdentifiedContactCallout) projects the target's
 * world position to window pixels using the same pattern as globe/TrafficOverlay.tsx, then hands
 * the result (or null, if the target is behind the camera / off-screen) to this function.
 */

export type ScreenPoint = { x: number; y: number };
export type ViewportSize = { widthPx: number; heightPx: number };
export type PanelSize = { widthPx: number; heightPx: number };
export type CalloutMargins = { top: number; right: number; bottom: number; left: number };

/** Panel left edge sits this far right of the chevron, clear of the marker itself. */
const OFFSET_X = 24;
/** Panel top sits this far above the chevron's y, so the point lands roughly mid-panel. */
const OFFSET_Y = 40;

/** Fixed panel footprint used for clamping (desktop width; mobile uses the same estimate). */
export const CALLOUT_PANEL_SIZE: PanelSize = { widthPx: 200, heightPx: 260 };

/** Desktop margins: clear of the top HUD bar and edges. */
export const CALLOUT_MARGINS_DESKTOP: CalloutMargins = { top: 72, right: 12, bottom: 24, left: 12 };
/** Mobile margins: taller top clearance (safe-area HUD) and a bottom control row. */
export const CALLOUT_MARGINS_MOBILE: CalloutMargins = { top: 100, right: 12, bottom: 130, left: 12 };

/**
 * `projected === null` (target not on screen: behind the camera, or worldToWindowCoordinates
 * failed) falls back to the top-left corner — readable and dismissible rather than hidden.
 * Otherwise the panel is offset down-right of the point, then clamped so it never overflows
 * the viewport and never sits inside the given margins.
 */
export function calloutAnchor(
  projected: ScreenPoint | null,
  viewport: ViewportSize,
  panel: PanelSize,
  margins: CalloutMargins,
): { leftPx: number; topPx: number } {
  if (projected === null) {
    return { leftPx: margins.left, topPx: margins.top };
  }

  const minLeft = margins.left;
  const maxLeft = Math.max(minLeft, viewport.widthPx - panel.widthPx - margins.right);
  const minTop = margins.top;
  const maxTop = Math.max(minTop, viewport.heightPx - panel.heightPx - margins.bottom);

  const leftPx = Math.min(Math.max(projected.x + OFFSET_X, minLeft), maxLeft);
  const topPx = Math.min(Math.max(projected.y - OFFSET_Y, minTop), maxTop);
  return { leftPx, topPx };
}
