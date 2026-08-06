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
import { useViewer } from "./viewerContext";

const BROWSE_HEIGHT_M = 250_000;

export default function ContactLayer() {
  const bundle = useViewer();
  const contacts = useStore((s) => s.contacts);
  const selectedHex = useStore((s) => s.selectedHex);
  const home = useStore((s) => s.home);
  const mode = useStore((s) => s.mode);
  const origin = useStore((s) => s.origin);
  const feedStatus = useStore((s) => s.feedStatus);
  const ghostLabelRef = useRef<{ label: Label | null }>({ label: null });

  // Camera waits for the real home from /api/config — never flies to an invented default.
  // Deps key on bundle?.viewer, not bundle itself: the viewer reference is stable for the
  // whole mount, but the bundle object is rebuilt when terrainNote resolves (~1s in), and
  // depending on the whole object would re-fire this and snap a mid-pan user back home.
  useEffect(() => {
    if (!home || !bundle || mode !== "BROWSE") return;
    bundle.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(home.lon, home.lat, BROWSE_HEIGHT_M),
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
    });
  }, [home, bundle?.viewer, mode]);

  useEffect(() => {
    if (!bundle) return;
    syncBillboards(bundle.billboards, bundle.byHex, contacts, selectedHex, {
      ghostHex: origin?.hex ?? null,
    });
    syncGhostLabel(
      bundle.labels,
      ghostLabelRef.current,
      origin ? contacts.get(origin.hex) : undefined,
      feedStatus,
    );
  }, [bundle, contacts, selectedHex, origin, feedStatus]);

  return null;
}
