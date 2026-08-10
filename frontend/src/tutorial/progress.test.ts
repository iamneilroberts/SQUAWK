import { describe, expect, it } from "vitest";

import { loadTutorialProgress, markTutorialCompleted, markTutorialStarted } from "./progress";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
}

describe("tutorial progress", () => {
  it("persists started and class completion locally without an account", () => {
    const storage = memoryStorage();
    expect(markTutorialStarted(storage).started).toBe(true);
    markTutorialCompleted(storage, "f5e");
    markTutorialCompleted(storage, "f5e");
    expect(loadTutorialProgress(storage)).toMatchObject({ started: true, completedClasses: ["f5e"] });
  });

  it("fails closed to empty progress for corrupt or stale data", () => {
    const storage = memoryStorage();
    storage.setItem("adsb.tutorial-progress.v1", "not-json");
    expect(loadTutorialProgress(storage).completedClasses).toEqual([]);
  });
});
