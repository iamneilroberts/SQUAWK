/*
 * The cockpit control-state readout (#7/#48): the shared control-state cells wrapped in the glass
 * strip's own element. All value/tone/gating logic lives in ControlStateCells so this panel can
 * never disagree with the HUD bottom strip. Hook-free so the test walks the returned tree without jsdom.
 *
 * #hud-chrome-rework: throttle is hidden here — the split-HUD now has its own prominent right-edge
 * throttle gauge (ThrottleIndicator, UnifiedGlass.tsx), and showing the same % twice (a tiny cell
 * down here AND a big bar on the edge) reads as a disagreement waiting to happen, not a feature.
 */
import type { HudSnapshot } from "../hud/snapshot";
import ControlStateCells from "../hud/controls/ControlStateCells";

export default function ControlState({ snapshot }: { snapshot: HudSnapshot | null }) {
  return (
    <div className="control-state">
      <ControlStateCells snapshot={snapshot} hideThrottle />
    </div>
  );
}
