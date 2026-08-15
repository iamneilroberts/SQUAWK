/*
 * Store -> billboards, in every mode. Live traffic keeps rendering while you fly (it is
 * scenery, parent spec §5); only the home-camera move is BROWSE-only, because setView in
 * FLYING would fight the FPV camera.
 */
import { useEffect, useRef } from "react";
import { Cartesian3, Math as CesiumMath } from "cesium";
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
 * Browse camera's opening "hero oblique" (issue #68). The old approach hovered the camera
 * straight over home and only rotated it in place — from directly overhead the horizon never
 * enters the frame, so at a 150 NM radius (very high altitude) even a -45deg pitch still reads
 * as a flat 2D map. Instead we PLACE the camera back (south) of home and low, looking north, so
 * home sits mid-frame with the ground receding to a visible horizon + Earth curvature above —
 * the dramatic 3D first impression. 0 = level with the horizon, -90deg = straight down; a
 * shallower (less negative) pitch shows more sky/horizon.
 */
const BROWSE_TILT_PITCH_RAD = CesiumMath.toRadians(-25);
/**
 * Camera altitude as a multiple of the view radius (metres). Lower = closer/more dramatic
 * foreground; higher = more of the radius ring visible. The southward standoff is then derived
 * so the pitched sightline lands on home (see the effect). Tune alongside BROWSE_TILT_PITCH_RAD.
 */
const BROWSE_CAM_ALT_RADIUS_FACTOR = 0.85;

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
    // Hero oblique (#68): place the camera BACK (south) of home and low, looking north, so the
    // ground recedes to a visible horizon instead of hovering straight overhead. Altitude scales
    // with the view radius; the southward standoff = altitude / tan(|pitch|) puts the pitched
    // sightline on home so it sits mid-frame. Re-runs on radiusNm change, preserving #42's
    // "RADIUS chip re-frames the camera" behaviour.
    const radiusM = radiusNm * M_PER_NM;
    const altM = radiusM * BROWSE_CAM_ALT_RADIUS_FACTOR;
    const standoffM = altM / Math.tan(Math.abs(BROWSE_TILT_PITCH_RAD));
    const camLat = center.lat - standoffM / M_PER_DEG_LAT;
    const destination = Cartesian3.fromDegrees(center.lon, camLat, altM);
    bundle.viewer.camera.setView({
      destination,
      orientation: { heading: 0, pitch: BROWSE_TILT_PITCH_RAD, roll: 0 },
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
