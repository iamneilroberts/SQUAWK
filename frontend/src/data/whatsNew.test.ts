import { describe, it, expect } from "vitest";
import { WHATS_NEW } from "./whatsNew";

describe("WHATS_NEW", () => {
  it("is non-empty", () => {
    expect(WHATS_NEW.length).toBeGreaterThan(0);
  });

  it("is strictly newest-first (dates strictly descending)", () => {
    for (let i = 1; i < WHATS_NEW.length; i++) {
      expect(WHATS_NEW[i].date < WHATS_NEW[i - 1].date).toBe(true);
    }
  });

  it("every release has at least one item, and no item is empty", () => {
    for (const release of WHATS_NEW) {
      expect(release.items.length).toBeGreaterThan(0);
      for (const item of release.items) {
        expect(item.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
