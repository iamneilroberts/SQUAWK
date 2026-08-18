/*
 * Store toggles -> Cesium layers. One component, three effects, each of which removes exactly
 * what it created so React 18's StrictMode double-invoke leaves one live instance (the same
 * discipline ViewerHost follows).
 *
 * The airport-label effect also listens to camera movement, because "declutter by camera height"
 * has to react to the camera, not to a store change. `camera.percentageChanged = 0.2` keeps that
 * to a handful of updates per pan rather than one per frame.
 */
import { useEffect, useRef } from "react";
import { Math as CesiumMath } from "cesium";
import { useStore } from "../state/store";
import type { Contact } from "../data/types";
import type { RunwayAssignment } from "../mission/types";
import RoutePreview from "../briefing/RoutePreview";
import { useViewer } from "./viewerContext";
import { applyBasemap, createBasemapRef, disposeBasemap } from "./basemap";
import {
  applyPlacesLayer, clearAirportLabels, clearNavaidLabels, clearPlaceLabels, createAirportLabelRef,
  createNavaidLabelRef, createPlaceLabelRef, createPlacesRef, syncAirportLabels, syncNavaidLabels,
  syncPlaceLabels,
} from "./labelLayers";
import {
  createRadarRef, fetchNewestRadarFrame, removeRadarLayer, setRadarLayer, type RadarRef,
} from "./weatherRadarLayer";
import type { PlacesRef } from "./labelLayers";
import type { Viewer } from "cesium";
import { loadAirports, visibleAirports } from "../data/airports";
import { loadPlaces, visiblePlaces } from "../data/places";
import { loadNavaids, visibleNavaids } from "../data/navaids";

// Re-fetch the newest observed frame on this cadence and rebuild the layer (spec: ~5 min; RainViewer
// publishes a new frame roughly every 10 min, so this comfortably keeps the newest one on screen).
const RADAR_REFRESH_MS = 5 * 60_000;

/**
 * Restore the imagery z-order after any layer add: basemaps at the bottom, then the radar wash,
 * then the Esri place-labels REFERENCE layer on top (Cesium LABEL primitives always draw above all
 * imagery, so only that reference imagery layer needs re-topping). Called after every add so a
 * basemap swap, a labels toggle, or a radar frame refresh can't leave the wash over the labels or
 * a fresh CHART basemap over the wash.
 */
function restackOverlays(viewer: Viewer, radarRef: RadarRef, placesRef: PlacesRef): void {
  if (viewer.isDestroyed()) return;
  const layers = viewer.imageryLayers;
  if (radarRef.layer !== null) layers.raiseToTop(radarRef.layer);
  if (placesRef.layer !== null) layers.raiseToTop(placesRef.layer);
}

export default function OverlayLayers({
  route,
}: {
  route?: { contact: Contact; assignment: RunwayAssignment } | null;
}) {
  const bundle = useViewer();
  const basemap = useStore((s) => s.basemap);
  const labelsOn = useStore((s) => s.labelsOn);
  const radarOn = useStore((s) => s.radarOn);

  const basemapRef = useRef(createBasemapRef());
  const placesRef = useRef(createPlacesRef());
  const airportRef = useRef(createAirportLabelRef());
  const placeLabelRef = useRef(createPlaceLabelRef());
  const navaidRef = useRef(createNavaidLabelRef());
  const radarRef = useRef(createRadarRef());

  useEffect(() => {
    if (!bundle) return;
    const viewer = bundle.viewer;
    const ref = basemapRef.current;
    applyBasemap(viewer, basemap, ref);
    // A CHART swap adds an opaque layer on top; re-top the radar + labels so neither is buried.
    restackOverlays(viewer, radarRef.current, placesRef.current);
    return () => disposeBasemap(viewer, ref);
  }, [bundle?.viewer, basemap]);

  // `basemap` is in these deps even though this effect never reads it: applyBasemap's own
  // effect appends the new imagery layer with `layers.add()`, which lands it ABOVE whatever
  // is already in the stack — including places, if labels are on. Re-running this effect on
  // every basemap change removes and re-adds the places layer so it ends up on top again
  // (React runs effect cleanups in declaration order before re-running effects, so the
  // basemap effect settles first). Without this dep, SAT -> CHART with labels on strands
  // places under the opaque Dark Gray Canvas while attributionFor() keeps crediting it.
  useEffect(() => {
    if (!bundle) return;
    const viewer = bundle.viewer;
    const ref = placesRef.current;
    applyPlacesLayer(viewer, labelsOn, ref);
    // Places is added on top; keep the radar wash below it (basemap < radar < labels).
    restackOverlays(viewer, radarRef.current, ref);
    return () => applyPlacesLayer(viewer, false, ref);
  }, [bundle?.viewer, labelsOn, basemap]);

  // Precip-radar globe drape (store `radarOn`), mirroring the labels effect above. Works in BROWSE
  // and FLYING alike because OverlayLayers is mounted in every mode (App.tsx). The manifest fetch
  // is async and degrades honestly: an unreachable/empty feed leaves no layer and never throws.
  useEffect(() => {
    if (!bundle) return;
    const viewer = bundle.viewer;
    const ref = radarRef.current;
    if (!radarOn) {
      removeRadarLayer(viewer, ref);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const result = await fetchNewestRadarFrame();
      if (cancelled || viewer.isDestroyed()) return;
      if (result === null) {
        removeRadarLayer(viewer, ref); // honest offline — no wash rather than a stale frame
        return;
      }
      if (ref.layer !== null && ref.frameTime === result.frame.time) return; // already current
      setRadarLayer(viewer, ref, result.host, result.frame);
      restackOverlays(viewer, ref, placesRef.current);
    };
    void refresh();
    const timer = setInterval(() => void refresh(), RADAR_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      removeRadarLayer(viewer, ref);
    };
  }, [bundle?.viewer, radarOn]);

  // Airports, curated Gulf Coast places, and VOR-family navaids all ride the LABELS toggle and the
  // same camera hook — "declutter by camera height/range" reacts to the camera, not a store change.
  useEffect(() => {
    if (!bundle) return;
    const viewer = bundle.viewer;
    const labels = bundle.labels;
    const airports = airportRef.current;
    const places = placeLabelRef.current;
    const navaids = navaidRef.current;

    const clearAll = () => {
      clearAirportLabels(labels, airports);
      clearPlaceLabels(labels, places);
      clearNavaidLabels(labels, navaids);
    };

    if (!labelsOn) {
      clearAll();
      return;
    }

    const airportData = loadAirports();
    const placeData = loadPlaces();
    const navaidData = loadNavaids();
    const update = () => {
      if (viewer.isDestroyed()) return;
      const carto = viewer.camera.positionCartographic;
      const at = {
        cameraHeightM: carto.height,
        centerLatDeg: CesiumMath.toDegrees(carto.latitude),
        centerLonDeg: CesiumMath.toDegrees(carto.longitude),
      };
      syncAirportLabels(labels, airports, visibleAirports({ airports: airportData, ...at }));
      syncPlaceLabels(labels, places, visiblePlaces({ places: placeData, ...at }));
      syncNavaidLabels(labels, navaids, visibleNavaids({ navaids: navaidData, ...at }));
    };

    const previousPercentage = viewer.camera.percentageChanged;
    viewer.camera.percentageChanged = 0.2;
    viewer.camera.changed.addEventListener(update);
    update();

    return () => {
      viewer.camera.changed.removeEventListener(update);
      viewer.camera.percentageChanged = previousPercentage;
      clearAll();
    };
  }, [bundle?.viewer, bundle?.labels, labelsOn]);

  return route ? <RoutePreview contact={route.contact} assignment={route.assignment} /> : null;
}
