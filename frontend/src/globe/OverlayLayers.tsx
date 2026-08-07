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
import { useViewer } from "./viewerContext";
import { applyBasemap, createBasemapRef, disposeBasemap } from "./basemap";
import {
  applyPlacesLayer, clearAirportLabels, createAirportLabelRef, createPlacesRef, syncAirportLabels,
} from "./labelLayers";
import { loadAirports, visibleAirports } from "../data/airports";

export default function OverlayLayers() {
  const bundle = useViewer();
  const basemap = useStore((s) => s.basemap);
  const labelsOn = useStore((s) => s.labelsOn);

  const basemapRef = useRef(createBasemapRef());
  const placesRef = useRef(createPlacesRef());
  const airportRef = useRef(createAirportLabelRef());

  useEffect(() => {
    if (!bundle) return;
    const viewer = bundle.viewer;
    const ref = basemapRef.current;
    applyBasemap(viewer, basemap, ref);
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
    return () => applyPlacesLayer(viewer, false, ref);
  }, [bundle?.viewer, labelsOn, basemap]);

  useEffect(() => {
    if (!bundle) return;
    const viewer = bundle.viewer;
    const labels = bundle.labels;
    const ref = airportRef.current;

    if (!labelsOn) {
      clearAirportLabels(labels, ref);
      return;
    }

    const airports = loadAirports();
    const update = () => {
      if (viewer.isDestroyed()) return;
      const carto = viewer.camera.positionCartographic;
      syncAirportLabels(
        labels,
        ref,
        visibleAirports({
          airports,
          cameraHeightM: carto.height,
          centerLatDeg: CesiumMath.toDegrees(carto.latitude),
          centerLonDeg: CesiumMath.toDegrees(carto.longitude),
        }),
      );
    };

    const previousPercentage = viewer.camera.percentageChanged;
    viewer.camera.percentageChanged = 0.2;
    viewer.camera.changed.addEventListener(update);
    update();

    return () => {
      viewer.camera.changed.removeEventListener(update);
      viewer.camera.percentageChanged = previousPercentage;
      clearAirportLabels(labels, ref);
    };
  }, [bundle?.viewer, bundle?.labels, labelsOn]);

  return null;
}
