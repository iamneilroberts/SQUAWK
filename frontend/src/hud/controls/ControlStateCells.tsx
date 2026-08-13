/*
 * The shared #48 control-state row: throttle, flaps, trim, gear — and speedbrake for classes
 * that have one — as LORAN mini-instrument cells (ControlIconCell). This is the SINGLE source of
 * the value/tone/gating logic; the desktop glass strip (ControlState) and the desktop HUD bottom
 * (HudControlRow) both render it inside their own wrapper element, so the two can never disagree.
 * Value strings come from hud/format.ts. Hook-free so the test walks the returned tree without jsdom.
 */
import type { HudSnapshot } from "../snapshot";
import { EM_DASH, formatThrottlePct, formatTrim } from "../format";
import ControlIconCell from "./ControlIconCell";

/** Throttle value goes amber above this fraction (near-max power cue). */
export const THROTTLE_AMBER_ABOVE = 0.92;

export default function ControlStateCells({ snapshot }: { snapshot: HudSnapshot | null }) {
  const throttle = snapshot?.throttle ?? null;
  const trimText = formatTrim(snapshot?.trim ?? null);
  return (
    <>
      <ControlIconCell kind="throttle" snapshot={snapshot} label="THR"
        value={formatThrottlePct(throttle)}
        valueTone={throttle != null && throttle > THROTTLE_AMBER_ABOVE ? "amber" : "cyan"} />
      <ControlIconCell kind="flaps" snapshot={snapshot} label="FLP"
        value={snapshot?.flapLabel ?? EM_DASH} />
      <ControlIconCell kind="trim" snapshot={snapshot} label="TRM"
        value={trimText} valueTone={trimText === "NEUTRAL" ? "dim" : "cyan"} />
      <ControlIconCell kind="gear" snapshot={snapshot} label="GEAR" />
      {snapshot?.hasSpeedbrake && (
        <ControlIconCell kind="speedbrake" snapshot={snapshot} label="SPD BRK"
          value={snapshot?.speedbrake ? "OUT" : null} valueTone="amber" />
      )}
    </>
  );
}
