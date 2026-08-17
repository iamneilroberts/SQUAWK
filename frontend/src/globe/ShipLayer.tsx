/*
 * Store -> ship billboards. Parallel to ContactLayer, but for the AIS ship feed: its own
 * dedicated BillboardCollection (created by ViewerHost, carried on the viewer bundle) keyed by
 * MMSI, synced in place on every ship/selection update. Picking is handled centrally in
 * ViewerHost's one LEFT_CLICK handler (which routes an MMSI hit to `selectShip`), so this layer
 * is sync-only — no camera move, no ghost, no separate handler.
 *
 * Like ContactLayer this renders nothing; it is a side-effect layer that reads the store and
 * mutates Cesium primitives. Ships with no position fix are dropped inside syncShipBillboards —
 * never an invented position (ground rule 1).
 */
import { useEffect } from "react";
import { useStore } from "../state/store";
import { syncShipBillboards } from "./shipBillboards";
import { useViewer } from "./viewerContext";

export default function ShipLayer() {
  const bundle = useViewer();
  const ships = useStore((s) => s.ships);
  const selectedMmsi = useStore((s) => s.selectedMmsi);

  useEffect(() => {
    if (!bundle) return;
    syncShipBillboards(bundle.shipBillboards, bundle.byMmsi, ships, selectedMmsi);
  }, [bundle, ships, selectedMmsi]);

  return null;
}
