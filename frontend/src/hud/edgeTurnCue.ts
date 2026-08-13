/*
 * Edge turn cue (#82): the mobile immersive HUD's prominent, glanceable turn indicator. This is
 * the pure side/threshold decision — given the current heading and the assigned destination it
 * says which SCREEN EDGE the turn chevron belongs on and how many degrees to turn. The
 * presentational component (EdgeTurnCue.tsx) just draws whatever this returns.
 *
 * Sign convention comes from ImmersiveHudBar.relativeBearingDeg: NEGATIVE = turn LEFT, POSITIVE =
 * turn RIGHT. A dead-band around 0 emits a neutral "on course" state instead of a side, so the
 * cue does not flip left/right or jitter when the aircraft is tracking the destination.
 */
import { relativeBearingDeg, type ImmersiveHudNavCue } from "./ImmersiveHudBar";

/** Within this many degrees of the destination bearing, show the neutral centered "on course"
 *  state rather than a left/right chevron. The dead-band prevents side-flicker near zero error. */
export const ON_COURSE_THRESHOLD_DEG = 3;

export type EdgeTurnCueResult = {
  side: "left" | "right" | "oncourse";
  /** Absolute turn magnitude, rounded to whole degrees. */
  degrees: number;
};

export function edgeTurnCue(
  headingRad: number,
  navCue: ImmersiveHudNavCue | null,
  onCourseThresholdDeg: number = ON_COURSE_THRESHOLD_DEG,
): EdgeTurnCueResult | null {
  if (navCue === null) return null;
  const relative = relativeBearingDeg(headingRad, navCue.bearingDeg);
  const degrees = Math.abs(Math.round(relative));
  if (Math.abs(relative) <= onCourseThresholdDeg) {
    return { side: "oncourse", degrees };
  }
  return { side: relative < 0 ? "left" : "right", degrees };
}
