import { describe, expect, it } from "vitest";
import {
  dismissQuickStart,
  isQuickStartDismissed,
  QUICK_START_STORAGE_KEY,
  QUICK_START_VERSION,
  shouldShowQuickStart,
} from "./quickStartState";

function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem(key: string) {
      return key === QUICK_START_STORAGE_KEY ? value : null;
    },
    setItem(key: string, next: string) {
      if (key === QUICK_START_STORAGE_KEY) value = next;
    },
  };
}

describe("quick-start version state", () => {
  it("shows on first visit and hides only for the current version", () => {
    expect(shouldShowQuickStart(storage())).toBe(true);
    expect(isQuickStartDismissed(storage(String(QUICK_START_VERSION - 1)))).toBe(false);
    expect(shouldShowQuickStart(storage(String(QUICK_START_VERSION)))).toBe(false);
  });

  it("persists a versioned dismissal and fails open when storage is unavailable", () => {
    const target = storage();
    dismissQuickStart(target);
    expect(isQuickStartDismissed(target)).toBe(true);
    expect(shouldShowQuickStart(null)).toBe(true);
    expect(shouldShowQuickStart({ getItem: () => { throw new Error("blocked"); } })).toBe(true);
  });
});
