/*
 * The cockpit control-state readout (issue #7): throttle, flaps, trim and gear at a glance,
 * in the mission-terminal style. Hook-free so the test can call it as a plain function and
 * walk the returned element tree without jsdom.
 *
 * Every string comes from hud/format.ts — the same formatters the HUD's own bottom strip
 * uses — so a control this panel shows can never disagree with the HUD about the same value,
 * and an unknown value renders as an em-dash rather than a fake zero (honesty rule).
 */
import type { HudSnapshot } from "../hud/snapshot";
import { formatThrottlePct, formatFlaps, formatTrim, formatGear } from "../hud/format";

export default function ControlState({ snapshot }: { snapshot: HudSnapshot | null }) {
  const throttle = snapshot?.throttle ?? null;
  const trim = snapshot?.trim ?? null;
  const flapLabel = snapshot?.flapLabel ?? null;
  const gear = snapshot?.gear ?? null;
  const gearPosition = snapshot?.gearPosition ?? null;

  return (
    <div className="control-state">
      <span className="control-state-item">{`THR ${formatThrottlePct(throttle)}`}</span>
      <span className="control-state-item">{formatFlaps(flapLabel)}</span>
      <span className="control-state-item">{`TRIM ${formatTrim(trim)}`}</span>
      <span className="control-state-item">{formatGear(gear, gearPosition)}</span>
    </div>
  );
}
