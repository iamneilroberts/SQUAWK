/*
 * Store -> billboards, in every mode. Live traffic keeps rendering while you fly (it is
 * scenery, parent spec §5); only the home-camera move is BROWSE-only, because setView in
 * FLYING would fight the FPV camera.
 */
import { useEffect, useRef } from "react";
import { Math as CesiumMath, Rectangle } from "cesium";
import type { Label } from "cesium";
import { useStore } from "../state/store";
import { syncBillboards, visibleContactsForBillboards } from "./contactBillboards";
import { syncGhostLabel } from "./ghost";
import { syncGhostModel, type GhostModelRef } from "./ghostModel";
import { useViewer } from "./viewerContext";

/** Metres per degree of latitude (and of longitude at the equator) — WGS84 is close enough
 * here; this only sizes a camera-framing rectangle, not anything collision- or nav-relevant. */
const M_PER_DEG_LAT = 111_320;
const M_PER_NM = 1852;

/**
 * Bounding rectangle (degrees) for a circle of `radiusNm` centred on `centerLat`/`centerLon` —
 * the browse camera's "frame the selected radius" extent (issue #42). A bounding square rather
 * than a true circle: Cesium's `camera.setView({ destination })` takes a Rectangle and computes
 * the height itself, so squaring the circle here is what actually drives the framing.
 */
export function radiusRectangleDeg(
  centerLat: number,
  centerLon: number,
  radiusNm: number,
): { west: number; south: number; east: number; north: number } {
  const radiusM = radiusNm * M_PER_NM;
  const latDeltaDeg = radiusM / M_PER_DEG_LAT;
  const lonDeltaDeg = radiusM / (M_PER_DEG_LAT * Math.cos(CesiumMath.toRadians(centerLat)));
  return {
    west: centerLon - lonDeltaDeg,
    east: centerLon + lonDeltaDeg,
    south: centerLat - latDeltaDeg,
    north: centerLat + latDeltaDeg,
  };
}

export default function ContactLayer() {
  const bundle = useViewer();
  const contacts = useStore((s) => s.contacts);
  const selectedHex = useStore((s) => s.selectedHex);
  const home = useStore((s) => s.home);
  const savedCenter = useStore((s) => s.savedCenter);
  const mode = useStore((s) => s.mode);
  const radiusNm = useStore((s) => s.radiusNm);
  const origin = useStore((s) => s.origin);
  const feedStatus = useStore((s) => s.feedStatus);
  const showOtherAircraft = useStore((s) => s.showOtherAircraft);
  const ghostLabelRef = useRef<{ label: Label | null }>({ label: null });
  const ghostModelRef = useRef<GhostModelRef>({ model: null, classId: null });

  // Camera waits for the real home from /api/config — never flies to an invented default.
  // Deps key on bundle?.viewer, not bundle itself: the viewer reference is stable for the
  // whole mount, but the bundle object is rebuilt when terrainNote resolves (~1s in), and
  // depending on the whole object would re-fire this and snap a mid-pan user back home.
  // radiusNm is also a dep (#42): cycling the RADIUS chip re-frames the camera on the new
  // radius, so the change is visible immediately instead of only affecting the next fetch.
  useEffect(() => {
    // Location lock (2026-08-11): browse camera is pinned to the fixed home location.
    // savedCenter ignored for now; custom locations return once ADS-B supports them.
    const center = home;
    if (!center || !bundle || mode !== "BROWSE") return;
    const rect = radiusRectangleDeg(center.lat, center.lon, radiusNm);
    bundle.viewer.camera.setView({
      destination: Rectangle.fromDegrees(rect.west, rect.south, rect.east, rect.north),
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
    });
  }, [home, savedCenter, bundle?.viewer, mode, radiusNm]);

  useEffect(() => {
    if (!bundle) return;
    const ghostHex = origin?.hex ?? null;
    // "Display other aircraft" (#85): when off, every billboard except the origin ghost's is
    // gated out here. The ghost's own label/model sync below is untouched by the toggle, and
    // own-ship isn't part of this map at all — it renders through aircraftModel.ts.
    syncBillboards(
      bundle.billboards,
      bundle.byHex,
      visibleContactsForBillboards(contacts, ghostHex, showOtherAircraft),
      selectedHex,
      { ghostHex, feedStatus },
    );
    syncGhostLabel(
      bundle.labels,
      ghostLabelRef.current,
      origin ? contacts.get(origin.hex) : undefined,
      feedStatus,
    );
    // The live-feed ghost gets the same per-class low-poly model (issue #15), in its distinct
    // non-SIM cyan styling so it stays unmistakable from the player's amber SIM aircraft. It is
    // oriented from the real ADS-B track, level — no attitude is faked from data that lacks it.
    syncGhostModel(bundle.viewer, ghostModelRef.current, origin, contacts.get(origin?.hex ?? ""));
  }, [bundle, contacts, selectedHex, origin, feedStatus, showOtherAircraft]);

  // Destroy the ghost model when the layer unmounts (viewer teardown).
  useEffect(() => {
    const ref = ghostModelRef.current;
    return () => {
      ref.model?.destroy();
      ref.model = null;
      ref.classId = null;
    };
  }, []);

  return null;
}
