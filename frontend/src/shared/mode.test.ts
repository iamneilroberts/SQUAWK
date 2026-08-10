import { describe, expect, it } from "vitest";

import { mostRestrictiveMode } from "./mode";

describe("mostRestrictiveMode", () => {
  it("uses the most restrictive deployment, administrator, or automatic mode", () => {
    expect(mostRestrictiveMode("NORMAL", "READ_ONLY", "KILL_SWITCH")).toBe(
      "KILL_SWITCH",
    );
    expect(mostRestrictiveMode("READ_ONLY", "NORMAL", "NORMAL")).toBe(
      "READ_ONLY",
    );
  });

  it("treats an absent optional mode as NORMAL", () => {
    expect(mostRestrictiveMode(undefined, "NORMAL", undefined)).toBe("NORMAL");
  });
});
