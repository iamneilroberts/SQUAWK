/*
 * Where the imagery comes from, and how the app says so. Deliberately CESIUM-FREE, even though
 * it lives in globe/: `StatusBar` is a flex sibling of `ViewerHost` (decisions B-015) and `Hud`
 * is a dumb overlay, and neither should pull Cesium into its bundle or its test just to print a
 * credit line. `basemap.ts` and `labelLayers.ts` import the URLs from here and add the Cesium.
 *
 * All three services are keyless ArcGIS REST endpoints — Ion.defaultAccessToken stays null and
 * nothing here carries a token or an API key. The test asserts that.
 */
export type BasemapKind = "SAT" | "CHART";

export const SAT_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
export const CHART_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer";
export const PLACES_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer";

export const BASEMAP_CREDIT: Readonly<Record<BasemapKind, string>> = {
  SAT: "IMAGERY © ESRI",
  CHART: "BASEMAP © ESRI DARK GRAY CANVAS",
};
export const PLACES_CREDIT = "PLACES © ESRI";
export const RAINVIEWER_CREDIT = "WEATHER © RAINVIEWER";
export const AIRPORTS_CREDIT = "AIRPORTS: OURAIRPORTS (PUBLIC DOMAIN)";
export const NAVAIDS_CREDIT = "NAVAIDS: OURAIRPORTS (PUBLIC DOMAIN)";
export const TRAFFIC_CREDIT = "TRAFFIC: AIRPLANES.LIVE / ADSB.LOL / ADSB.FI";

/**
 * The one attribution builder. Both the status bar and the HUD call it, so switching basemap or
 * turning labels on updates both in the same render, and a layer that is NOT on is never
 * credited.
 */
export function attributionFor(o: {
  basemap: BasemapKind;
  labelsOn: boolean;
  /** Precip-radar overlay active (store `radarOn`): credit RainViewer, a required disclosure kept
   *  even in compact mode (like the imagery/terrain/traffic credits). Absent/false = not credited. */
  radarOn?: boolean;
  terrainNote: string | null;
  /** Compact (#81): mobile flight strip — drop the OurAirports/places PUBLIC-DOMAIN credits
   *  (courtesy, not legally required) so the line fits over the portrait touch controls. The
   *  required Esri imagery + Re:Earth/Mapterhorn CC-BY terrain + traffic credits always stay. */
  compact?: boolean;
}): string {
  const parts = [BASEMAP_CREDIT[o.basemap], o.terrainNote ?? "TERRAIN LOADING…"];
  if (o.labelsOn && !o.compact) parts.push(PLACES_CREDIT, AIRPORTS_CREDIT, NAVAIDS_CREDIT);
  parts.push(TRAFFIC_CREDIT);
  // Attribution when active (CLAUDE.md data-sources rule), so never gated by compact.
  if (o.radarOn) parts.push(RAINVIEWER_CREDIT);
  return parts.join(" · ");
}
