import { describe, it, expect } from "vitest";
import { edgeTurnCue, ON_COURSE_THRESHOLD_DEG } from "./edgeTurnCue";
import type { ImmersiveHudNavCue } from "./ImmersiveHudBar";
import { degToRad } from "../sim/units";

/*
 * The edge turn cue is the mobile immersive HUD's prominent, glanceable turn indicator (#82):
 * a big amber chevron on the LEFT edge when the pilot must turn left, RIGHT edge when right, so
 * the required turn reads without parsing a signed number. This locks the pure side/threshold
 * decision — the presentational component just draws whatever this returns.
 *
 * Sign convention (from ImmersiveHudBar.relativeBearingDeg): NEGATIVE = turn LEFT, POSITIVE =
 * turn RIGHT. A dead-band around 0 shows a neutral centered "on course" state so the cue does
 * not flip sides / jitter at the boundary.
 */
const cue = (bearingDeg: number): ImmersiveHudNavCue => ({
  destination: "KGPT",
  bearingDeg,
  distanceNm: 12.3,
});

describe("edgeTurnCue", () => {
  it("returns null when there is no assigned destination", () => {
    expect(edgeTurnCue(degToRad(90), null)).toBeNull();
  });

  it("puts a left-turn destination on the LEFT with the magnitude of the turn", () => {
    // heading 090, destination bearing 000 → 90° to the LEFT of the nose (relative -90).
    const result = edgeTurnCue(degToRad(90), cue(0));
    expect(result).toEqual({ side: "left", degrees: 90 });
  });

  it("puts a right-turn destination on the RIGHT with the magnitude of the turn", () => {
    // heading 270, destination bearing 000 → 90° to the RIGHT of the nose (relative +90).
    const result = edgeTurnCue(degToRad(270), cue(0));
    expect(result).toEqual({ side: "right", degrees: 90 });
  });

  it("shows a neutral centered on-course state within the dead-band, not a flapping side", () => {
    // exactly on course
    expect(edgeTurnCue(degToRad(90), cue(90))?.side).toBe("oncourse");
    // just inside the band on either side stays neutral (no left/right flicker near 0)
    expect(edgeTurnCue(degToRad(90), cue(90 + ON_COURSE_THRESHOLD_DEG - 0.5))?.side).toBe("oncourse");
    expect(edgeTurnCue(degToRad(90), cue(90 - ON_COURSE_THRESHOLD_DEG + 0.5))?.side).toBe("oncourse");
  });

  it("commits to a side the moment the error leaves the dead-band", () => {
    // just past the threshold to the right → right; to the left → left
    expect(edgeTurnCue(degToRad(90), cue(90 + ON_COURSE_THRESHOLD_DEG + 1))?.side).toBe("right");
    expect(edgeTurnCue(degToRad(90), cue(90 - ON_COURSE_THRESHOLD_DEG - 1))?.side).toBe("left");
  });

  it("treats the exact threshold as still on course (inclusive dead-band)", () => {
    expect(edgeTurnCue(degToRad(0), cue(ON_COURSE_THRESHOLD_DEG))?.side).toBe("oncourse");
    expect(edgeTurnCue(degToRad(0), cue(360 - ON_COURSE_THRESHOLD_DEG))?.side).toBe("oncourse");
  });

  it("wraps around north without inventing a long turn", () => {
    // heading 005, destination bearing 355 → a 10° turn to the LEFT, not 350° to the right.
    expect(edgeTurnCue(degToRad(5), cue(355))).toEqual({ side: "left", degrees: 10 });
    // heading 355, destination bearing 005 → a 10° turn to the RIGHT.
    expect(edgeTurnCue(degToRad(355), cue(5))).toEqual({ side: "right", degrees: 10 });
  });

  it("rounds the displayed degrees to a whole number", () => {
    // heading 090, bearing 120.4 → +30.4 → right, 30
    expect(edgeTurnCue(degToRad(90), cue(120.4))).toEqual({ side: "right", degrees: 30 });
  });

  it("honors a caller-supplied threshold", () => {
    // a 5° error is on course under a 10° band but a turn under the default
    expect(edgeTurnCue(degToRad(90), cue(95), 10)?.side).toBe("oncourse");
    expect(edgeTurnCue(degToRad(90), cue(95))?.side).toBe("right");
  });

  it("exposes a small default dead-band (a few degrees), not zero", () => {
    expect(ON_COURSE_THRESHOLD_DEG).toBeGreaterThan(0);
    expect(ON_COURSE_THRESHOLD_DEG).toBeLessThanOrEqual(5);
  });
});
