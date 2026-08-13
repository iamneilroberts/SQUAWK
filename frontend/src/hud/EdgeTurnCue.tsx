/*
 * EdgeTurnCue (#82): the prominent, edge-anchored turn indicator for the MOBILE IMMERSIVE HUD.
 * A big amber chevron pinned to the LEFT screen edge when the pilot must turn left, the RIGHT
 * edge when turn right — so the required turn reads at the edge of vision without parsing a
 * signed number. When on course (within the dead-band) it shows a neutral centered mark instead
 * of flapping between sides. Renders nothing when there is no assigned destination.
 *
 * Hook-free and side-effect-free so it stays a plain, cheaply testable React tree. The
 * left/right/on-course decision lives in the unit-tested edgeTurnCue() helper; this component
 * only draws the result in the LORAN visual language (amber, mono, uppercase, 1px scrim).
 */
import { edgeTurnCue } from "./edgeTurnCue";
import type { ImmersiveHudNavCue } from "./ImmersiveHudBar";

const CHEVRON = { left: "◀", right: "▶" } as const; // ◀ ▶

export default function EdgeTurnCue({
  headingRad,
  navCue,
}: {
  headingRad: number;
  navCue: ImmersiveHudNavCue | null;
}) {
  const cue = edgeTurnCue(headingRad, navCue);
  if (cue === null) return null;

  if (cue.side === "oncourse") {
    return (
      <div
        className="edge-turn-cue edge-turn-cue-oncourse hud-scrim"
        data-side="oncourse"
        aria-label="On course to destination"
      >
        <span className="edge-turn-oncourse">ON COURSE</span>
      </div>
    );
  }

  return (
    <div
      className="edge-turn-cue hud-scrim"
      data-side={cue.side}
      aria-label={`Turn ${cue.side} ${cue.degrees} degrees to destination`}
    >
      <span className="edge-turn-chevron" aria-hidden="true">{CHEVRON[cue.side]}</span>
      <span className="edge-turn-degrees">{cue.degrees}°</span>
    </div>
  );
}
