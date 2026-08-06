/*
 * The countdown is load-bearing (spec §4): it exists to get real terrain resident before
 * the aircraft is anywhere near it. `sampleTerrainMostDetailed` walks to the maximum
 * available LOD and needs network round-trips, which is exactly why it happens here during
 * the 3-2-1 and never inside a 60 Hz tick.
 *
 * Two points are requested: the spawn, and where the aircraft will be ten seconds later.
 * Dead reckoning is legitimate for TILE WARMING — it never becomes aircraft state (the
 * "never dead-reckon a stale position" rule in spec §4 is about the spawn snapshot).
 */
import { Cartographic, sampleTerrainMostDetailed, type Viewer } from "cesium";

const EARTH_RADIUS_M = 6371008.8;

export function lookAheadPointRad(
  latRad: number, lonRad: number, headingRad: number, speedMs: number, seconds: number,
): { latRad: number; lonRad: number } {
  const distance = (speedMs * seconds) / EARTH_RADIUS_M; // angular distance
  const lat = Math.asin(
    Math.sin(latRad) * Math.cos(distance) +
      Math.cos(latRad) * Math.sin(distance) * Math.cos(headingRad),
  );
  const lon =
    lonRad +
    Math.atan2(
      Math.sin(headingRad) * Math.sin(distance) * Math.cos(latRad),
      Math.cos(distance) - Math.sin(latRad) * Math.sin(lat),
    );
  return { latRad: lat, lonRad: lon };
}

export async function preloadTerrain(
  viewer: Viewer,
  latRad: number,
  lonRad: number,
  headingRad: number,
  speedMs: number,
  timeoutMs = 3000,
): Promise<{ verified: boolean; terrainHeightM: number | null }> {
  const ahead = lookAheadPointRad(latRad, lonRad, headingRad, speedMs, 10);
  const positions = [
    Cartographic.fromRadians(lonRad, latRad),
    Cartographic.fromRadians(ahead.lonRad, ahead.latRad),
  ];
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const sampled = await Promise.race([
    sampleTerrainMostDetailed(viewer.terrainProvider, positions).catch(() => null),
    timeout,
  ]);
  const height = sampled?.[0]?.height;
  if (typeof height !== "number" || !Number.isFinite(height)) {
    // Timed out or came back undefined: the caller enters FLYING with collision DISARMED
    // and a TERRAIN UNVERIFIED flag. It never enters pretending the ground is known.
    return { verified: false, terrainHeightM: null };
  }
  return { verified: true, terrainHeightM: height };
}
