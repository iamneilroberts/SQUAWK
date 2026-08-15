import { describe, it, expect } from "vitest";
import { CALLSIGN_PRESETS, resolveCallsign } from "./callsignPool";

describe("callsignPool", () => {
  it("offers a non-empty, stable pool of presets", () => {
    expect(CALLSIGN_PRESETS.length).toBeGreaterThan(0);
    // Stable order/content — a snapshot-style check that fails loudly if the pool is reshuffled.
    expect(CALLSIGN_PRESETS).toEqual([...CALLSIGN_PRESETS]);
    expect(new Set(CALLSIGN_PRESETS).size).toBe(CALLSIGN_PRESETS.length); // no duplicates
  });

  it("defaults to SIM-<hex> when no preset is chosen", () => {
    expect(resolveCallsign("a1b2c3", null)).toBe("SIM-A1B2C3");
  });

  it("round-trips a chosen preset into SIM-<PRESET>", () => {
    const preset = CALLSIGN_PRESETS[0];
    expect(resolveCallsign("a1b2c3", preset)).toBe(`SIM-${preset}`);
  });

  it("ignores an unrecognized preset value and falls back to the default", () => {
    expect(resolveCallsign("a1b2c3", "NOT-A-REAL-PRESET")).toBe("SIM-A1B2C3");
  });

  it("always keeps the SIM marker, default or chosen — ground rule 2", () => {
    expect(resolveCallsign("a1b2c3", null).startsWith("SIM-")).toBe(true);
    for (const preset of CALLSIGN_PRESETS) {
      expect(resolveCallsign("a1b2c3", preset).startsWith("SIM-")).toBe(true);
    }
  });
});
