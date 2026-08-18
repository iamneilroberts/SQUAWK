import { describe, it, expect } from "vitest";
import { formatReleaseDate, isUnseen } from "./whatsNewSeen";

describe("formatReleaseDate", () => {
  it("formats an ISO date as human-readable DD MON YYYY", () => {
    expect(formatReleaseDate("2026-08-18")).toBe("18 AUG 2026");
  });
  it("pads-through single-digit days as given (no reformatting of the day string)", () => {
    expect(formatReleaseDate("2026-01-05")).toBe("05 JAN 2026");
  });
});

describe("isUnseen", () => {
  it("is unseen when nothing has been seen yet", () => {
    expect(isUnseen("2026-08-18", null)).toBe(true);
  });
  it("is unseen when the newest release postdates the last-seen date", () => {
    expect(isUnseen("2026-08-18", "2026-08-16")).toBe(true);
  });
  it("is not unseen when the last-seen date matches the newest release", () => {
    expect(isUnseen("2026-08-18", "2026-08-18")).toBe(false);
  });
  it("is not unseen when the last-seen date is newer (shouldn't happen, but stays honest)", () => {
    expect(isUnseen("2026-08-16", "2026-08-18")).toBe(false);
  });
});
