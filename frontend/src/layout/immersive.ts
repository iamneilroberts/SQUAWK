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
 * Effective immersive mode: the player asked for it (the toggle) AND is actively FLYING. This
 * means "improved HUD bar + declutter (auto-hide chrome) active", and it now applies on BOTH
 * platforms (owner 2026-08-12: desktop immersive is an opt-in toggle). It deliberately does NOT
 * decide whether the glass cockpit dashboard hides — that stays a `narrow` (mobile-only) call at
 * the DashboardStrip gate, so desktop keeps BOTH the improved bar and the cockpit. Every
 * non-FLYING mode falls through to false, so browse/countdown/paused/ended keep full chrome.
 */
export function isImmersiveActive(requested: boolean, mode: Mode): boolean {
  return requested && mode === "FLYING";
}

/**
 * Whether to offer the immersive toggle button at all: while FLYING, on either platform. Mobile
 * has always shown it; desktop now shows it too so the player can opt in (owner 2026-08-12).
 * Browse/countdown/paused/ended never show it. (Kept separate from isImmersiveActive so the
 * ENTER button can appear before immersive is requested, when `requested` is still false.)
 */
export function showImmersiveToggle(mode: Mode): boolean {
  return mode === "FLYING";
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
