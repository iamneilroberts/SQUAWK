/*
 * The prominent right-edge vertical throttle gauge (hud chrome rework, owner-approved mock). A
 * fill-from-bottom bar (solid cyan, no gradient — CLAUDE.md's LORAN rules) plus a big THR %
 * readout. The tiny "THR" cell that used to live in the bottom control-state strip
 * (ControlState.tsx, via ControlStateCells) is hidden there now (`hideThrottle`) so the two never
 * show the same number twice in different corners of the same screen.
 *
 * THROTTLE_AMBER_ABOVE is the SAME near-max threshold ControlStateCells uses, imported rather
 * than redefined, so this gauge and the (hidden-by-default) tiny cell can never disagree if a
 * future caller re-enables the cell. The WET/afterburner zone is a static placard mark (this
 * class CAN reach afterburner range), not a live state readout — `snapshot.afterburner` is the
 * dry/wet annunciator elsewhere (format.ts formatAfterburner); duplicating it here would be noise.
 * Hook-free like ControlStateCells: the test calls it as a plain function and walks the tree.
 */
import type { HudSnapshot } from "../hud/snapshot";
import { formatThrottlePct } from "../hud/format";
import { THROTTLE_AMBER_ABOVE } from "../hud/controls/ControlStateCells";

export default function ThrottleIndicator({
  snapshot,
  hasAfterburner,
}: {
  snapshot: HudSnapshot | null;
  hasAfterburner: boolean;
}) {
  const throttle = snapshot?.throttle ?? null;
  const fillPct = throttle === null ? 0 : Math.max(0, Math.min(1, throttle)) * 100;
  const amber = throttle !== null && throttle > THROTTLE_AMBER_ABOVE;

  return (
    <div className="dash-throttle" aria-label="Throttle">
      <div className="dash-throttle-label label">THR</div>
      <div className="dash-throttle-bar">
        {hasAfterburner && (
          <div className="dash-throttle-wet-zone" aria-hidden="true">
            <span>WET</span>
          </div>
        )}
        <div
          className={"dash-throttle-fill" + (amber ? " dash-throttle-fill-amber" : "")}
          style={{ height: `${fillPct}%` }}
        />
      </div>
      <div className={"dash-throttle-pct" + (amber ? " dash-throttle-pct-amber" : "")}>
        {formatThrottlePct(throttle)}
      </div>
    </div>
  );
}
