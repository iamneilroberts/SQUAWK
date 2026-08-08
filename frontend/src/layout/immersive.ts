/*
 * Pure decisions for the mobile immersive / fullscreen flight mode (#13 follow-up).
 *
 * Same rule as viewport.ts: every decision here is a plain function of a few inputs, so it is
 * unit-tested with no jsdom. The React glue (the toggle button, the Fullscreen API calls, the
 * auto-hide timer) lives in ImmersiveControl.tsx; this file has no React or DOM import.
 *
 * Immersive mode declutters the mobile FLYING view: it hides the browse StatusBar controls and
 * the cockpit strip, repositions the HUD clear of the touch zones, and — while actively flying —
 * fades the informational overlays like a video player. What it NEVER hides: the imagery/traffic
 * attribution (only faded, always reappears — CLAUDE.md data-sources rule), the SIM banner, and
 * the warnings cluster. Those are the honesty + SIM + safety rules and are the last things touched.
 */

import type { Mode } from "../game/machine";

/**
 * Effective immersive mode: the player asked for it (the toggle) AND the layout is one where it
 * makes sense — a narrow viewport actively FLYING. Desktop (`narrow === false`) and every
 * non-FLYING mode fall through to false, so the normal chrome always renders there. This is the
 * single gate the whole feature keys off, so desktop and browse stay byte-for-byte unchanged.
 */
export function isImmersiveActive(requested: boolean, narrow: boolean, mode: Mode): boolean {
  return requested && narrow && mode === "FLYING";
}

/**
 * Whether to offer the immersive toggle button at all: only on a narrow viewport while FLYING.
 * Desktop never shows it; browse never shows it. (Kept separate from isImmersiveActive so the
 * ENTER button can appear before immersive is requested, when `requested` is still false.)
 */
export function showImmersiveToggle(narrow: boolean, mode: Mode): boolean {
  return narrow && mode === "FLYING";
}

/** After this long with no touch interaction, the informational overlays fade (video pattern). */
export const CHROME_IDLE_TIMEOUT_MS = 3000;

/**
 * Whether the INFORMATIONAL overlays (attribution line, HUD readouts, SIM banner, feed status)
 * are shown right now. This is the video-player auto-hide: while actively FLYING they fade after
 * an idle period, and reappear on any tap. It NEVER governs the flight controls (they stay
 * usable) — only the informational chrome.
 *
 * Rules, in order:
 *  - Anything other than FLYING (browse, countdown, PAUSED, ended) → always shown. This is why
 *    attribution is always visible in browse and when paused (the legal safeguard: auto-hiding
 *    attribution is only acceptable because it reliably comes back).
 *  - A live warning (OVERSPEED etc.) → always shown, even when idle (safety overrides the hide).
 *  - Otherwise shown only while a recent interaction is within the idle timeout.
 *
 * The caller supplies `msSinceLastInteraction`; this stays a pure function of numbers so it can be
 * broken-arm tested without a clock or the DOM.
 */
export function overlaysVisible(
  mode: Mode,
  msSinceLastInteraction: number,
  warningActive: boolean,
  idleTimeoutMs: number = CHROME_IDLE_TIMEOUT_MS,
): boolean {
  if (mode !== "FLYING") return true;
  if (warningActive) return true;
  return msSinceLastInteraction < idleTimeoutMs;
}
