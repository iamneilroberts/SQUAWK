/*
 * Pure viewport/breakpoint decisions for the responsive layout (mobile sub-feature 1).
 *
 * Everything here is a plain function of the viewport size, so it is unit-tested with no
 * jsdom (spec §8). The React glue that reads `window.innerWidth`/`innerHeight` lives in
 * `useViewport.ts`; this file has no React import on purpose.
 *
 * Breakpoint choice (decisions.md 2026-08-07): a single width breakpoint of 1024 px — below
 * it the browse sidebar collapses to a drawer, the cockpit strip defaults folded and stacks,
 * and the HUD shrinks. 1024 is Tailwind's `lg`; it captures every phone (portrait AND
 * landscape, whose widest is ~932 px) while leaving real laptops/desktops (>=1024 px)
 * byte-for-byte unchanged. Landscape-first is why we key off width, not height: the wide
 * axis is the flight axis, and a landscape phone is still "narrow" by this rule.
 */

import type { Mode } from "../game/machine";

/** Below this CSS-px width the layout reflows for mobile. At or above it, desktop is unchanged. */
export const MOBILE_BREAKPOINT_PX = 1024;

/** A narrow viewport gets the mobile reflow (drawer, folded/stacked cockpit, shrunk HUD). */
export function isNarrowViewport(width: number): boolean {
  return width < MOBILE_BREAKPOINT_PX;
}

/** Portrait when the screen is taller than it is wide. Landscape (incl. square) is false. */
export function isPortrait(width: number, height: number): boolean {
  return height > width;
}

/**
 * The "ROTATE TO LANDSCAPE" card shows only when a NARROW device is held in PORTRAIT *and the
 * player is not in BROWSE*: a wide desktop never sees it, a phone already in landscape never
 * sees it, and — critically — it never covers the browse contact list, where you pick a plane
 * in portrait via the vertical drawer. It is the flight display that needs the wide screen.
 */
export function shouldShowRotateCard(width: number, height: number, mode: Mode): boolean {
  return mode !== "BROWSE" && isNarrowViewport(width) && isPortrait(width, height);
}
