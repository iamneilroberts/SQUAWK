/*
 * Pick-to-inspect detail view for the selected ship. There is no aircraft equivalent to
 * mirror here — ContactList only surfaces a disabled TAKE CONTROLS button on select, no
 * rich field grid — so this establishes the pattern fresh, in the same mission-terminal
 * visual language (panel border, uppercase letterspaced labels, cyan data, em-dash for
 * every unknown field).
 */
import { useStore } from "../state/store";

export function formatField(value: string | number | null): string {
  return value === null ? "—" : String(value);
}

export function formatDimensions(length_m: number | null, beam_m: number | null): string {
  return length_m !== null && beam_m !== null ? `${length_m} × ${beam_m} m` : "—";
}

export function formatUnit(value: number | null, unit: string): string {
  return value === null ? "—" : `${value}${unit}`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field-row">
      <span className="label">{label}</span>
      <span className="field-value">{value}</span>
    </div>
  );
}

export default function VesselDetail() {
  const ships = useStore((s) => s.ships);
  const selectedMmsi = useStore((s) => s.selectedMmsi);
  const ship = selectedMmsi === null ? undefined : ships.get(selectedMmsi);

  if (!ship) return null;

  return (
    <div className="panel flex flex-col">
      <div className="label px-2 py-1">Vessel Detail</div>
      <Field label="Name" value={formatField(ship.name)} />
      <Field label="MMSI" value={ship.mmsi} />
      <Field label="Type" value={formatField(ship.ship_type)} />
      <Field label="Dimensions" value={formatDimensions(ship.length_m, ship.beam_m)} />
      <Field label="Draught" value={formatUnit(ship.draught_m, " M")} />
      <Field label="Nav Status" value={formatField(ship.nav_status)} />
      <Field label="Destination" value={formatField(ship.destination)} />
      <Field label="COG" value={formatUnit(ship.cog, "°")} />
      <Field label="SOG" value={formatUnit(ship.sog, " KT")} />
      <Field label="Heading" value={formatUnit(ship.heading, "°")} />
    </div>
  );
}
