/*
 * Place names and airport labels (spec D-7).
 *
 * Two different mechanisms on purpose:
 *  - PLACE names come from Esri's keyless "World Boundaries and Places" REFERENCE layer — an
 *    imagery layer drawn over the basemap. Esri renders and declutters them; we just add and
 *    remove the layer.
 *  - AIRPORT labels come from the bundled OurAirports extract and are LORAN-styled Cesium
 *    labels, so they look like the rest of the app rather than like Esri's cartography. Which
 *    ones are visible is decided by `visibleAirports` in data/airports.ts, which is pure and
 *    tested; this module only mutates primitives in place, the contactBillboards lesson.
 */
import { Cartesian2, Cartesian3, Color, ImageryLayer, LabelStyle, VerticalOrigin } from "cesium";
import { ArcGisMapServerImageryProvider, type Label, type LabelCollection, type Viewer } from "cesium";
import { PLACES_URL } from "./mapSources";
import { airportLabelText, type Airport } from "../data/airports";

export type PlacesRef = { layer: ImageryLayer | null };
export type AirportLabelRef = { byIdent: Map<string, Label> };

export function createPlacesRef(): PlacesRef {
  return { layer: null };
}
export function createAirportLabelRef(): AirportLabelRef {
  return { byIdent: new Map() };
}

export function applyPlacesLayer(viewer: Viewer, on: boolean, ref: PlacesRef): void {
  if (viewer.isDestroyed()) return;
  if (on && ref.layer === null) {
    ref.layer = ImageryLayer.fromProviderAsync(
      ArcGisMapServerImageryProvider.fromUrl(PLACES_URL),
      {},
    );
    viewer.imageryLayers.add(ref.layer);
    return;
  }
  if (!on && ref.layer !== null) {
    viewer.imageryLayers.remove(ref.layer, true);
    ref.layer = null;
  }
}

/** Add, move and remove airport labels in place — never rebuild the collection. */
export function syncAirportLabels(
  labels: LabelCollection,
  ref: AirportLabelRef,
  visible: Airport[],
): void {
  const wanted = new Map(visible.map((a) => [a.ident, a]));

  for (const [ident, label] of ref.byIdent) {
    if (!wanted.has(ident)) {
      labels.remove(label);
      ref.byIdent.delete(ident);
    }
  }

  for (const [ident, a] of wanted) {
    const existing = ref.byIdent.get(ident);
    if (existing) continue; // airports do not move
    ref.byIdent.set(
      ident,
      labels.add({
        position: Cartesian3.fromDegrees(a.lonDeg, a.latDeg, 0),
        text: airportLabelText(a),
        font: "10px monospace",
        fillColor: Color.fromCssColorString("#5fd7e0").withAlpha(0.85),
        style: LabelStyle.FILL,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -4),
      }),
    );
  }
}

export function clearAirportLabels(labels: LabelCollection, ref: AirportLabelRef): void {
  for (const label of ref.byIdent.values()) labels.remove(label);
  ref.byIdent.clear();
}
