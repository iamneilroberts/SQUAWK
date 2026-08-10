import { describe, expect, it } from "vitest";

import { nextLesson } from "./lessons";

const lessons = [
  { id: "controls", title: "Controls", body: "Hold the approach.", triggerAirtimeS: 2 },
  { id: "gear", title: "Gear", body: "Confirm gear.", triggerAirtimeS: 12 },
];

describe("tutorial lesson progression", () => {
  it("reveals each teaching moment once at its deterministic trigger", () => {
    expect(nextLesson(lessons, new Set(), 1.9)).toBeNull();
    expect(nextLesson(lessons, new Set(), 2)?.id).toBe("controls");
    expect(nextLesson(lessons, new Set(["controls"]), 30)?.id).toBe("gear");
    expect(nextLesson(lessons, new Set(["controls", "gear"]), 30)).toBeNull();
  });

  it("does not produce coaching when the preference is off", () => {
    expect(nextLesson(lessons, new Set(), 30, false)).toBeNull();
  });
});
