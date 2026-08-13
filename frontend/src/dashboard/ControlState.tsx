/*
 * The cockpit control-state readout (#7/#48): throttle, flaps, trim, gear — and speedbrake for
 * classes that have one — as LORAN mini-instruments (ControlIconCell). Value strings still come
 * from hud/format.ts so this panel can never disagree with the HUD; unknown reads as an em-dash.
 * Hook-free so the test walks the returned tree without jsdom.
 */
import type { HudSnapshot } from "../hud/snapshot";
import { formatThrottlePct, formatTrim } from "../hud/format";
import ControlIconCell from "../hud/controls/ControlIconCell";

export default function ControlState({ snapshot }: { snapshot: HudSnapshot | null }) {
  const throttle = snapshot?.throttle ?? null;
  const trim = snapshot?.trim ?? null;
  const flapLabel = snapshot?.flapLabel ?? null;
  const trimText = formatTrim(trim);
  return (
    <div className="control-state">
      <ControlIconCell kind="throttle" snapshot={snapshot} label="THR"
        value={formatThrottlePct(throttle)} valueTone={throttle != null && throttle > 0.92 ? "amber" : "cyan"} />
      <ControlIconCell kind="flaps" snapshot={snapshot} label="FLP"
        value={flapLabel ?? "—"} />
      <ControlIconCell kind="trim" snapshot={snapshot} label="TRM"
        value={trimText} valueTone={trimText === "NEUTRAL" ? "dim" : "cyan"} />
      <ControlIconCell kind="gear" snapshot={snapshot} label="GEAR" />
      {snapshot?.hasSpeedbrake && (
        <ControlIconCell kind="speedbrake" snapshot={snapshot} label="SPD BRK"
          value={snapshot?.speedbrake ? "OUT" : null} valueTone="amber" />
      )}
    </div>
  );
}
