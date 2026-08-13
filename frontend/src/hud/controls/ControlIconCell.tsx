/*
 * One control-state cell: the #48 mini-instrument, its uppercase label, and (for the
 * quantitative controls) a value line. Shared by the desktop glass strip, the desktop HUD
 * bottom, and the mobile rails so all three lay out identically. Hook-free.
 */
import type { HudSnapshot } from "../snapshot";
import ControlIcon, { type ControlIconKind } from "./ControlIcon";

export default function ControlIconCell({
  kind, snapshot, label, value, valueTone = "cyan",
}: {
  kind: ControlIconKind;
  snapshot: HudSnapshot | null;
  label: string;
  value?: string | null;
  valueTone?: "cyan" | "amber" | "dim";
}) {
  return (
    <div className="control-icon-cell">
      <ControlIcon kind={kind} snapshot={snapshot} />
      <span className="control-icon-label">{label}</span>
      {value != null && value !== "" && (
        <span className={`control-icon-value tone-${valueTone}`}>{value}</span>
      )}
    </div>
  );
}
