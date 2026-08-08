import { describe, it, expect } from "vitest";
import {
  MOBILE_BREAKPOINT_PX, isNarrowViewport, isPortrait, shouldShowRotateCard,
} from "./viewport";

describe("isNarrowViewport", () => {
  it("treats a real laptop/desktop width as wide (desktop unchanged)", () => {
    expect(isNarrowViewport(1280)).toBe(false);
    expect(isNarrowViewport(1920)).toBe(false);
    expect(isNarrowViewport(MOBILE_BREAKPOINT_PX)).toBe(false); // the breakpoint itself is wide
  });
  it("treats a phone — in either orientation — as narrow", () => {
    expect(isNarrowViewport(390)).toBe(true); // portrait phone width
    expect(isNarrowViewport(844)).toBe(true); // landscape phone width
    expect(isNarrowViewport(932)).toBe(true); // widest current phone, still narrow
  });
  it("uses 1024 (Tailwind lg) as the boundary", () => {
    expect(MOBILE_BREAKPOINT_PX).toBe(1024);
    expect(isNarrowViewport(1023)).toBe(true);
    expect(isNarrowViewport(1024)).toBe(false);
  });
});

describe("isPortrait", () => {
  it("is true only when taller than wide", () => {
    expect(isPortrait(390, 844)).toBe(true);
    expect(isPortrait(844, 390)).toBe(false);
  });
  it("treats a square viewport as not portrait", () => {
    expect(isPortrait(500, 500)).toBe(false);
  });
});

describe("shouldShowRotateCard", () => {
  it("shows on a narrow device held in portrait", () => {
    expect(shouldShowRotateCard(390, 844)).toBe(true);
  });
  it("never shows on a phone already in landscape", () => {
    expect(shouldShowRotateCard(844, 390)).toBe(false);
  });
  it("never shows on a wide desktop, even a tall thin window", () => {
    expect(shouldShowRotateCard(1920, 1080)).toBe(false);
    expect(shouldShowRotateCard(1200, 1600)).toBe(false); // wide enough → not narrow → no card
  });
});
