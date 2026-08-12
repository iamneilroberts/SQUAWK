import { describe, it, expect } from "vitest";
import {
  isImmersiveActive, showImmersiveToggle, overlaysVisible, CHROME_IDLE_TIMEOUT_MS,
} from "./immersive";

describe("isImmersiveActive", () => {
  it("is true when requested AND flying (mobile — unchanged)", () => {
    expect(isImmersiveActive(true, "FLYING")).toBe(true);
  });
  it("is true on desktop too when requested and flying (owner 2026-08-12 opt-in)", () => {
    // Desktop immersive is now an opt-in that adds the improved HUD bar + declutter. Whether the
    // glass cockpit hides is decided separately (by `narrow`), so this stays platform-agnostic.
    expect(isImmersiveActive(true, "FLYING")).toBe(true);
  });
  it("is false in any non-flying mode, so browse/paused/ended keep full chrome", () => {
    // Broken arm: ignoring mode would strip the browse StatusBar controls.
    expect(isImmersiveActive(true, "BROWSE")).toBe(false);
    expect(isImmersiveActive(true, "PAUSED")).toBe(false);
    expect(isImmersiveActive(true, "ENDED")).toBe(false);
    expect(isImmersiveActive(true, "COUNTDOWN")).toBe(false);
  });
  it("is false until the player actually requests it", () => {
    expect(isImmersiveActive(false, "FLYING")).toBe(false);
  });
});

describe("showImmersiveToggle", () => {
  it("offers the toggle while flying (both platforms — desktop opt-in included)", () => {
    expect(showImmersiveToggle("FLYING")).toBe(true);
  });
  it("never offers it outside flight", () => {
    // Broken arm: showing it in browse/paused would put a fullscreen chip on the browse globe.
    expect(showImmersiveToggle("BROWSE")).toBe(false);
    expect(showImmersiveToggle("PAUSED")).toBe(false);
    expect(showImmersiveToggle("ENDED")).toBe(false);
    expect(showImmersiveToggle("COUNTDOWN")).toBe(false);
  });
});

describe("overlaysVisible (video-player auto-hide)", () => {
  it("hides the informational overlays when flying, idle past the timeout, no warning", () => {
    // Broken arm: a version that always returned true would never fade for the clean view.
    expect(overlaysVisible("FLYING", 5000, false)).toBe(false);
  });
  it("shows them again right after a tap (within the idle timeout)", () => {
    expect(overlaysVisible("FLYING", 500, false)).toBe(true);
  });
  it("shows them the instant the idle window has not yet elapsed", () => {
    expect(overlaysVisible("FLYING", CHROME_IDLE_TIMEOUT_MS - 1, false)).toBe(true);
    expect(overlaysVisible("FLYING", CHROME_IDLE_TIMEOUT_MS, false)).toBe(false);
  });
  it("keeps attribution visible when PAUSED, even when long idle (legal safeguard)", () => {
    expect(overlaysVisible("PAUSED", 999999, false)).toBe(true);
  });
  it("always shows overlays in BROWSE", () => {
    expect(overlaysVisible("BROWSE", 999999, false)).toBe(true);
  });
  it("shows overlays while a warning is live even when idle (safety overrides the hide)", () => {
    // Broken arm: dropping the warning override would hide an OVERSPEED annunciator mid-fade.
    expect(overlaysVisible("FLYING", 999999, true)).toBe(true);
  });
});
