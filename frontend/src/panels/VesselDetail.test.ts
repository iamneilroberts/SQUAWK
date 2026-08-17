import { describe, it, expect } from "vitest";
import { formatField, formatDimensions, formatUnit } from "./VesselDetail";

describe("formatField", () => {
  it("passes through a known value", () => {
    expect(formatField("CARGO")).toBe("CARGO");
  });
  it("renders an em-dash when null", () => {
    expect(formatField(null)).toBe("—");
  });
});

describe("formatDimensions", () => {
  it("renders length × beam when both are known", () => {
    expect(formatDimensions(180, 28)).toBe("180 × 28 m");
  });
  it("renders an em-dash when length is unknown", () => {
    expect(formatDimensions(null, 28)).toBe("—");
  });
  it("renders an em-dash when beam is unknown", () => {
    expect(formatDimensions(180, null)).toBe("—");
  });
  it("renders an em-dash when both are unknown", () => {
    expect(formatDimensions(null, null)).toBe("—");
  });
});

describe("formatUnit", () => {
  it("appends the unit when known", () => {
    expect(formatUnit(12.3, " KT")).toBe("12.3 KT");
  });
  it("renders an em-dash when unknown", () => {
    expect(formatUnit(null, " KT")).toBe("—");
  });
});
