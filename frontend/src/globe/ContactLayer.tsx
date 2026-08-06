/*
 * Store -> billboards, in every mode. Live traffic keeps rendering while you fly (it is
 * scenery, parent spec §5); only the home-camera move is BROWSE-only, because setView in
 * FLYING would fight the FPV camera.
 */
import { useEffect } from "react";
import { Cartesian3, Math as CesiumMath } from "cesium";
import { useStore } from "../state/store";
import { syncBillboards } from "./contactBillboards";
import { useViewer } from "./viewerContext";

const BROWSE_HEIGHT_M = 250_000;

export default function ContactLayer() {
  const bundle = useViewer();
  const contacts = useStore((s) => s.contacts);
  const selectedHex = useStore((s) => s.selectedHex);
  const home = useStore((s) => s.home);
  const mode = useStore((s) => s.mode);

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
    syncBillboards(bundle.billboards, bundle.byHex, contacts, selectedHex);
  }, [bundle, contacts, selectedHex]);

  return null;
}
