import { describe, it, expect } from "vitest";
import { nextMode, canFire } from "./machine";
import type { Mode, GameEvent } from "./machine";

describe("mode transitions", () => {
  const legal: Array<[Mode, GameEvent, Mode]> = [
    ["BROWSE", "TAKE_CONTROLS", "COUNTDOWN"],
    ["COUNTDOWN", "COUNTDOWN_DONE", "FLYING"],
    ["COUNTDOWN", "COUNTDOWN_ABORT", "BROWSE"],
    ["COUNTDOWN", "QUIT", "BROWSE"],
    ["FLYING", "PAUSE", "PAUSED"],
    ["PAUSED", "RESUME", "FLYING"],
    ["PAUSED", "QUIT", "BROWSE"],
    ["FLYING", "IMPACT", "ENDED"],
    ["FLYING", "QUIT", "BROWSE"],
    ["FLYING", "RE_BRIEF", "COUNTDOWN"],
    ["PAUSED", "RE_BRIEF", "COUNTDOWN"],
    ["ENDED", "EXIT_END", "BROWSE"],
  ];
  for (const [from, event, to] of legal) {
    it(`${from} --${event}--> ${to}`, () => {
      expect(canFire(from, event)).toBe(true);
      expect(nextMode(from, event)).toBe(to);
    });
  }
});

describe("illegal transitions are refused, not thrown", () => {
  const illegal: Array<[Mode, GameEvent]> = [
    ["BROWSE", "PAUSE"],
    ["BROWSE", "IMPACT"],
    ["BROWSE", "RESUME"],
    ["FLYING", "TAKE_CONTROLS"],
    ["ENDED", "PAUSE"],
    ["ENDED", "IMPACT"],
    ["PAUSED", "IMPACT"],
    ["COUNTDOWN", "PAUSE"],
    ["BROWSE", "RE_BRIEF"],
    ["COUNTDOWN", "RE_BRIEF"],
    ["ENDED", "RE_BRIEF"],
  ];
  for (const [from, event] of illegal) {
    it(`${from} ignores ${event}`, () => {
      expect(canFire(from, event)).toBe(false);
      expect(nextMode(from, event)).toBe(from);
    });
  }
});

describe("the arc always gets home", () => {
  it("every mode can reach BROWSE", () => {
    expect(nextMode("COUNTDOWN", "QUIT")).toBe("BROWSE");
    expect(nextMode("FLYING", "QUIT")).toBe("BROWSE");
    expect(nextMode("PAUSED", "QUIT")).toBe("BROWSE");
    expect(nextMode("ENDED", "EXIT_END")).toBe("BROWSE");
  });
  it("a paused session cannot be ended by an impact it is not simulating", () => {
    expect(nextMode("PAUSED", "IMPACT")).toBe("PAUSED");
  });
});
