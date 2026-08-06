import { describe, it, expect } from "vitest";
import { createTerrainService, DEFAULT_SPAWN_GRACE_S } from "./terrain";
import type { HeightSampler } from "./terrain";

/** A sampler driven by a script of values, so each defense can be exercised in isolation. */
function scripted(values: Array<number | undefined>): { sampler: HeightSampler; calls: number } {
  const box = { calls: 0 } as { calls: number; sampler: HeightSampler };
  box.sampler = () => {
    const v = values[Math.min(box.calls, values.length - 1)];
    box.calls++;
    return v;
  };
  return box as { sampler: HeightSampler; calls: number };
}

describe("terrain service — defense 1: last known good", () => {
  it("returns the sampled height when tiles are resident", () => {
    const t = createTerrainService(scripted([120]).sampler);
    const s = t.sample(0.5, -1.5, 10);
    expect(s.heightM).toBe(120);
    expect(s.verified).toBe(true);
    expect(s.collisionArmed).toBe(true);
  });
  it("undefined reuses the last known good height — never reads as 'no ground'", () => {
    const t = createTerrainService(scripted([120, undefined]).sampler);
    t.sample(0.5, -1.5, 10);
    const s = t.sample(0.5, -1.5, 10.02);
    expect(s.heightM).toBe(120);
    expect(s.verified).toBe(false);
    expect(s.collisionArmed).toBe(true); // armed against the last verified floor
  });
  it("exposes the last known good height for the caller to inspect", () => {
    const t = createTerrainService(scripted([300, undefined, undefined]).sampler);
    t.sample(0.5, -1.5, 10);
    t.sample(0.5, -1.5, 10.02);
    expect(t.lastKnownGoodM).toBe(300);
  });
  it("a later defined sample replaces the cached one", () => {
    const t = createTerrainService(scripted([100, undefined, 250]).sampler);
    t.sample(0, 0, 1);
    t.sample(0, 0, 2);
    expect(t.sample(0, 0, 3).heightM).toBe(250);
    expect(t.lastKnownGoodM).toBe(250);
  });
  it("ignores a NaN or infinite sample the way it ignores undefined", () => {
    const t = createTerrainService(scripted([100, Number.NaN, Number.POSITIVE_INFINITY]).sampler);
    t.sample(0, 0, 1);
    expect(t.sample(0, 0, 2).heightM).toBe(100);
    expect(t.sample(0, 0, 3).heightM).toBe(100);
  });
});

describe("terrain service — defense 3: spawn grace", () => {
  it("collision is disarmed while no sample has ever come back", () => {
    const t = createTerrainService(scripted([undefined]).sampler);
    const s = t.sample(0.5, -1.5, 0.5);
    expect(s.heightM).toBeNull();
    expect(s.collisionArmed).toBe(false);
    expect(s.verified).toBe(false);
  });
  it("stays disarmed past the grace period but flags the ground as unverified", () => {
    const t = createTerrainService(scripted([undefined]).sampler);
    t.sample(0.5, -1.5, 0.5);
    const s = t.sample(0.5, -1.5, DEFAULT_SPAWN_GRACE_S + 1);
    expect(s.collisionArmed).toBe(false);
    expect(t.unverified).toBe(true);
  });
  it("arms once a real sample has arrived AND the grace has expired", () => {
    const t = createTerrainService(scripted([undefined, undefined, 80]).sampler);
    t.sample(0, 0, 0.2);
    t.sample(0, 0, 0.4);
    const s = t.sample(0, 0, DEFAULT_SPAWN_GRACE_S + 1);
    expect(s.collisionArmed).toBe(true);
    expect(t.unverified).toBe(false);
  });
  it("a confident sample INSIDE the grace window still does not arm — takeover is a teleport", () => {
    // The tiles resident right after takeover may still be the browse camera's, so an
    // early defined height can be a confident number for the wrong place.
    const t = createTerrainService(scripted([80]).sampler);
    const early = t.sample(0, 0, DEFAULT_SPAWN_GRACE_S - 0.5);
    expect(early.heightM).toBe(80);
    expect(early.verified).toBe(true);
    expect(early.collisionArmed).toBe(false);
  });
  it("honors a custom grace period on both sides of it", () => {
    const t = createTerrainService(scripted([500]).sampler, { spawnGraceS: 10 });
    expect(t.sample(0, 0, 9).collisionArmed).toBe(false);
    expect(t.sample(0, 0, 11).collisionArmed).toBe(true);
  });
});

describe("terrain service — disarm", () => {
  it("disarm() keeps collision off for the rest of the session even with good samples", () => {
    const t = createTerrainService(scripted([150, 150, 150]).sampler);
    t.sample(0, 0, 1);
    t.disarm();
    const s = t.sample(0, 0, 2);
    expect(s.collisionArmed).toBe(false);
    expect(s.heightM).toBe(150); // still reports the height — the HUD wants it
    expect(t.unverified).toBe(true);
  });
  it("is what the countdown timeout uses: TERRAIN UNVERIFIED without a false crash", () => {
    const t = createTerrainService(scripted([undefined]).sampler);
    t.disarm();
    expect(t.unverified).toBe(true);
    expect(t.sample(0, 0, 30).collisionArmed).toBe(false);
  });
});

describe("terrain service — no Cesium", () => {
  it("works with a sampler that knows nothing about a globe", () => {
    let asked: Array<[number, number]> = [];
    const t = createTerrainService((lat, lon) => { asked.push([lat, lon]); return 42; });
    expect(t.sample(0.1, 0.2, 1).heightM).toBe(42);
    expect(asked).toEqual([[0.1, 0.2]]);
  });
});
