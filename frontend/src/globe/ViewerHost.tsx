/*
 * Owns the Cesium Viewer, the primitive collections, click picking, the ADS-B poller and
 * the terrain provider — everything that must outlive a mode change. Children render as an
 * overlay above the canvas (HUD, cards, panels).
 *
 * Cesium ~1.143 API notes carried over from BrowseGlobe: ArcGisMapServerImageryProvider's
 * constructor is not callable directly (use the async `fromUrl` factory), and Viewer's
 * options have `baseLayer`, not `imageryProvider`. `ImageryLayer.fromProviderAsync` accepts
 * the provider promise and returns the layer synchronously, so no extra async effect.
 *
 * StrictMode: React 18 double-invokes this effect in development. The cleanup destroys
 * everything it created, so the second mount starts from nothing and exactly one Viewer is
 * ever live.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArcGisMapServerImageryProvider,
  Billboard,
  BillboardCollection,
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  LabelCollection,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from "cesium";
import { startPolling, useStore } from "../state/store";
import { attachTerrain, createSceneHeightSampler } from "./terrainProvider";
import { ViewerContext, type ViewerBundle } from "./viewerContext";

// Keyless: no Cesium ion account. Must be set before any Viewer is constructed.
// Cast needed: the installed Cesium's .d.ts types this as `string`, not nullable.
Ion.defaultAccessToken = null as unknown as string;

const ESRI_WORLD_IMAGERY_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";

type ViewerHostProps = {
  children?: ReactNode;
  /**
   * StatusBar needs the terrain tier note but lives outside this component's subtree (a
   * flex sibling in App.tsx, not a Provider descendant), so ViewerHost — the component that
   * actually has bundle access — reports it upward instead of duplicating it into zustand
   * (plan's Global Constraints cap this phase's store additions at mode/origin/endStats).
   */
  onTerrainNoteChange?: (note: string | null) => void;
};

export default function ViewerHost({ children, onTerrainNoteChange }: ViewerHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bundle, setBundle] = useState<ViewerBundle | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

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
      // A sim is the documented anti-case for requestRenderMode (research notes §5).
      requestRenderMode: false,
    });
    const billboards = viewer.scene.primitives.add(new BillboardCollection());
    const labels = viewer.scene.primitives.add(new LabelCollection());
    const byHex = new Map<string, Billboard>();

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: ScreenSpaceEventHandler.PositionedEvent) => {
      // Picking only means anything in BROWSE; while flying the canvas click resumes.
      if (useStore.getState().mode !== "BROWSE") return;
      const picked = viewer.scene.pick(click.position);
      const hex = picked?.id;
      useStore.getState().select(typeof hex === "string" && byHex.has(hex) ? hex : null);
    }, ScreenSpaceEventType.LEFT_CLICK);

    const stopPolling = startPolling();

    setBundle({
      viewer,
      billboards,
      labels,
      byHex,
      heightSampler: createSceneHeightSampler(viewer.scene),
      terrainNote: "TERRAIN LOADING…",
    });
    onTerrainNoteChange?.("TERRAIN LOADING…");

    // Terrain attaches at APP START, not at takeover: a mid-session provider swap forces a
    // full tile reload and jumps the camera (spec §3).
    void attachTerrain(viewer).then(({ note }) => {
      if (cancelled || viewer.isDestroyed()) return;
      setBundle((b) => (b === null ? b : { ...b, terrainNote: note }));
      onTerrainNoteChange?.(note);
    });

    return () => {
      cancelled = true;
      stopPolling();
      handler.destroy();
      viewer.destroy();
      setBundle(null);
      onTerrainNoteChange?.(null);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <ViewerContext.Provider value={bundle}>{children}</ViewerContext.Provider>
    </div>
  );
}
