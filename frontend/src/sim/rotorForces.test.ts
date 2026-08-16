/*
 * The rotor force model's testable core (#30) — mirrors sim/envelope.test.ts's spirit (fly the
 * real integrator, not a hand-rolled formula) but at the scope this model actually claims:
 * hover, translate, and a controlled descent. No stall, no autorotation, no ground effect — see
 * rotorForces.ts's header for the full non-goals list this file does NOT test.
 */
import { describe, it, expect } from "vitest";
import { loadR44 } from "./params";
import { computeRotorForces, hoverCollective } from "./rotorForces";
import { stepAircraft } from "./aircraft";
import { geodeticToEcef, geodeticSurfaceNormal } from "./geo";
import { quatFromHpr, qRotate } from "./quat";
import { vDot, vSub, vScale } from "./vec3";
import { degToRad } from "./units";
import type { ControlVector, SimState } from "./types";

const P = loadR44();
const LAT = degToRad(30.6944);
const LON = degToRad(-88.0399);

const COLD: ControlVector = {
  pitch: 0, roll: 0, yaw: 0, throttle: 0, flapDetent: 0, trim: 0,
  gearDown: true, afterburner: false, speedbrake: false,
};

/** Level, stationary hover state at the given collective and altitude. */
function hoverState(altitudeM: number, collective: number): SimState {
  const position = geodeticToEcef(LAT, LON, altitudeM);
  const attitude = quatFromHpr(position, 0, 0, 0);
  return {
    position,
    velocity: { x: 0, y: 0, z: 0 },
    attitude,
    rates: { x: 0, y: 0, z: 0 },
    timeS: 0,
    altitudeM,
    tasMs: 0, iasMs: 0, aoaRad: 0, sideslipRad: 0, verticalSpeedMs: 0,
    loadFactor: 1, gLimited: false, stalled: false, machNumber: 0, gearPosition: 1,
  };
}

/** Net accel along local "up" (m/s^2): positive = climbing. */
function verticalAccel(state: SimState, controls: ControlVector): number {
  const f = computeRotorForces(state, controls, P);
  const up = geodeticSurfaceNormal(state.position);
  return vDot(f.forceEcef, up) / P.massKg;
}

describe("rotorForces — hover equilibrium", () => {
  it("holds level at the hover collective (net vertical accel ~= 0)", () => {
    const collective = hoverCollective(P, 0);
    const state = hoverState(0, collective);
    const controls = { ...COLD, throttle: collective };
    expect(Math.abs(verticalAccel(state, controls))).toBeLessThan(1e-6);
  });

  it("hover collective is inside [0, 1] and scales with density at altitude", () => {
    const seaLevel = hoverCollective(P, 0);
    const highAlt = hoverCollective(P, 3000);
    expect(seaLevel).toBeGreaterThan(0);
    expect(seaLevel).toBeLessThan(1);
    // Thinner air at altitude needs MORE collective to hold the same weight.
    expect(highAlt).toBeGreaterThan(seaLevel);
  });
});

describe("rotorForces — collective controls climb/descend, monotonically", () => {
  const state = hoverState(0, 0);
  const hover = hoverCollective(P, 0);

  it("above hover collective climbs, below it descends", () => {
    expect(verticalAccel(state, { ...COLD, throttle: hover + 0.1 })).toBeGreaterThan(0);
    expect(verticalAccel(state, { ...COLD, throttle: hover - 0.1 })).toBeLessThan(0);
  });

  it("is monotonically increasing in collective", () => {
    const samples = [0, 0.25, 0.5, 0.75, 1.0].map((c) => verticalAccel(state, { ...COLD, throttle: c }));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });
});

describe("rotorForces — no stall floor", () => {
  it("never reports stalled, at hover or in forward flight", () => {
    const hover = hoverCollective(P, 0);
    const atRest = hoverState(0, hover);
    expect(computeRotorForces(atRest, { ...COLD, throttle: hover }, P).stalled).toBe(false);

    const position = geodeticToEcef(LAT, LON, 0);
    const attitude = quatFromHpr(position, 0, 0, 0);
    const translating: SimState = {
      ...atRest,
      velocity: qRotate(attitude, { x: 40, y: 0, z: 0 }),
    };
    expect(computeRotorForces(translating, { ...COLD, throttle: hover }, P).stalled).toBe(false);
  });

  it("vertical thrust does not depend on forward airspeed (unlike a wing)", () => {
    const hover = hoverCollective(P, 0);
    const controls = { ...COLD, throttle: hover };
    const position = geodeticToEcef(LAT, LON, 0);
    const attitude = quatFromHpr(position, 0, 0, 0);
    const stationary = hoverState(0, hover);
    const translating: SimState = { ...stationary, velocity: qRotate(attitude, { x: 40, y: 0, z: 0 }) };

    // Level attitude => drag (opposing a purely horizontal velocity) has no vertical component,
    // so any difference in vertical accel between these two states would have to come from the
    // rotor thrust itself changing with airspeed — which it must not.
    const dv = Math.abs(verticalAccel(translating, controls) - verticalAccel(stationary, controls));
    expect(dv).toBeLessThan(1e-6);
  });
});

describe("rotorForces — cyclic tilt translates", () => {
  it("a pitched attitude produces a horizontal force aligned with the tilt", () => {
    const hover = hoverCollective(P, 0);
    const position = geodeticToEcef(LAT, LON, 0);
    const pitchRad = degToRad(15);
    const attitude = quatFromHpr(position, 0, pitchRad, 0);
    const state: SimState = { ...hoverState(0, hover), attitude };
    const f = computeRotorForces(state, { ...COLD, throttle: hover }, P);

    const up = geodeticSurfaceNormal(position);
    const horizontal = (v: { x: number; y: number; z: number }) => vSub(v, vScale(up, vDot(v, up)));
    // The rotor thrust axis is the body's -Z (up) axis; tilting the body tilts that axis, and
    // (at zero velocity, so no drag) the net force's horizontal component must point the same
    // way as that tilted axis's horizontal projection.
    const thrustAxisEcef = qRotate(attitude, { x: 0, y: 0, z: -1 });
    const hForce = horizontal(f.forceEcef);
    const hAxis = horizontal(thrustAxisEcef);
    expect(vDot(hForce, hAxis)).toBeGreaterThan(0);
    expect(Math.hypot(hForce.x, hForce.y, hForce.z)).toBeGreaterThan(1); // not a rounding-noise zero
  });

  it("sustained cyclic input moves the aircraft horizontally (full seam: aircraft.ts -> rotorForces.ts)", () => {
    const hover = hoverCollective(P, 0);
    let state = hoverState(500, hover);
    const start = state.position;

    // Hold nose-tilting cyclic for 2 s (builds a pitch attitude, no restoring stiffness), then
    // release and let it fly for another 3 s.
    for (let i = 0; i < 120; i++) {
      state = stepAircraft(state, { ...COLD, throttle: hover, pitch: 1 }, P);
    }
    for (let i = 0; i < 180; i++) {
      state = stepAircraft(state, { ...COLD, throttle: hover }, P);
    }

    const up = geodeticSurfaceNormal(start);
    const displacement = vSub(state.position, start);
    const horizontalDisp = vSub(displacement, vScale(up, vDot(displacement, up)));
    const horizontalDistM = Math.hypot(horizontalDisp.x, horizontalDisp.y, horizontalDisp.z);
    expect(horizontalDistM).toBeGreaterThan(20); // meaningfully translated, not just drifted
  });
});

describe("rotorForces — controllable descent", () => {
  it("settles toward a finite terminal descent rate at zero collective (not a runaway)", () => {
    let state = hoverState(3000, 0);
    const controls = { ...COLD, throttle: 0 };
    for (let i = 0; i < 20 * 60; i++) state = stepAircraft(state, controls, P);
    const vsAt20s = -state.verticalSpeedMs;
    for (let i = 0; i < 10 * 60; i++) state = stepAircraft(state, controls, P);
    const vsAt30s = -state.verticalSpeedMs;
    // Still descending, but the rate has stopped growing — a terminal velocity, not a runaway.
    expect(vsAt20s).toBeGreaterThan(0);
    expect(Math.abs(vsAt30s - vsAt20s)).toBeLessThan(0.5);
  });

  it("a moderate collective deficit gives a slow, controllable descent, not a plummet", () => {
    const hover = hoverCollective(P, 0);
    let state = hoverState(500, hover);
    const controls = { ...COLD, throttle: hover * 0.85 };
    for (let i = 0; i < 15 * 60; i++) state = stepAircraft(state, controls, P);
    const sinkMs = -state.verticalSpeedMs;
    expect(sinkMs).toBeGreaterThan(0);
    expect(sinkMs).toBeLessThan(5); // well short of the zero-collective terminal rate
  });
});
