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

// The former overlaysVisible() idle-timer auto-hide was removed 2026-08-13: in a flight game the
// pilot touches the controls constantly, so "reveal on any tap" never let the chrome stay hidden.
// ImmersiveControl now hides chrome whenever mode === "FLYING" and reveals it only on pause (via
// the always-visible MENU button) or a live warning — no clock, no pointer listeners.
