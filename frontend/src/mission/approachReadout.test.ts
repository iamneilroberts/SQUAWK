import { describe, expect, it } from "vitest";
import { approachReadoutFor } from "./approachReadout";
import { destinationPoint } from "./geo";
import { missionProfileForClass } from "./profiles";
import type { RunwayAssignment } from "./types";

const FEET_PER_NM = 6076.11549;

// Threshold at (30, -88), landing to the east (heading 090). The approach side is west of it.
const assignment = {
  airportElevationFt: 100,
  runwayHeadingDeg: 90,
  runwayLengthFt: 6000,
  runwayWidthFt: 100,
  assignedEnd: {
    ident: "09",
    latDeg: 30,
    lonDeg: -88,
    elevationFt: 110,
    headingDeg: 90,
    displacedThresholdFt: 0,
  },
} as RunwayAssignment;

const profile = missionProfileForClass("c172s"); // 65 ± 5 KT, 3° slope, corridor 700 ft, approachLengthNm 5

/** A point `distanceNm` before the threshold on final (west of it), optionally offset `crossFt`
 *  right of the centerline (a small bearing nudge — close enough at these distances for fixtures). */
function onFinal(distanceNm: number, crossFt = 0): { latDeg: number; lonDeg: number } {
  const center = destinationPoint(assignment.assignedEnd.latDeg, assignment.assignedEnd.lonDeg, 270, distanceNm);
  if (crossFt === 0) return center;
  return destinationPoint(center.latDeg, center.lonDeg, 180, crossFt / FEET_PER_NM);
}

const targetAltAt = (distanceNm: number) =>
  110 + Math.tan((3 * Math.PI) / 180) * distanceNm * FEET_PER_NM;

describe("approachReadoutFor", () => {
  it("reads ON when altitude sits on the glide slope", () => {
    const alt = targetAltAt(3);
    const readout = approachReadoutFor(
      { ...onFinal(3), altitudeFt: alt, iasKt: 65, groundSpeedKt: 65, verticalSpeedFpm: -345 },
      assignment, profile,
    );
    expect(readout.targetAltFt).toBeCloseTo(alt, 0);
    expect(readout.altState).toBe("ON");
  });

  it("reads HIGH well above the glide slope and LOW well below it", () => {
    const alt = targetAltAt(3);
    const high = approachReadoutFor(
      { ...onFinal(3), altitudeFt: alt + 500, iasKt: 65, groundSpeedKt: 65, verticalSpeedFpm: 0 },
      assignment, profile,
    );
    const low = approachReadoutFor(
      { ...onFinal(3), altitudeFt: alt - 500, iasKt: 65, groundSpeedKt: 65, verticalSpeedFpm: 0 },
      assignment, profile,
    );
    expect(high.altState).toBe("HIGH");
    expect(low.altState).toBe("LOW");
  });

  it("reads speed FAST/SLOW/ON against the profile's target ± band", () => {
    const base = { ...onFinal(3), altitudeFt: targetAltAt(3), groundSpeedKt: 65, verticalSpeedFpm: -345 };
    expect(approachReadoutFor({ ...base, iasKt: 65 }, assignment, profile).speedState).toBe("ON");
    expect(approachReadoutFor({ ...base, iasKt: 80 }, assignment, profile).speedState).toBe("FAST");
    expect(approachReadoutFor({ ...base, iasKt: 50 }, assignment, profile).speedState).toBe("SLOW");
    expect(approachReadoutFor({ ...base, iasKt: 65 }, assignment, profile).targetSpeedKt).toBe(65);
  });

  it("computes time-to-landing from distance and groundspeed", () => {
    const readout = approachReadoutFor(
      { ...onFinal(3), altitudeFt: targetAltAt(3), iasKt: 65, groundSpeedKt: 90, verticalSpeedFpm: -345 },
      assignment, profile,
    );
    expect(readout.distanceNm).toBeCloseTo(3, 1);
    expect(readout.timeToLandingSec).toBeCloseTo((3 / 90) * 3600, 0);
  });

  it("guards a stopped/near-stopped groundspeed instead of returning Infinity", () => {
    const readout = approachReadoutFor(
      { ...onFinal(3), altitudeFt: targetAltAt(3), iasKt: 65, groundSpeedKt: 0, verticalSpeedFpm: 0 },
      assignment, profile,
    );
    expect(readout.timeToLandingSec).toBeNull();
  });

  it("computes the sink rate that rides the glide slope at the current groundspeed", () => {
    const readout = approachReadoutFor(
      { ...onFinal(3), altitudeFt: targetAltAt(3), iasKt: 65, groundSpeedKt: 65, verticalSpeedFpm: -345 },
      assignment, profile,
    );
    const expectedFpm = (65 * FEET_PER_NM / 60) * Math.tan((3 * Math.PI) / 180);
    expect(readout.targetSinkRateFpm).toBeCloseTo(expectedFpm, 0);
    expect(readout.sinkState).toBe("ON");
  });

  it("reads sink STEEP when descending much faster than the glide slope needs, SHALLOW when slower", () => {
    const base = { ...onFinal(3), altitudeFt: targetAltAt(3), iasKt: 65, groundSpeedKt: 65 };
    const steep = approachReadoutFor({ ...base, verticalSpeedFpm: -900 }, assignment, profile);
    const shallow = approachReadoutFor({ ...base, verticalSpeedFpm: -50 }, assignment, profile);
    expect(steep.sinkState).toBe("STEEP");
    expect(shallow.sinkState).toBe("SHALLOW");
  });

  it("reads course ON at the centerline, LEFT/RIGHT off it beyond the corridor half-width", () => {
    const base = { altitudeFt: targetAltAt(3), iasKt: 65, groundSpeedKt: 65, verticalSpeedFpm: -345 };
    const onCourse = approachReadoutFor({ ...onFinal(3), ...base }, assignment, profile);
    const right = approachReadoutFor({ ...onFinal(3, 500), ...base }, assignment, profile);
    const left = approachReadoutFor({ ...onFinal(3, -500), ...base }, assignment, profile);
    expect(onCourse.courseState).toBe("ON");
    expect(right.courseState).toBe("RIGHT");
    expect(left.courseState).toBe("LEFT");
  });

  it("carries the turn-to-final cue outside the FAF and drops it once established", () => {
    const base = { altitudeFt: targetAltAt(7), iasKt: 65, groundSpeedKt: 65, verticalSpeedFpm: -345 };
    // c172s finalApproachFixNm is 5.5 — 7 nm out is still outside it.
    const outside = approachReadoutFor({ ...onFinal(7), ...base }, assignment, profile);
    expect(outside.turnToFinal).not.toBeNull();
    expect(outside.turnToFinal!.distanceNm).toBeGreaterThan(0);

    const established = approachReadoutFor(
      { ...onFinal(3), altitudeFt: targetAltAt(3), iasKt: 65, groundSpeedKt: 65, verticalSpeedFpm: -345 },
      assignment, profile,
    );
    expect(established.turnToFinal).toBeNull();
  });
});
