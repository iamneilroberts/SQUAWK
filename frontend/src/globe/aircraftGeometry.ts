/*
 * Pure, Cesium-free geometry generator (issue #15). One ModelDims record -> a set of body-frame
 * line SEGMENTS forming a low-poly wireframe airframe in the LORAN flat/line visual language:
 * a slim faceted fuselage, one swept-or-straight wing, a tailplane and a vertical fin. Body axes
 * per sim/types.ts: X forward (nose), Y right wing, Z down (so "up" is -Z).
 *
 * This is deliberately a WIREFRAME of straight lines, not shaded solids: it renders as a
 * PolylineCollection (globe/aircraftModel.ts), which is the cheapest on-brand way to draw a
 * recognizable per-class silhouette with zero new dependency and no lighting/material tuning.
 * The render layer rotates these body-frame points into ECEF each frame — this file never sees
 * a position, an attitude or Cesium, so it is fully unit-testable.
 */
import type { Vec3 } from "../sim/types";
import type { ModelDims } from "./aircraftModelDims";

export type Segment = [Vec3, Vec3];
export type AirframeGeometry = { segments: Segment[] };

/**
 * A horizontal lifting surface (wing or tailplane), symmetric about the centreline. `rootLeX`
 * is the leading-edge X at the centreline; the tip is swept aft by tan(sweep)*semispan. Constant
 * chord — this is a silhouette, not an aerofoil.
 */
function horizontalSurface(
  rootLeX: number,
  span: number,
  chord: number,
  sweepRad: number,
  z: number,
): Segment[] {
  const semi = span / 2;
  const tipLeX = rootLeX - Math.tan(sweepRad) * semi;
  const segs: Segment[] = [
    // Root chord, drawn once on the centreline.
    [{ x: rootLeX, y: 0, z }, { x: rootLeX - chord, y: 0, z }],
  ];
  for (const s of [1, -1]) {
    const tipY = s * semi;
    const rootLe = { x: rootLeX, y: 0, z };
    const rootTe = { x: rootLeX - chord, y: 0, z };
    const tipLe = { x: tipLeX, y: tipY, z };
    const tipTe = { x: tipLeX - chord, y: tipY, z };
    segs.push([rootLe, tipLe]); // leading edge
    segs.push([rootTe, tipTe]); // trailing edge
    segs.push([tipLe, tipTe]); // wingtip
  }
  return segs;
}

/** The vertical fin, in the X-Z plane on the centreline, rising above the fuselage top. */
function verticalFin(dims: ModelDims): Segment[] {
  const r = dims.fuselageRadiusM;
  const top = -r; // fuselage top (up is -Z)
  const tip = -(r + dims.finHeightM);
  const baseChord = dims.tailChordM * 1.3;
  const baseTeX = -dims.lengthM / 2; // trailing edge at the tail
  const baseLeX = baseTeX + baseChord;
  const tipX = baseTeX + baseChord * 0.3; // swept back
  const baseLe = { x: baseLeX, y: 0, z: top };
  const baseTe = { x: baseTeX, y: 0, z: top };
  const finTip = { x: tipX, y: 0, z: tip };
  return [
    [baseLe, baseTe],
    [baseLe, finTip],
    [baseTe, finTip],
  ];
}

/** The slim faceted fuselage: a square-section box tapering to a nose point and a tail point. */
function fuselage(dims: ModelDims): Segment[] {
  const L = dims.lengthM;
  const r = dims.fuselageRadiusM;
  const nose = { x: L / 2, y: 0, z: 0 };
  const tail = { x: -L / 2, y: 0, z: 0 };
  const xFront = L / 2 - 0.15 * L;
  const xRear = -L / 2 + 0.1 * L;
  // Four longeron corners of the box cross-section (y, z); z<0 is up.
  const corners = [
    { y: r, z: -r },
    { y: r, z: r },
    { y: -r, z: r },
    { y: -r, z: -r },
  ];
  const segs: Segment[] = [];
  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    const next = corners[(i + 1) % 4];
    // Longeron.
    segs.push([{ x: xFront, ...c }, { x: xRear, ...c }]);
    // Front and rear rings.
    segs.push([{ x: xFront, ...c }, { x: xFront, ...next }]);
    segs.push([{ x: xRear, ...c }, { x: xRear, ...next }]);
    // Nose and tail tapers.
    segs.push([nose, { x: xFront, ...c }]);
    segs.push([tail, { x: xRear, ...c }]);
  }
  return segs;
}

export function buildAirframe(dims: ModelDims): AirframeGeometry {
  const wingRootLeX = dims.lengthM / 2 - dims.wingXFrac * dims.lengthM;
  // The tailplane is drawn UNSWEPT and placed so its trailing edge stays just ahead of the tail
  // point — the fin's trailing edge is the rearmost part of the airframe (at exactly -length/2).
  const tailRootLeX = -dims.lengthM / 2 + dims.tailChordM * 1.15;
  const segments: Segment[] = [
    ...fuselage(dims),
    ...horizontalSurface(wingRootLeX, dims.wingSpanM, dims.wingChordM, dims.wingSweepRad, 0),
    ...horizontalSurface(tailRootLeX, dims.tailSpanM, dims.tailChordM, 0, 0),
    ...verticalFin(dims),
  ];
  return { segments };
}
