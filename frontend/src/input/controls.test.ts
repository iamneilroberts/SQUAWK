import { describe, it, expect } from "vitest";
import { createControlSampler, KEYMAP } from "./controls";
import { loadC172 } from "../sim/params";

const P = loadC172();
const DT = 1 / 60;

/** Sample `ticks` times with the same keys held. */
function hold(sampler: ReturnType<typeof createControlSampler>, keys: string[], ticks: number) {
  const set = new Set(keys);
  let last = sampler.sample(set, DT);
  for (let i = 1; i < ticks; i++) last = sampler.sample(set, DT);
  return last;
}

describe("control sampler — stick", () => {
  it("starts centred with idle throttle, flaps up and neutral trim", () => {
    const s = createControlSampler(P);
    const c = s.sample(new Set(), DT);
    expect(c).toEqual({ pitch: 0, roll: 0, yaw: 0, throttle: 0, flapDetent: 0, trim: 0, gearDown: false, afterburner: false });
  });
  it("ArrowDown pitches up, ArrowUp pitches down", () => {
    expect(hold(createControlSampler(P), ["ArrowDown"], 60).pitch).toBeGreaterThan(0);
    expect(hold(createControlSampler(P), ["ArrowUp"], 60).pitch).toBeLessThan(0);
  });
  it("ArrowRight rolls right, ArrowLeft rolls left", () => {
    expect(hold(createControlSampler(P), ["ArrowRight"], 60).roll).toBeGreaterThan(0);
    expect(hold(createControlSampler(P), ["ArrowLeft"], 60).roll).toBeLessThan(0);
  });
  it("KeyD is right rudder, KeyA is left", () => {
    expect(hold(createControlSampler(P), ["KeyD"], 60).yaw).toBeGreaterThan(0);
    expect(hold(createControlSampler(P), ["KeyA"], 60).yaw).toBeLessThan(0);
  });
  it("simultaneous keys produce a combined deflection", () => {
    const c = hold(createControlSampler(P), ["ArrowLeft", "ArrowDown", "KeyD"], 60);
    expect(c.roll).toBeLessThan(0);
    expect(c.pitch).toBeGreaterThan(0);
    expect(c.yaw).toBeGreaterThan(0);
  });
  it("opposing keys cancel to centre", () => {
    const c = hold(createControlSampler(P), ["ArrowLeft", "ArrowRight"], 60);
    expect(c.roll).toBeCloseTo(0, 6);
  });
  it("ramps in rather than snapping to full deflection in one tick", () => {
    const s = createControlSampler(P);
    const first = s.sample(new Set(["ArrowDown"]), DT);
    expect(first.pitch).toBeGreaterThan(0);
    expect(first.pitch).toBeLessThan(0.5);
  });
  it("saturates at 1 no matter how long the key is held", () => {
    expect(hold(createControlSampler(P), ["ArrowDown"], 600).pitch).toBeCloseTo(1, 6);
  });
  it("self-centres when the key is released", () => {
    const s = createControlSampler(P);
    hold(s, ["ArrowDown"], 600);
    for (let i = 0; i < 600; i++) s.sample(new Set(), DT);
    expect(s.sample(new Set(), DT).pitch).toBeCloseTo(0, 6);
  });
});

describe("control sampler — throttle", () => {
  it("ramps up over about two seconds from idle to full", () => {
    const s = createControlSampler(P);
    const half = hold(s, ["KeyW"], 60).throttle;
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.7);
    expect(hold(s, ["KeyW"], 180).throttle).toBeCloseTo(1, 6);
  });
  it("clamps to [0, 1]", () => {
    const s = createControlSampler(P);
    expect(hold(s, ["KeyW"], 600).throttle).toBe(1);
    expect(hold(s, ["KeyS"], 600).throttle).toBe(0);
  });
  it("holds its setting when no throttle key is held (it is a lever, not a spring)", () => {
    const s = createControlSampler(P);
    hold(s, ["KeyW"], 60);
    const held = s.sample(new Set(), DT).throttle;
    expect(s.sample(new Set(), DT).throttle).toBeCloseTo(held, 9);
  });
  it("Equal and Minus are throttle synonyms for W and S", () => {
    expect(hold(createControlSampler(P), ["Equal"], 60).throttle).toBeGreaterThan(0);
    const s = createControlSampler(P);
    hold(s, ["KeyW"], 300);
    expect(hold(s, ["Minus"], 60).throttle).toBeLessThan(1);
  });
});

describe("control sampler — flaps", () => {
  it("F steps down one detent per press, not one per tick", () => {
    const s = createControlSampler(P);
    expect(hold(s, ["KeyF"], 30).flapDetent).toBe(1);
  });
  it("releasing and pressing again steps another detent", () => {
    const s = createControlSampler(P);
    hold(s, ["KeyF"], 5);
    s.sample(new Set(), DT);
    expect(hold(s, ["KeyF"], 5).flapDetent).toBe(2);
  });
  it("stops at the last detent and at zero", () => {
    const s = createControlSampler(P);
    for (let i = 0; i < 10; i++) { hold(s, ["KeyF"], 3); s.sample(new Set(), DT); }
    expect(s.sample(new Set(), DT).flapDetent).toBe(P.flaps.length - 1);
    for (let i = 0; i < 10; i++) { hold(s, ["KeyV"], 3); s.sample(new Set(), DT); }
    expect(s.sample(new Set(), DT).flapDetent).toBe(0);
  });
});

describe("control sampler — trim", () => {
  it("Period trims nose up, Comma trims nose down", () => {
    expect(hold(createControlSampler(P), ["Period"], 60).trim).toBeGreaterThan(0);
    expect(hold(createControlSampler(P), ["Comma"], 60).trim).toBeLessThan(0);
  });
  it("is slow — a full second of trim moves it well under half its range", () => {
    expect(hold(createControlSampler(P), ["Period"], 60).trim).toBeLessThan(0.4);
  });
  it("clamps to [-1, 1] and holds its setting", () => {
    const s = createControlSampler(P);
    expect(hold(s, ["Period"], 1200).trim).toBe(1);
    const held = s.sample(new Set(), DT).trim;
    expect(held).toBe(1);
  });
});

describe("handover start state", () => {
  it("can start from the spawn's trimmed, powered controls instead of cold", () => {
    const s = createControlSampler(P, {
      pitch: 0, roll: 0, yaw: 0, throttle: 0.62, flapDetent: 2, trim: -0.4, gearDown: false, afterburner: false,
    });
    const c = s.sample(new Set(), DT);
    expect(c.throttle).toBeCloseTo(0.62, 9);
    expect(c.flapDetent).toBe(2);
    expect(c.trim).toBeCloseTo(-0.4, 9);
  });
});

describe("reset", () => {
  it("returns everything to the spawn state", () => {
    const s = createControlSampler(P);
    hold(s, ["KeyW", "ArrowDown", "Period", "KeyF"], 120);
    s.reset();
    expect(s.sample(new Set(), DT)).toEqual({
      pitch: 0, roll: 0, yaw: 0, throttle: 0, flapDetent: 0, trim: 0, gearDown: false, afterburner: false,
    });
  });
});

describe("KEYMAP", () => {
  it("documents every bound key with a human-readable action", () => {
    expect(KEYMAP.ArrowDown).toMatch(/pitch/i);
    expect(KEYMAP.KeyG).toMatch(/gear/i);
    expect(Object.keys(KEYMAP).length).toBeGreaterThan(10);
  });
});

describe("KEYMAP documents the cockpit keys as well as the flight controls", () => {
  it("names the strip toggle and the controls-help toggle", () => {
    expect(KEYMAP.KeyC).toMatch(/cockpit|strip/i);
    expect(KEYMAP.Slash).toMatch(/help/i);
  });

  it("does not let either of them move a flight control", () => {
    const sampler = createControlSampler(loadC172());
    const before = sampler.sample(new Set<string>(), 1 / 60);
    const after = sampler.sample(new Set(["KeyC", "Slash"]), 1 / 60);
    expect(after).toEqual(before);
  });
});

describe("afterburner toggle", () => {
  it("KeyB toggles afterburner edge-triggered — one flip per press", () => {
    const s = createControlSampler(loadC172());
    expect(s.sample(new Set(), 1 / 60).afterburner).toBe(false);
    expect(s.sample(new Set(["KeyB"]), 1 / 60).afterburner).toBe(true);   // edge: off→on
    expect(s.sample(new Set(["KeyB"]), 1 / 60).afterburner).toBe(true);   // held: no re-flip
    expect(s.sample(new Set(), 1 / 60).afterburner).toBe(true);           // released: stays on
    expect(s.sample(new Set(["KeyB"]), 1 / 60).afterburner).toBe(false);  // next press: on→off
  });
});
