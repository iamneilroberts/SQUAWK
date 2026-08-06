/*
 * Ground height for collision, with the three defenses parent spec §6 makes mandatory
 * (they come from cesium#5999 and the community threads in docs/research/cesium-fpv-notes):
 *
 *  1. LAST KNOWN GOOD — `scene.globe.getHeight()` returns undefined when the tile is not
 *     resident. That is "we don't know", not "there is no ground". We reuse the previous
 *     sample rather than letting the aircraft fly through a mountain that hasn't loaded.
 *  2. ASYNC BACKFILL — the caller (game/flightLoop.ts) fires sampleTerrainMostDetailed for
 *     the current and predicted position; this module just accepts whatever it is given.
 *  3. SPAWN GRACE — until the first defined sample arrives for the area, there is nothing
 *     to collide against, so collision stays disarmed. No fall-through, no false crash.
 *
 * The sampler is injected, which is why this file has zero Cesium imports and the defenses
 * are testable. `globe/terrainProvider.ts` supplies the real one.
 */
export type HeightSampler = (latRad: number, lonRad: number) => number | undefined;

export type TerrainSample = {
  /** Best available ground height, or null when nothing has ever been sampled. */
  heightM: number | null;
  /** True when this tick's sample came back defined (not a reused cache entry). */
  verified: boolean;
  /** False means: do not test for impact this tick. */
  collisionArmed: boolean;
};

export type TerrainService = {
  sample(latRad: number, lonRad: number, simTimeS: number): TerrainSample;
  /** Permanently disarm collision for this session (countdown preload timed out). */
  disarm(): void;
  readonly unverified: boolean;
  readonly lastKnownGoodM: number | null;
};

export const DEFAULT_SPAWN_GRACE_S = 3;

export function createTerrainService(
  sampler: HeightSampler,
  opts: { spawnGraceS?: number } = {},
): TerrainService {
  const spawnGraceS = opts.spawnGraceS ?? DEFAULT_SPAWN_GRACE_S;
  let lastKnownGoodM: number | null = null;
  let lastSampleVerified = false;
  let permanentlyDisarmed = false;

  const service: TerrainService = {
    sample(latRad, lonRad, simTimeS) {
      const raw = sampler(latRad, lonRad);
      const usable = typeof raw === "number" && Number.isFinite(raw);
      if (usable) lastKnownGoodM = raw as number;
      lastSampleVerified = usable;

      // Collision needs THREE things, and the grace window is a real one, not a formality.
      // Taking controls is a teleport: for the first seconds the resident tiles are still
      // the ones the browse camera was looking at, so `getHeight` can return a confident
      // number for the wrong place. Refusing to arm until the grace has expired is what
      // stops that becoming an instant, invented crash (research notes §2).
      const collisionArmed =
        !permanentlyDisarmed && lastKnownGoodM !== null && simTimeS >= spawnGraceS;
      return { heightM: lastKnownGoodM, verified: usable, collisionArmed };
    },
    disarm() {
      permanentlyDisarmed = true;
    },
    get unverified() {
      return permanentlyDisarmed || !lastSampleVerified;
    },
    get lastKnownGoodM() {
      return lastKnownGoodM;
    },
  };
  return service;
}
