import { describe, it, expect } from "vitest";
import { fullscreenSupported, isStandalone, shouldShowInstallHint } from "./fullscreen";

describe("fullscreenSupported", () => {
  it("is true when the element implements requestFullscreen (Android Chrome / desktop)", () => {
    expect(fullscreenSupported({ requestFullscreen: () => Promise.resolve() })).toBe(true);
  });
  it("is false on iOS Safari, where requestFullscreen is absent on non-video elements", () => {
    // Broken arm: assuming support would call a missing method and throw on the iPhone.
    expect(fullscreenSupported({})).toBe(false);
    expect(fullscreenSupported({ requestFullscreen: undefined })).toBe(false);
  });
  it("is false for a null/undefined element", () => {
    expect(fullscreenSupported(null)).toBe(false);
    expect(fullscreenSupported(undefined)).toBe(false);
  });
});

describe("isStandalone", () => {
  it("is true via the legacy iOS navigator.standalone flag", () => {
    expect(isStandalone(true, false)).toBe(true);
  });
  it("is true via the (display-mode: standalone) media query", () => {
    expect(isStandalone(undefined, true)).toBe(true);
  });
  it("is false in a normal browser tab", () => {
    expect(isStandalone(false, false)).toBe(false);
    expect(isStandalone(undefined, false)).toBe(false);
  });
});

describe("shouldShowInstallHint", () => {
  it("shows the iOS Add-to-Home-Screen hint only when true fullscreen is unavailable", () => {
    expect(shouldShowInstallHint(false, false)).toBe(true);
  });
  it("never nags a platform that has the real Fullscreen API", () => {
    // Broken arm: showing it on Android/desktop would nag users who already got true fullscreen.
    expect(shouldShowInstallHint(true, false)).toBe(false);
  });
  it("suppresses the hint once installed as a standalone PWA", () => {
    expect(shouldShowInstallHint(false, true)).toBe(false);
  });
});
