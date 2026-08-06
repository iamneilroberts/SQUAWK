import { describe, it, expect } from "vitest";
import { PerspectiveFrustum, type Viewer } from "cesium";
import {
  lowPassCoefficient,
  lowPassAngleRad,
  EYE_OFFSET_BODY_M,
  createFpvCamera,
} from "./fpvCamera";
import { degToRad, radToDeg } from "../sim/units";
import { loadC172 } from "../sim/params";
import { buildSpawnState } from "../takeover/spawn";
import { hprFromQuat } from "../sim/quat";
import { vLength, vSub } from "../sim/vec3";
import type { SimState } from "../sim/types";
import type { Contact } from "../data/types";

describe("lowPassCoefficient", () => {
  it("is between 0 and 1 across the specced 5-15 Hz band at 60 fps", () => {
    for (const hz of [5, 10, 15]) {
      const c = lowPassCoefficient(hz, 1 / 60);
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThan(1);
    }
  });
  it("a higher cutoff follows the raw attitude more closely", () => {
    expect(lowPassCoefficient(15, 1 / 60)).toBeGreaterThan(lowPassCoefficient(5, 1 / 60));
  });
  it("a longer frame catches up more per frame, so the filter is frame-rate independent", () => {
    expect(lowPassCoefficient(10, 1 / 30)).toBeGreaterThan(lowPassCoefficient(10, 1 / 60));
  });
  it("saturates at 1 rather than overshooting after a very long frame", () => {
    expect(lowPassCoefficient(10, 5)).toBeLessThanOrEqual(1);
  });
});

describe("lowPassAngleRad", () => {
  it("moves partway toward the target", () => {
    const out = lowPassAngleRad(0, degToRad(10), 0.5);
    expect(radToDeg(out)).toBeCloseTo(5, 6);
  });
  it("takes the short way round 359 -> 001, not the long way through 180", () => {
    const out = radToDeg(lowPassAngleRad(degToRad(359), degToRad(1), 0.5));
    const normalized = (out + 360) % 360;
    expect(normalized > 359.5 || normalized < 0.5).toBe(true);
  });
  it("takes the short way round 001 -> 359 as well", () => {
    const out = (radToDeg(lowPassAngleRad(degToRad(1), degToRad(359), 0.5)) + 360) % 360;
    expect(out > 359.5 || out < 0.5).toBe(true);
  });
  it("with coefficient 1 it snaps to the target", () => {
    expect(radToDeg(lowPassAngleRad(degToRad(30), degToRad(120), 1))).toBeCloseTo(120, 6);
  });
  it("with coefficient 0 it does not move", () => {
    expect(lowPassAngleRad(0.4, 1.9, 0)).toBeCloseTo(0.4, 12);
  });
  it("handles a 180 degree reversal without producing NaN", () => {
    expect(Number.isFinite(lowPassAngleRad(0, Math.PI, 0.5))).toBe(true);
  });
});

describe("eye point", () => {
  it("sits ahead of and above the CG (body z is down, so up is negative)", () => {
    expect(EYE_OFFSET_BODY_M.x).toBeGreaterThan(0);
    expect(EYE_OFFSET_BODY_M.z).toBeLessThan(0);
  });
});

/*
 * enter()/exit() carry spec §6's "no residue" promise: three globe settings are changed for
 * the flight and every one of them has to go back exactly as it was found, whatever BROWSE
 * had them set to. A plain object shaped like the bits of Viewer the camera touches is
 * enough to pin that — no WebGL, no real Viewer.
 */
type SetViewCall = {
  destination: { x: number; y: number; z: number };
  orientation: { heading: number; pitch: number; roll: number };
};

type Priors = { enableInputs: boolean; depthTest: boolean; near: number };
const BROWSE_PRIORS: Priors = { enableInputs: true, depthTest: false, near: 0.1 };

function fakeViewer(opts: { perspective?: boolean; priors?: Priors } = {}) {
  const priors = opts.priors ?? BROWSE_PRIORS;
  const views: SetViewCall[] = [];
  const perspective = new PerspectiveFrustum();
  perspective.near = priors.near;
  const frustum: unknown = opts.perspective === false ? { near: priors.near } : perspective;
  const viewer = {
    scene: {
      screenSpaceCameraController: { enableInputs: priors.enableInputs },
      globe: { depthTestAgainstTerrain: priors.depthTest },
    },
    camera: {
      frustum,
      setView(o: SetViewCall) {
        views.push(o);
      },
    },
  };
  return { viewer: viewer as unknown as Viewer, raw: viewer, views };
}

const P = loadC172();
const contact = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.6944, lon: -88.0399,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 0, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});
const stateHeading = (trackDeg: number): SimState =>
  buildSpawnState(contact({ track: trackDeg }), P, { terrainHeightM: 100 }).state;

describe("fpv camera enter/exit", () => {
  it("enter takes the globe over: inputs off, near plane at 1 m, terrain depth test on", () => {
    const { viewer, raw } = fakeViewer();
    createFpvCamera(viewer).enter();
    expect(raw.scene.screenSpaceCameraController.enableInputs).toBe(false);
    expect(raw.scene.globe.depthTestAgainstTerrain).toBe(true);
    expect((raw.camera.frustum as PerspectiveFrustum).near).toBe(1.0);
  });
  it("exit restores all three to what BROWSE had, not to Cesium's defaults", () => {
    const { viewer, raw } = fakeViewer();
    const camera = createFpvCamera(viewer);
    camera.enter();
    camera.exit();
    expect(raw.scene.screenSpaceCameraController.enableInputs).toBe(true);
    expect(raw.scene.globe.depthTestAgainstTerrain).toBe(false);
    expect((raw.camera.frustum as PerspectiveFrustum).near).toBe(0.1);
  });
  it("restores the priors it actually found, not a hard-coded set of them", () => {
    // Deliberately the opposite of every default: a restore written as "put it back to
    // enableInputs=true / depthTest=false / near=1" passes the test above and fails here.
    const priors = { enableInputs: false, depthTest: true, near: 42 };
    const { viewer, raw } = fakeViewer({ priors });
    const camera = createFpvCamera(viewer);
    camera.enter();
    camera.exit();
    expect(raw.scene.screenSpaceCameraController.enableInputs).toBe(false);
    expect(raw.scene.globe.depthTestAgainstTerrain).toBe(true);
    expect((raw.camera.frustum as PerspectiveFrustum).near).toBe(42);
  });
  it("a non-perspective frustum is left alone rather than crashing the takeover", () => {
    const { viewer, raw } = fakeViewer({ perspective: false });
    const camera = createFpvCamera(viewer);
    camera.enter();
    expect((raw.camera.frustum as { near: number }).near).toBe(0.1); // untouched
    expect(raw.scene.globe.depthTestAgainstTerrain).toBe(true); // the other two still applied
    camera.exit();
    expect((raw.camera.frustum as { near: number }).near).toBe(0.1);
  });
  it("enter re-primes, so a second flight does not inherit the first one's filter state", () => {
    const { viewer, views } = fakeViewer();
    const camera = createFpvCamera(viewer);
    camera.enter();
    camera.update(stateHeading(0), 1 / 60);
    camera.exit();

    camera.enter();
    const east = stateHeading(90);
    camera.update(east, 1 / 60);
    const target = hprFromQuat(east.attitude, east.position);
    expect(views[views.length - 1].orientation.heading).toBeCloseTo(target.headingRad, 9);
  });
});

describe("fpv camera update", () => {
  it("the first update snaps to the raw attitude instead of swinging in from zero", () => {
    const { viewer, views } = fakeViewer();
    const camera = createFpvCamera(viewer);
    camera.enter();
    const s = stateHeading(270);
    camera.update(s, 1 / 60);
    const target = hprFromQuat(s.attitude, s.position);
    expect(views).toHaveLength(1);
    expect(views[0].orientation.heading).toBeCloseTo(target.headingRad, 9);
    expect(views[0].orientation.pitch).toBeCloseTo(target.pitchRad, 9);
    expect(views[0].orientation.roll).toBeCloseTo(target.rollRad, 9);
  });
  it("later updates lag the attitude — that is the difference from a bolted-on camera", () => {
    const { viewer, views } = fakeViewer();
    const camera = createFpvCamera(viewer);
    camera.enter();
    camera.update(stateHeading(0), 1 / 60);
    const east = stateHeading(90);
    camera.update(east, 1 / 60);

    const from = views[0].orientation.heading;
    const to = hprFromQuat(east.attitude, east.position).headingRad;
    const now = views[1].orientation.heading;
    expect(now).toBeGreaterThan(from); // it moved toward the new heading
    expect(now).toBeLessThan(to); // but did not snap to it
  });
  it("the eye point sits within a couple of metres of the CG, not at it", () => {
    const { viewer, views } = fakeViewer();
    const camera = createFpvCamera(viewer);
    camera.enter();
    const s = stateHeading(0);
    camera.update(s, 1 / 60);
    const offsetM = vLength(vSub(views[0].destination, s.position));
    expect(offsetM).toBeGreaterThan(0.5);
    expect(offsetM).toBeCloseTo(vLength(EYE_OFFSET_BODY_M), 6); // rotation preserves length
  });
});
