/*
 * Pure, Cesium-free geometry generator (issue #15). One ModelDims record -> a small CLOSED
 * low-poly TRIANGLE mesh: a slim faceted fuselage (tapered to a nose and a tail point), one
 * swept-or-straight wing, a tailplane and a vertical fin, each a thin solid. Body axes per
 * sim/types.ts: X forward (nose), Y right wing, Z down (so "up" is -Z).
 *
 * This emits SOLID triangles, not lines: the render layer (globe/aircraftModel.ts) bakes these
 * body-frame vertices once into a Cesium Primitive and flat-shades them (face normals computed
 * from the winding), giving a solid low-poly aeroplane in the LORAN palette instead of a wireframe.
 * Every surface is wound OUTWARD and the mesh is watertight, so per-face normals point away from
 * the skin and the shading reads. This file never sees a position, an attitude or Cesium, so the
 * shape and its winding are fully unit-testable (aircraftGeometry.test.ts).
 */
import type { Vec3 } from "../sim/types";
import type { ModelDims } from "./aircraftModelDims";

/** One triangle: three body-frame vertices, wound counter-clockwise seen from OUTSIDE the skin. */
export type Triangle = [Vec3, Vec3, Vec3];
export type AirframeGeometry = { triangles: Triangle[] };

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

/**
 * A thin closed solid: the planar polygon `loop` (its bottom face) and a copy translated by
 * `offset` (its top face), joined by side walls. `loop` must be ordered counter-clockwise as seen
 * looking back along `offset` (from the +offset side); then every face comes out wound outward
 * (pinned by the positive-signed-volume test). Used for the wings, tailplane and fin.
 */
function prism(loop: Vec3[], offset: Vec3): Triangle[] {
  const top = loop.map((p) => add(p, offset));
  const n = loop.length;
  const tris: Triangle[] = [];
  for (let i = 1; i < n - 1; i++) {
    tris.push([top[0], top[i + 1], top[i]]); // top cap: normal along +offset (outward)
    tris.push([loop[0], loop[i], loop[i + 1]]); // bottom cap: normal along -offset (outward)
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push([loop[i], top[j], loop[j]]);
    tris.push([loop[i], top[i], top[j]]);
  }
  return tris;
}

/**
 * A horizontal lifting surface (wing or tailplane), one thin slab spanning tip to tip and
 * symmetric about the centreline. `rootLeX` is the leading-edge X at the centreline; each tip is
 * swept aft by tan(sweep)*semispan. Constant chord — this is a silhouette, not an aerofoil.
 */
function horizontalSurface(
  rootLeX: number,
  span: number,
  chord: number,
  sweepRad: number,
  thickness: number,
): Triangle[] {
  const semi = span / 2;
  const tipLeX = rootLeX - Math.tan(sweepRad) * semi;
  const h = thickness / 2;
  // Planform loop at the lower face (z = +h; +Z is down), ordered CCW seen from above (-Z).
  const loop: Vec3[] = [
    { x: rootLeX, y: 0, z: h }, // root leading edge (forward, centre)
    { x: tipLeX, y: semi, z: h }, // right tip leading edge
    { x: tipLeX - chord, y: semi, z: h }, // right tip trailing edge
    { x: rootLeX - chord, y: 0, z: h }, // root trailing edge (aft, centre)
    { x: tipLeX - chord, y: -semi, z: h }, // left tip trailing edge
    { x: tipLeX, y: -semi, z: h }, // left tip leading edge
  ];
  return prism(loop, { x: 0, y: 0, z: -thickness }); // extrude up to z = -h
}

/** The vertical fin: a thin triangular slab in the X-Z plane, extruded ±thickness/2 in Y. */
function verticalFin(dims: ModelDims): Triangle[] {
  const r = dims.fuselageRadiusM;
  const top = -r; // fuselage top (up is -Z)
  const tip = -(r + dims.finHeightM);
  const baseChord = dims.tailChordM * 1.3;
  const baseTeX = -dims.lengthM / 2; // trailing edge at the very tail
  const baseLeX = baseTeX + baseChord;
  const tipX = baseTeX + baseChord * 0.3; // swept back
  const thickness = Math.max(dims.tailChordM * 0.12, 0.05);
  const h = thickness / 2;
  // Loop in the y = -h plane, CCW seen from +Y (looking back along +offset).
  const loop: Vec3[] = [
    { x: baseLeX, y: -h, z: top },
    { x: baseTeX, y: -h, z: top },
    { x: tipX, y: -h, z: tip },
  ];
  return prism(loop, { x: 0, y: thickness, z: 0 });
}

/** The slim faceted fuselage: a square-section box tapering to a nose point and a tail point. */
function fuselage(dims: ModelDims): Triangle[] {
  const L = dims.lengthM;
  const r = dims.fuselageRadiusM;
  const nose: Vec3 = { x: L / 2, y: 0, z: 0 };
  const tail: Vec3 = { x: -L / 2, y: 0, z: 0 };
  const xFront = L / 2 - 0.15 * L;
  const xRear = -L / 2 + 0.1 * L;
  // Four longeron corners (y, z); z<0 is up. Ordered so the ring winds CCW seen from the nose (+X).
  const ring = [
    { y: r, z: -r },
    { y: -r, z: -r },
    { y: -r, z: r },
    { y: r, z: r },
  ];
  const front = ring.map((c) => ({ x: xFront, ...c }));
  const rear = ring.map((c) => ({ x: xRear, ...c }));
  const tris: Triangle[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tris.push([nose, front[j], front[i]]); // nose cap (apex forward, outward)
    tris.push([tail, rear[i], rear[j]]); // tail cap (apex aft, outward)
    tris.push([front[i], rear[j], rear[i]]); // side wall
    tris.push([front[i], front[j], rear[j]]);
  }
  return tris;
}

export function buildAirframe(dims: ModelDims): AirframeGeometry {
  const wingRootLeX = dims.lengthM / 2 - dims.wingXFrac * dims.lengthM;
  // The tailplane is drawn UNSWEPT, its trailing edge just ahead of the tail point so the fin's
  // trailing edge stays the rearmost part of the airframe (at exactly -length/2).
  const tailRootLeX = -dims.lengthM / 2 + dims.tailChordM * 1.15;
  const wingThk = Math.max(dims.wingChordM * 0.09, 0.06);
  const tailThk = Math.max(dims.tailChordM * 0.12, 0.05);
  const triangles: Triangle[] = [
    ...fuselage(dims),
    ...horizontalSurface(wingRootLeX, dims.wingSpanM, dims.wingChordM, dims.wingSweepRad, wingThk),
    ...horizontalSurface(tailRootLeX, dims.tailSpanM, dims.tailChordM, 0, tailThk),
    ...verticalFin(dims),
  ];
  return { triangles };
}
