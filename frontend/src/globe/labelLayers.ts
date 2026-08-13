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
import { airportGlobeLabel, type Airport } from "../data/airports";
import { placeLabelText, type Place } from "../data/places";
import { navaidLabelText, type Navaid } from "../data/navaids";

export type PlacesRef = { layer: ImageryLayer | null };
export type AirportLabelRef = { byIdent: Map<string, Label> };
export type PlaceLabelRef = { byName: Map<string, Label> };
export type NavaidLabelRef = { byIdent: Map<string, Label> };

// LORAN palette per label family (variant B — glyph + text).
const AIRPORT_COLOR = Color.fromCssColorString("#5fd7e0").withAlpha(0.85); // bright cyan
const TOWN_COLOR = Color.fromCssColorString("#93a6ad").withAlpha(0.9); // steel-gray
const LANDMARK_COLOR = Color.fromCssColorString("#5fd7e0").withAlpha(0.6); // dim cyan
const NAVAID_COLOR = Color.fromCssColorString("#7ec87e").withAlpha(0.85); // green
const LABEL_FONT = "10px monospace";

export function createPlacesRef(): PlacesRef {
  return { layer: null };
}
export function createAirportLabelRef(): AirportLabelRef {
  return { byIdent: new Map() };
}
export function createPlaceLabelRef(): PlaceLabelRef {
  return { byName: new Map() };
}
export function createNavaidLabelRef(): NavaidLabelRef {
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
        text: `▪ ${airportGlobeLabel(a)}`,
        font: LABEL_FONT,
        fillColor: AIRPORT_COLOR,
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

/** Curated Gulf Coast towns + landmarks. Towns are bare; landmarks carry a `•`. Never move. */
export function syncPlaceLabels(
  labels: LabelCollection,
  ref: PlaceLabelRef,
  visible: Place[],
): void {
  const wanted = new Map(visible.map((p) => [p.name, p]));

  for (const [name, label] of ref.byName) {
    if (!wanted.has(name)) {
      labels.remove(label);
      ref.byName.delete(name);
    }
  }

  for (const [name, p] of wanted) {
    if (ref.byName.get(name)) continue; // places do not move
    const isTown = p.kind === "town";
    ref.byName.set(
      name,
      labels.add({
        position: Cartesian3.fromDegrees(p.lonDeg, p.latDeg, 0),
        text: isTown ? placeLabelText(p) : `• ${placeLabelText(p)}`,
        font: LABEL_FONT,
        fillColor: isTown ? TOWN_COLOR : LANDMARK_COLOR,
        style: LabelStyle.FILL,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -4),
      }),
    );
  }
}

export function clearPlaceLabels(labels: LabelCollection, ref: PlaceLabelRef): void {
  for (const label of ref.byName.values()) labels.remove(label);
  ref.byName.clear();
}

/** VOR-family navaids, charted IDENT with a `⬡` glyph, in green. Never move. */
export function syncNavaidLabels(
  labels: LabelCollection,
  ref: NavaidLabelRef,
  visible: Navaid[],
): void {
  const wanted = new Map(visible.map((n) => [n.ident, n]));

  for (const [ident, label] of ref.byIdent) {
    if (!wanted.has(ident)) {
      labels.remove(label);
      ref.byIdent.delete(ident);
    }
  }

  for (const [ident, n] of wanted) {
    if (ref.byIdent.get(ident)) continue; // navaids do not move
    ref.byIdent.set(
      ident,
      labels.add({
        position: Cartesian3.fromDegrees(n.lonDeg, n.latDeg, 0),
        text: `⬡ ${navaidLabelText(n)}`,
        font: LABEL_FONT,
        fillColor: NAVAID_COLOR,
        style: LabelStyle.FILL,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -4),
      }),
    );
  }
}

export function clearNavaidLabels(labels: LabelCollection, ref: NavaidLabelRef): void {
  for (const label of ref.byIdent.values()) labels.remove(label);
  ref.byIdent.clear();
}
