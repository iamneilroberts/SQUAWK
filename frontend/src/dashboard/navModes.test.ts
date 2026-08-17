import { describe, it, expect } from "vitest";
import { nextNavMode, navModeChipLabel, type NavMode } from "./navModes";

describe("tactical nav-mode cycle", () => {
  it("cycles normal -> large -> hidden -> normal", () => {
    expect(nextNavMode("normal")).toBe("large");
    expect(nextNavMode("large")).toBe("hidden");
    expect(nextNavMode("hidden")).toBe("normal");
  });

  it("returns to the start after three steps (a closed loop)", () => {
    const start: NavMode = "normal";
    expect(nextNavMode(nextNavMode(nextNavMode(start)))).toBe(start);
  });

  it("labels the chip with the action it performs (the mode it switches TO)", () => {
    expect(navModeChipLabel("normal")).toBe("ENLARGE");
    expect(navModeChipLabel("large")).toBe("HIDE");
    expect(navModeChipLabel("hidden")).toBe("SHOW");
  });
});
