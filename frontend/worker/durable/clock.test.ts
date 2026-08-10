import { describe, expect, it } from "vitest";

import { FakeClock } from "./clock";

describe("FakeClock", () => {
  it("advances deterministically and rejects invalid time", () => {
    const clock = new FakeClock(100);
    clock.advance(45_000);
    expect(clock.nowMs()).toBe(45_100);
    clock.set(200);
    expect(clock.nowMs()).toBe(200);
    expect(() => clock.advance(-1)).toThrow(/non-negative/);
    expect(() => new FakeClock(Number.NaN)).toThrow(/safe integer/);
  });
});
