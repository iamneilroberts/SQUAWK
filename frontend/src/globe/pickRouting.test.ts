import { describe, it, expect } from "vitest";
import { resolvePickAction } from "./pickRouting";

describe("resolvePickAction (#86)", () => {
  it("BROWSE routes a known contact to select", () => {
    expect(resolvePickAction("BROWSE", "abc", true)).toEqual({ kind: "select", hex: "abc" });
  });
  it("BROWSE deselects on empty or unknown pick", () => {
    expect(resolvePickAction("BROWSE", null, false)).toEqual({ kind: "select", hex: null });
    expect(resolvePickAction("BROWSE", "ghost", false)).toEqual({ kind: "select", hex: null });
  });
  it("FLYING routes a known contact to identify (not select)", () => {
    expect(resolvePickAction("FLYING", "abc", true)).toEqual({ kind: "identify", hex: "abc" });
  });
  it("PAUSED routes a known contact to identify", () => {
    expect(resolvePickAction("PAUSED", "abc", true)).toEqual({ kind: "identify", hex: "abc" });
  });
  it("FLYING dismisses on empty space", () => {
    expect(resolvePickAction("FLYING", null, false)).toEqual({ kind: "identify", hex: null });
  });
  it("FLYING dismisses (does not identify) a hidden/unknown hex", () => {
    expect(resolvePickAction("FLYING", "hidden", false)).toEqual({ kind: "identify", hex: null });
  });
  it("COUNTDOWN and ENDED do nothing", () => {
    expect(resolvePickAction("COUNTDOWN", "abc", true)).toEqual({ kind: "none" });
    expect(resolvePickAction("ENDED", "abc", true)).toEqual({ kind: "none" });
  });
});
