/*
 * The browse globe: keyless Cesium viewer over Esri World Imagery, live contact
 * chevrons (via contactBillboards.syncBillboards), and click-to-select.
 *
 * Cesium ~1.143 API note: ArcGisMapServerImageryProvider's constructor is not meant to be
 * called directly anymore (its ConstructorOptions type has no `url` field) — the async
 * `fromUrl(url)` factory is required. `ImageryLayer.fromProviderAsync` accepts that
 * provider *promise* directly and returns an `ImageryLayer` synchronously, so it can be
 * passed straight into `Viewer`'s `baseLayer` option without an extra async effect. This
 * Viewer's ConstructorOptions also has no `imageryProvider` field anymore — only
 * `baseLayer: ImageryLayer | false` — so `baseLayer` (not `imageryProvider`) is the option
 * to use.
 */
import { useEffect, useRef } from "react";
import {
  ArcGisMapServerImageryProvider,
  Billboard,
  BillboardCollection,
  Cartesian3,
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from "cesium";
import { startPolling, useStore } from "../state/store";
import { syncBillboards } from "./contactBillboards";

// Keyless: no Cesium ion account. Must be set before any Viewer is constructed.
// Cast needed: the installed Cesium's .d.ts types this as `string`, not nullable
// (same workaround as the sibling LORAN project's Globe.tsx).
Ion.defaultAccessToken = null as unknown as string;

const ESRI_WORLD_IMAGERY_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";

const BROWSE_HEIGHT_M = 250_000;

export default function BrowseGlobe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const billboardsRef = useRef<BillboardCollection | null>(null);
  const byHexRef = useRef<Map<string, Billboard>>(new Map());

  const contacts = useStore((s) => s.contacts);
  const selectedHex = useStore((s) => s.selectedHex);
  const home = useStore((s) => s.home);

  // Mount once: viewer, billboard collection, click picking, polling. All torn down
  // together on unmount.
  useEffect(() => {
    if (!containerRef.current) return;

    const baseLayer = ImageryLayer.fromProviderAsync(
      ArcGisMapServerImageryProvider.fromUrl(ESRI_WORLD_IMAGERY_URL),
    );
    const viewer = new Viewer(containerRef.current, {
      baseLayer,
      terrainProvider: new EllipsoidTerrainProvider(),
      baseLayerPicker: false,
      timeline: false,
      animation: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      fullscreenButton: false,
      requestRenderMode: false,
    });
    viewerRef.current = viewer;
    billboardsRef.current = viewer.scene.primitives.add(new BillboardCollection());

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(click.position);
      const hex = picked?.id;
      useStore.getState().select(typeof hex === "string" && byHexRef.current.has(hex) ? hex : null);
    }, ScreenSpaceEventType.LEFT_CLICK);

    const stopPolling = startPolling();

    return () => {
      stopPolling();
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
      billboardsRef.current = null;
      byHexRef.current.clear();
    };
  }, []);

  // Camera waits for the real home from /api/config — never flies to an invented default.
  useEffect(() => {
    if (!home || !viewerRef.current) return;
    viewerRef.current.camera.setView({
      destination: Cartesian3.fromDegrees(home.lon, home.lat, BROWSE_HEIGHT_M),
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
    });
  }, [home]);

  // Store -> billboards, in place (add/remove/mutate — see contactBillboards.ts).
  useEffect(() => {
    if (!billboardsRef.current) return;
    syncBillboards(billboardsRef.current, byHexRef.current, contacts, selectedHex);
  }, [contacts, selectedHex]);

  return <div ref={containerRef} className="h-full w-full" />;
}
