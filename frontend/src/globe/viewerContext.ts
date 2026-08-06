/*
 * One Cesium Viewer for the whole app. BROWSE / COUNTDOWN / FLYING / PAUSED / ENDED are
 * modes on it, not separate screens — destroying and rebuilding the globe to fly would
 * drop every loaded tile, stop the feed, and lose the ghost (spec §3).
 */
import { createContext, useContext } from "react";
import type { Billboard, BillboardCollection, LabelCollection, Viewer } from "cesium";
import type { HeightSampler } from "../world/terrain";

export type ViewerBundle = {
  viewer: Viewer;
  billboards: BillboardCollection;
  labels: LabelCollection;
  /** Billboard per ICAO hex, mutated in place — the LORAN primitive-churn lesson. */
  byHex: Map<string, Billboard>;
  heightSampler: HeightSampler;
  /** Which terrain source actually attached, for the status bar. */
  terrainNote: string;
};

export const ViewerContext = createContext<ViewerBundle | null>(null);

export function useViewer(): ViewerBundle | null {
  return useContext(ViewerContext);
}
