import { describe, it, expect } from "vitest";
import {
  isImmersiveActive, showImmersiveToggle, overlaysVisible, CHROME_IDLE_TIMEOUT_MS,
} from "./immersive";

describe("isImmersiveActive", () => {
  it("is true only when requested AND narrow AND flying", () => {
    expect(isImmersiveActive(true, true, "FLYING")).toBe(true);
  });
  it("is false on a wide (desktop) viewport even when requested and flying", () => {
    // Broken arm: a version that ignored `narrow` would declutter the desktop.
    expect(isImmersiveActive(true, false, "FLYING")).toBe(false);
  });
  it("is false in any non-flying mode, so browse/paused/ended keep full chrome", () => {
    // Broken arm: ignoring mode would strip the browse StatusBar controls.
    expect(isImmersiveActive(true, true, "BROWSE")).toBe(false);
    expect(isImmersiveActive(true, true, "PAUSED")).toBe(false);
    expect(isImmersiveActive(true, true, "ENDED")).toBe(false);
    expect(isImmersiveActive(true, true, "COUNTDOWN")).toBe(false);
  });
  it("is false until the player actually requests it", () => {
    expect(isImmersiveActive(false, true, "FLYING")).toBe(false);
  });
});

describe("showImmersiveToggle", () => {
  it("offers the toggle only on a narrow viewport while flying", () => {
    expect(showImmersiveToggle(true, "FLYING")).toBe(true);
  });
  it("never offers it on desktop or outside flight", () => {
    expect(showImmersiveToggle(false, "FLYING")).toBe(false);
    expect(showImmersiveToggle(true, "BROWSE")).toBe(false);
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
