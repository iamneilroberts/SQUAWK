/*
 * Fullscreen API wrapper + the honest iOS degradation (#13 follow-up, "true fullscreen like a
 * video"). The DECISIONS are pure and unit-tested here; the two impure calls (requestFullscreen /
 * exitFullscreen) are thin, browser-verified only.
 *
 * Platform reality this file encodes:
 *  - Android Chrome / desktop implement `element.requestFullscreen()` — the same call a <video>
 *    player uses — and truly hide the browser UI. `fullscreenSupported` returns true and we call it.
 *  - iOS Safari on iPhone does NOT allow requestFullscreen on a non-<video> element. There is no
 *    honest way to make our Cesium canvas true-fullscreen there. `fullscreenSupported` returns
 *    false, we degrade to the in-app declutter with NO error, and we offer a one-time "Add to Home
 *    Screen" hint so the owner can get a chromeless standalone PWA — the only real fullscreen iOS
 *    gives a canvas app. When already installed (standalone) the hint is suppressed.
 */

/**
 * Does this environment implement the Fullscreen API on an element? True on Android Chrome and
 * desktop, false on iOS Safari (iPhone) — where `requestFullscreen` is simply absent on non-video
 * elements. Takes the element so the branch is testable with a plain object, no globals.
 */
export function fullscreenSupported(el: { requestFullscreen?: unknown } | null | undefined): boolean {
  return !!el && typeof el.requestFullscreen === "function";
}

/**
 * Whether the app is running as an installed, chromeless standalone PWA. iOS exposes the legacy
 * `navigator.standalone`; the cross-platform signal is the `(display-mode: standalone)` media
 * query. Either being true means the browser chrome is already gone, so the install hint is moot.
 */
export function isStandalone(
  navigatorStandalone: boolean | undefined,
  displayModeStandalone: boolean,
): boolean {
  return navigatorStandalone === true || displayModeStandalone;
}

/**
 * Whether to surface the one-time "Add to Home Screen for fullscreen" hint. Only when true
 * fullscreen is unavailable (iOS) AND we are not already an installed standalone PWA. On every
 * platform that has the real Fullscreen API this is false — those users get true fullscreen, not a
 * nag.
 */
export function shouldShowInstallHint(fullscreenOk: boolean, standalone: boolean): boolean {
  return !fullscreenOk && !standalone;
}

/**
 * Request true fullscreen on the given element (the app root — the same call a video player makes).
 * A no-op that degrades silently where the API is absent (iOS) or the browser refuses (must be a
 * user gesture; the caller wires this to the toggle tap). Never throws into the UI.
 */
export async function requestAppFullscreen(el: HTMLElement | null): Promise<void> {
  if (!fullscreenSupported(el) || !el) return;
  try {
    await el.requestFullscreen();
  } catch {
    /* user gesture / permission refused — the in-app declutter still applies (honest degrade) */
  }
}

/** Leave true fullscreen if we are in it; a no-op otherwise. Never throws into the UI. */
export async function exitAppFullscreen(doc: Document): Promise<void> {
  if (!doc.fullscreenElement || typeof doc.exitFullscreen !== "function") return;
  try {
    await doc.exitFullscreen();
  } catch {
    /* nothing sensible to do — swallow so the toggle can still flip the in-app state */
  }
}
