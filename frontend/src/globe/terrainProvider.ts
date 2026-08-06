/*
 * The Cesium half of the terrain story. Attached once at APP START, never at takeover:
 * swapping a terrain provider mid-session forces a full tile reload and jumps the camera
 * (spec §3).
 *
 * Datum matters here (decisions.md G-003): Re:Earth serves ELLIPSOIDAL heights, the same
 * datum as ADS-B `alt_geom`, so spawn altitude and ground height compare like with like
 * without a geoid fudge.
 *
 * Fallback chain, in order, each one honestly reported to the status bar:
 *   1. Re:Earth quantized mesh — keyless, best-effort, no SLA
 *   2. Cesium ion world terrain — ONLY if the operator supplied VITE_CESIUM_ION_TOKEN
 *      (non-commercial terms, their account, their choice)
 *   3. the ellipsoid — flat earth, honestly labelled, collision still works against h=0
 */
import {
  Cartographic,
  CesiumTerrainProvider,
  EllipsoidTerrainProvider,
  Ion,
  createWorldTerrainAsync,
  type Scene,
  type Viewer,
} from "cesium";
import type { HeightSampler } from "../world/terrain";

export const REEARTH_TERRAIN_URL = "https://terrain.reearth.land/cesium-mesh/ellipsoid";

export type TerrainSource = "reearth" | "ion" | "ellipsoid";

export async function attachTerrain(viewer: Viewer): Promise<{ source: TerrainSource; note: string }> {
  try {
    viewer.terrainProvider = await CesiumTerrainProvider.fromUrl(REEARTH_TERRAIN_URL);
    return { source: "reearth", note: "RE:EARTH TERRAIN · MAPTERHORN CC BY 4.0" };
  } catch {
    // Re:Earth is documented as best-effort with no SLA — losing it is expected, not a bug.
  }

  const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
  if (typeof ionToken === "string" && ionToken.length > 0) {
    try {
      Ion.defaultAccessToken = ionToken;
      viewer.terrainProvider = await createWorldTerrainAsync();
      return { source: "ion", note: "TERRAIN: CESIUM ION (FALLBACK)" };
    } catch {
      Ion.defaultAccessToken = null as unknown as string; // back to keyless
    }
  }

  viewer.terrainProvider = new EllipsoidTerrainProvider();
  return { source: "ellipsoid", note: "TERRAIN UNAVAILABLE — FLAT ELLIPSOID" };
}

/**
 * `scene.globe.getHeight` is synchronous and returns `number | undefined` — undefined when
 * the tile is not resident. Handing that undefined straight through is deliberate:
 * world/terrain.ts is the module that knows undefined means "unknown", not "no ground".
 */
export function createSceneHeightSampler(scene: Scene): HeightSampler {
  const scratch = new Cartographic();
  return (latRad, lonRad) => {
    scratch.longitude = lonRad;
    scratch.latitude = latRad;
    scratch.height = 0;
    return scene.globe.getHeight(scratch);
  };
}
