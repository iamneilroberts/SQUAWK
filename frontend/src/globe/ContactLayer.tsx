/*
 * Store -> billboards, in every mode. Live traffic keeps rendering while you fly (it is
 * scenery, parent spec §5); only the home-camera move is BROWSE-only, because setView in
 * FLYING would fight the FPV camera.
 */
import { useEffect, useRef } from "react";
import { Cartesian3, Math as CesiumMath } from "cesium";
import type { Label } from "cesium";
import { useStore } from "../state/store";
import { syncBillboards } from "./contactBillboards";
import { syncGhostLabel } from "./ghost";
import { syncGhostModel, type GhostModelRef } from "./ghostModel";
import { useViewer } from "./viewerContext";

const BROWSE_HEIGHT_M = 250_000;

export default function ContactLayer() {
  const bundle = useViewer();
  const contacts = useStore((s) => s.contacts);
  const selectedHex = useStore((s) => s.selectedHex);
  const home = useStore((s) => s.home);
  const savedCenter = useStore((s) => s.savedCenter);
  const mode = useStore((s) => s.mode);
  const origin = useStore((s) => s.origin);
  const feedStatus = useStore((s) => s.feedStatus);
  const ghostLabelRef = useRef<{ label: Label | null }>({ label: null });
  const ghostModelRef = useRef<GhostModelRef>({ model: null, classId: null });

  // Camera waits for the real home from /api/config — never flies to an invented default.
  // Deps key on bundle?.viewer, not bundle itself: the viewer reference is stable for the
  // whole mount, but the bundle object is rebuilt when terrainNote resolves (~1s in), and
  // depending on the whole object would re-fire this and snap a mid-pan user back home.
  useEffect(() => {
    // Location lock (2026-08-11): browse camera is pinned to the fixed home location.
    // savedCenter ignored for now; custom locations return once ADS-B supports them.
    const center = home;
    if (!center || !bundle || mode !== "BROWSE") return;
    bundle.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(center.lon, center.lat, BROWSE_HEIGHT_M),
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
    });
  }, [home, savedCenter, bundle?.viewer, mode]);

  useEffect(() => {
    if (!bundle) return;
    syncBillboards(bundle.billboards, bundle.byHex, contacts, selectedHex, {
      ghostHex: origin?.hex ?? null,
      feedStatus,
    });
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
  }, [bundle, contacts, selectedHex, origin, feedStatus]);

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
