import { describe, it, expect } from "vitest";
import { isImmersiveActive, showImmersiveToggle } from "./immersive";

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
