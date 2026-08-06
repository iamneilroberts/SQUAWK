# Phase B "First Flyable" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick a real GA-piston contact off the live browse globe, press TAKE CONTROLS, and fly a C172S first-person over real Esri imagery and real Re:Earth terrain — with a HUD, a ghost of the real aircraft, terrain collision, pause/quit, and a LANDED/CRASHED stats card — all driven by a pure-TypeScript 6-DOF sim whose envelope matches the 172S POH book numbers.

**Architecture:** A pure-TS `sim/` core (zero Cesium imports, fixed 60 Hz accumulator, body→ECEF quaternion attitude, ISA atmosphere, forces from `params/c172.json`) is driven by a normalized control vector from `input/`, stepped from one Cesium `scene.preRender` callback that also drives an FPV camera and a per-frame terrain collision check via `world/`. Session mode (BROWSE → COUNTDOWN → FLYING → PAUSED → ENDED) lives in `game/`; the Cesium `Viewer` and ADS-B polling hoist out of `BrowseGlobe` to an App-level owner so all modes share one Viewer and live traffic keeps rendering while you fly. Sim state lives in a mutable ref and is published to the HUD as a ~10 Hz snapshot through a plain observer — never through zustand.

**Tech Stack:** Vite · React 18 + TypeScript · CesiumJS (keyless) · Zustand · Tailwind (layout only) + hand-written `tokens.css` · vitest (node environment, no jsdom). Backend unchanged from Phase A. **No new dependencies.**

## Global Constraints

- **Honest-data rule:** the only synthesized object is the player's aircraft. Live contacts are real or absent; feeds down = explicit offline state; unknown fields render as em-dash (—). Never mock, sample, or synthesize feed data to make a screen look finished.
- **Keyless Cesium:** `Ion.defaultAccessToken = null` (already set in `globe/BrowseGlobe.tsx`; it moves with the Viewer to `globe/ViewerHost.tsx`). No ion asset IDs.
- **No new dependencies** beyond the approved list (spec §14) without owner approval. Everything in this plan uses `cesium`, `react`, `react-dom`, `zustand`, `vitest`, `typescript` — all already in `frontend/package.json`.
- **`sim/` and `world/` have ZERO Cesium imports.** Every WGS84 helper they need (`geodeticToEcef`, `ecefToGeodetic`, `geodeticSurfaceNormal`, ENU basis) is implemented in `sim/geo.ts`. The Cesium-backed terrain adapter lives in `globe/terrainProvider.ts`.
- **Fixed 60 Hz accumulator; dt clamp ≤ 0.25 s / max 15 steps per frame.** Excess wall time beyond the clamp is dropped, not carried (no death spiral). Persistent clamping surfaces an honest `SIM RATE 0.7×` indicator, never a silent slowdown. Auto-pause on `visibilitychange`.
- **SI units internal, aviation units (kt/ft/fpm) only at the display edge.** Conversions live in `sim/units.ts` and are applied in `hud/format.ts`, `takeover/spawn.ts` (feed → SI), and nowhere else.
- **Attitude is a body→ECEF quaternion**, integrated from body rates and renormalized every step; converted to heading/pitch/roll only at the Cesium boundary. Never integrate in a fixed ENU frame.
- **LORAN visual language:** near-black `#05070a`, amber `#ffb000` (SIM accent + warnings), cyan `#5fd7e0` (nominal data), monospace, uppercase letterspaced labels, 1px borders, bracket corners, translucent panels, no rounded corners > 2px, no shadows.
- **Sim state is unmistakable:** persistent `SIM` banner while FLYING/PAUSED/ENDED, amber SIM accent, synthetic callsign `SIM-<hex>` (uppercase hex of the origin contact).
- **Ports 8020 (backend) / 8021 (compose frontend)** — unchanged; nothing in this phase touches ports.
- **Esri + Re:Earth attribution visible** at all times, in BROWSE and while FLYING: Cesium's credit container plus the HUD attribution line `IMAGERY © ESRI · TERRAIN RE:EARTH · MAPTERHORN CC BY 4.0`.
- **Sim state lives in a mutable ref, NOT zustand.** Zustand gains exactly three fields this phase: `mode`, `origin`, `endStats`. A 60 Hz `set()` would re-render React.
- **StrictMode double-mount safe:** every effect that creates a Viewer, a listener, a loop, or a poller tears itself down completely in its cleanup, so React 18's double-invoke leaves exactly one live instance.
- **No per-class code branches.** Class character comes from `params/c172.json` only. If you find yourself writing `if (params.id === "c172s")`, stop — the difference belongs in the JSON.
- Append a dated entry to `docs/decisions.md` for every non-obvious call (steps below say when).
- No absolute paths in tracked files. Commit after every green test cycle; **stop and wait for owner sign-off at the end of Task 12.**

## Source documents

- Phase B spec (authoritative for this plan): `docs/superpowers/specs/2026-08-05-phase-b-first-flyable-design.md`
- Parent spec: `docs/superpowers/specs/2026-07-27-adsb-game-design.md` §3–§9
- Aero numbers: `docs/research/aero-parameters.md` §1 + NOTES
- Camera/terrain gotchas: `docs/research/cesium-fpv-notes.md`

## Test runner reality (verified against `frontend/package.json`)

| What | Command |
|---|---|
| Install deps (first run in a fresh clone) | `cd frontend && npm ci` |
| Full frontend suite | `cd frontend && npm run test` (= `vitest run`) |
| One file | `cd frontend && npm run test -- src/sim/isa.test.ts` |
| Typecheck | `cd frontend && npm run typecheck` (= `tsc --noEmit`) |
| Backend suite (unchanged, must stay green) | `cd backend && .venv/bin/python -m pytest tests/ -q` |
| App | `bash scripts/dev.sh` → http://localhost:5173 |

vitest runs in the **node** environment (no `jsdom`, no `@testing-library/*` — and none may be added). Consequences baked into this plan: no module may touch `document` at import time (`globe/icons.ts` already lazy-initializes its canvas cache for exactly this reason), and React components are tested by **calling them as functions and walking the returned element tree**, never by rendering.

**Phase A baseline: 26 frontend tests across 6 files** (`icons` 5, `store` 3, `polling` 4, `contactBillboards` 3, `ContactList` 7, `StatusBar` 4). All 26 must stay green through every task in this plan.

## File structure added by this phase

```
frontend/src/
  sim/
    types.ts        SimState, ControlVector, ClassParams, FlapDetent, Vec3, Quat
    units.ts        kt/ft/fpm/deg ↔ SI
    vec3.ts         add/sub/scale/dot/cross/length/normalize
    isa.ts          ISA atmosphere: density/pressure/temperature, IAS↔TAS
    params.ts       validateClassParams + loadC172 (imports params/c172.json)
    geo.ts          WGS84: geodeticToEcef, ecefToGeodetic, surfaceNormal, enuBasis
    quat.ts         quaternion ops + body→ECEF ↔ ENU heading/pitch/roll
    forces.ts       CL(α), CD, thrust, gravity, g-clamp → body/ECEF forces
    integrator.ts   fixed 60 Hz accumulator + semi-implicit Euler step driver
    aircraft.ts     stepAircraft: one 1/60 s physics step
  params/
    c172.json       the only class file this phase
    ga-types.json   GA-piston ICAO designator allowlist (takeover gate)
  input/
    keyboard.ts     window keydown/keyup → held-key Set, preventDefault, blur clear
    controls.ts     held Set → ControlVector per tick (ramps, detents, trim)
  takeover/
    eligibility.ts  checkEligibility → {eligible} | {eligible:false, reason}
    spawn.ts        buildSpawnState → SimState + adjustments[]
  world/
    terrain.ts      terrain height service w/ injected sampler (zero Cesium)
  game/
    machine.ts      BROWSE → COUNTDOWN → FLYING → PAUSED → ENDED
    classify.ts     LANDED / CRASHED
    stats.ts        airtime, distance, max IAS/alt/g, impact sink + speed
    simRate.ts      rolling sim-seconds-per-wall-second meter
    flightLoop.ts   the Cesium-side loop owner (preRender, collision, camera)
  hud/
    format.ts       pure formatters
    snapshot.ts     HudSnapshot type + observer (useSyncExternalStore source)
    Hud.tsx         dumb JSX overlay
  globe/
    ViewerHost.tsx     owns the Viewer + polling + terrain provider (hoisted)
    BrowseLayer.tsx    browse-only behavior, consumes the hoisted Viewer
    terrainProvider.ts Re:Earth attach + ion fallback + getHeight adapter
    fpvCamera.ts       low-pass attitude filter + camera.setView driver
    ghost.ts           ghost label text (pure) + LabelCollection wiring
  panels/
    HandoffCard.tsx  snapshot + adjustments + countdown
    PauseOverlay.tsx RESUME / QUIT
    EndCard.tsx      stats + EXIT TO BROWSE
```

---

### Task 1: Sim foundations — types, units, vec3, ISA, params + `c172.json`

**Files:**
- Create: `frontend/src/sim/types.ts`, `frontend/src/sim/units.ts`, `frontend/src/sim/vec3.ts`, `frontend/src/sim/isa.ts`, `frontend/src/sim/params.ts`, `frontend/src/params/c172.json`
- Test: `frontend/src/sim/units.test.ts`, `frontend/src/sim/isa.test.ts`, `frontend/src/sim/params.test.ts`
- Modify: `docs/decisions.md` (append B-006)

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - Types `Vec3 {x,y,z}`, `Quat {x,y,z,w}`, `FlapDetent`, `ClassParams`, `ControlVector`, `SimState`.
  - `sim/units.ts`: `KT_TO_MS`, `FT_TO_M`, `ktToMs(kt:number):number`, `msToKt(ms:number):number`, `ftToM(ft:number):number`, `mToFt(m:number):number`, `msToFpm(ms:number):number`, `fpmToMs(fpm:number):number`, `degToRad(d:number):number`, `radToDeg(r:number):number`.
  - `sim/vec3.ts`: `vAdd(a,b):Vec3`, `vSub(a,b):Vec3`, `vScale(a,s):Vec3`, `vDot(a,b):number`, `vCross(a,b):Vec3`, `vLength(a):number`, `vNormalize(a):Vec3`, `V_ZERO`.
  - `sim/isa.ts`: `RHO_SL:number`, `isaTemperatureK(hM):number`, `isaPressurePa(hM):number`, `isaDensity(hM):number`, `tasToIas(tasMs:number, hM:number):number`, `iasToTas(iasMs:number, hM:number):number`.
  - `sim/params.ts`: `validateClassParams(raw:unknown):ClassParams` (throws `Error` with a field-named message), `loadC172():ClassParams`.

- [ ] **Step 1: Install deps so the runner exists** — `cd frontend && npm ci`. Then `cd frontend && npm run test`. Expected: 26 tests pass across 6 files (the Phase A baseline). If `npm ci` is skipped the runner reports `sh: 1: vitest: not found`.

- [ ] **Step 2: Write failing unit-conversion tests**

```ts
// frontend/src/sim/units.test.ts
import { describe, it, expect } from "vitest";
import { ktToMs, msToKt, ftToM, mToFt, msToFpm, fpmToMs, degToRad, radToDeg } from "./units";

describe("units", () => {
  it("converts knots to m/s and back", () => {
    expect(ktToMs(100)).toBeCloseTo(51.4444, 4);
    expect(msToKt(51.4444)).toBeCloseTo(100, 3);
  });
  it("converts feet to metres and back", () => {
    expect(ftToM(1000)).toBeCloseTo(304.8, 6);
    expect(mToFt(304.8)).toBeCloseTo(1000, 6);
  });
  it("converts m/s to feet per minute and back", () => {
    expect(msToFpm(1)).toBeCloseTo(196.8504, 3);
    expect(fpmToMs(500)).toBeCloseTo(2.54, 4);
  });
  it("round-trips degrees and radians", () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90, 12);
  });
  it("preserves sign on descent rates", () => {
    expect(msToFpm(-5)).toBeCloseTo(-984.252, 3);
  });
});
```

- [ ] **Step 3: Run to see it fail** — `cd frontend && npm run test -- src/sim/units.test.ts`. Expected: `Error: Failed to load url ./units` / "Cannot find module" — the file does not exist yet.

- [ ] **Step 4: Implement units**

```ts
// frontend/src/sim/units.ts
/*
 * SI is the only internal unit system. These conversions exist so that the feed edge
 * (knots/feet/fpm from readsb) and the display edge (HUD) can speak aviation units while
 * everything between them speaks metres, seconds, radians and newtons.
 */
export const KT_TO_MS = 0.5144444444444445; // 1 nm = 1852 m, per hour
export const FT_TO_M = 0.3048;
export const MS_TO_FPM = 196.85039370078738; // (1 / 0.3048) * 60

export function ktToMs(kt: number): number {
  return kt * KT_TO_MS;
}
export function msToKt(ms: number): number {
  return ms / KT_TO_MS;
}
export function ftToM(ft: number): number {
  return ft * FT_TO_M;
}
export function mToFt(m: number): number {
  return m / FT_TO_M;
}
export function msToFpm(ms: number): number {
  return ms * MS_TO_FPM;
}
export function fpmToMs(fpm: number): number {
  return fpm / MS_TO_FPM;
}
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
```

- [ ] **Step 5: Run to see it pass** — `cd frontend && npm run test -- src/sim/units.test.ts`. Expected: 5 passed.

- [ ] **Step 6: Write failing vec3 tests**

```ts
// frontend/src/sim/vec3.test.ts
import { describe, it, expect } from "vitest";
import { vAdd, vSub, vScale, vDot, vCross, vLength, vNormalize, V_ZERO } from "./vec3";

describe("vec3", () => {
  it("adds, subtracts and scales", () => {
    expect(vAdd({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toEqual({ x: 5, y: 7, z: 9 });
    expect(vSub({ x: 4, y: 5, z: 6 }, { x: 1, y: 2, z: 3 })).toEqual({ x: 3, y: 3, z: 3 });
    expect(vScale({ x: 1, y: -2, z: 3 }, 2)).toEqual({ x: 2, y: -4, z: 6 });
  });
  it("dots and crosses per the right-hand rule", () => {
    expect(vDot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
    expect(vCross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
  });
  it("measures and normalizes length", () => {
    expect(vLength({ x: 3, y: 4, z: 0 })).toBe(5);
    const n = vNormalize({ x: 0, y: 0, z: -7 });
    expect(n).toEqual({ x: 0, y: 0, z: -1 });
  });
  it("normalizing the zero vector returns zero rather than NaN", () => {
    expect(vNormalize(V_ZERO)).toEqual({ x: 0, y: 0, z: 0 });
  });
});
```

- [ ] **Step 7: Run to see it fail** — `cd frontend && npm run test -- src/sim/vec3.test.ts`. Expected: "Failed to load url ./vec3".

- [ ] **Step 8: Implement vec3**

```ts
// frontend/src/sim/vec3.ts
/*
 * Plain-object 3-vectors. Deliberately allocation-happy and immutable: at 60 Hz with one
 * aircraft this is nowhere near a bottleneck, and legibility beats object pooling here.
 */
import type { Vec3 } from "./types";

export const V_ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export function vAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function vSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function vScale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function vDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function vCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function vLength(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}
/** Zero-length input returns zero, never NaN — a stationary aircraft must not poison state. */
export function vNormalize(a: Vec3): Vec3 {
  const len = vLength(a);
  return len === 0 ? V_ZERO : vScale(a, 1 / len);
}
```

- [ ] **Step 9: Write `sim/types.ts`** (no test of its own — it is types only; every later task's tests exercise it)

```ts
// frontend/src/sim/types.ts
/*
 * The sim's whole vocabulary. Everything here is SI and frame-explicit:
 *  - ECEF  = earth-centred, earth-fixed metres (Cesium's Cartesian3 frame).
 *  - body  = X out the nose, Y out the right wing, Z down (standard aerospace).
 *    Positive body rates: p = right wing down, q = nose up, r = nose right.
 *  - attitude is the body -> ECEF rotation, stored as a quaternion.
 */

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

/** One flap detent. Deltas are applied on top of the clean aero block. */
export type FlapDetent = {
  /** HUD text, e.g. "0", "10", "20", "30" (degrees of flap). */
  label: string;
  /** Lift-curve shift at zero AoA — this is what makes flaps raise CLmax. */
  dCL0: number;
  /** Stall AoA shift (negative: flaps stall earlier). */
  dStallAlphaRad: number;
  /** Parasite drag added by the flap — flaps add drag as well as lift. */
  dCD0: number;
};

export type ClassParams = {
  id: string;
  /** Real type this parameter set is based on, e.g. "C172S". */
  label: string;
  /** Honest disclosure shown on the handoff card, e.g. "C172 MODEL THIS BUILD". */
  modelNote: string;
  massKg: number;
  wingAreaM2: number;
  wingSpanM: number;
  aspectRatio: number;
  aero: {
    /** Lift coefficient at zero AoA. */
    cl0: number;
    clAlphaPerRad: number;
    /** AoA at which the linear lift curve reaches CLmax (clean) — the break. */
    stallAlphaRad: number;
    /**
     * Width of the post-stall fade toward flat-plate lift, in radians. Larger = softer,
     * mushier break. CLmax itself is unaffected: it is exactly cl0 + clAlpha*stallAlpha.
     */
    postStallDecayRad: number;
    /** TUNING KNOB — parasite drag. See sources.tuning. */
    cd0: number;
    /** TUNING KNOB — Oswald span efficiency. See sources.tuning. */
    oswaldE: number;
    /** Side-force slope per radian of sideslip (negative = restoring). */
    cyBeta: number;
  };
  control: {
    rollRateMaxRadS: number;
    pitchRateMaxRadS: number;
    yawRateMaxRadS: number;
    rollDampingPerS: number;
    pitchDampingPerS: number;
    yawDampingPerS: number;
    /** Pitch stiffness toward the trimmed AoA (1/s^2 per radian of AoA error). */
    pitchStiffnessPerS2: number;
    /** Weathercock stiffness toward zero sideslip (1/s^2 per radian). */
    yawStiffnessPerS2: number;
    /** Dynamic pressure at which controls have full authority; below this they go mushy. */
    refDynamicPressurePa: number;
    /** Trimmed AoA at trim = 0. */
    trimAlphaCenterRad: number;
    /** Trim authority: trim = ±1 shifts the trimmed AoA by ±this. */
    trimAlphaRangeRad: number;
  };
  propulsion: {
    maxPowerW: number;
    /** Peak propeller efficiency, reached at and above propPeakSpeedMs. */
    propEfficiency: number;
    /**
     * Speed at which the prop reaches peak efficiency. Below it, efficiency falls off
     * linearly — which is also what caps static thrust: T -> eta*P/propPeakSpeedMs.
     */
    propPeakSpeedMs: number;
  };
  limits: {
    vneIasMs: number;
    gLimitPos: number;
    gLimitNeg: number;
    serviceCeilingM: number;
  };
  flaps: FlapDetent[];
  gear: "fixed" | "retractable";
  /** Free-text provenance for every number above; displayed nowhere, read by humans. */
  sources: Record<string, string>;
};

/** Normalized control input, sampled once per physics tick. */
export type ControlVector = {
  /** [-1, 1], positive = nose up (stick back). */
  pitch: number;
  /** [-1, 1], positive = roll right. */
  roll: number;
  /** [-1, 1], positive = nose right (right rudder). */
  yaw: number;
  /** [0, 1]. */
  throttle: number;
  /** Index into ClassParams.flaps. */
  flapDetent: number;
  /** [-1, 1], elevator trim: shifts the AoA the aircraft settles at. */
  trim: number;
};

/** Everything the physics owns. Mutated in place by stepAircraft (via a fresh object). */
export type SimState = {
  /** ECEF metres. */
  position: Vec3;
  /** ECEF m/s. */
  velocity: Vec3;
  /** body -> ECEF. */
  attitude: Quat;
  /** body rad/s: x = p (roll), y = q (pitch), z = r (yaw). */
  rates: Vec3;
  /** Seconds of sim time since spawn. */
  timeS: number;
  // ---- derived readouts, recomputed every step for the HUD and the end classifier ----
  altitudeM: number;
  tasMs: number;
  iasMs: number;
  aoaRad: number;
  sideslipRad: number;
  verticalSpeedMs: number;
  loadFactor: number;
  /** True when the g clamp had to scale lift down this step. */
  gLimited: boolean;
  /** True when |AoA| is past the stall break for the current flap setting. */
  stalled: boolean;
};
```

- [ ] **Step 10: Write failing ISA tests** (targets are ICAO standard-atmosphere table values)

```ts
// frontend/src/sim/isa.test.ts
import { describe, it, expect } from "vitest";
import { RHO_SL, isaTemperatureK, isaPressurePa, isaDensity, tasToIas, iasToTas } from "./isa";
import { ftToM, ktToMs, msToKt } from "./units";

describe("ISA atmosphere vs the standard table", () => {
  it("is 288.15 K / 101325 Pa / 1.225 kg per m3 at sea level", () => {
    expect(isaTemperatureK(0)).toBeCloseTo(288.15, 2);
    expect(isaPressurePa(0)).toBeCloseTo(101325, 0);
    expect(isaDensity(0)).toBeCloseTo(1.225, 3);
    expect(RHO_SL).toBeCloseTo(1.225, 3);
  });
  it("matches the table at 5000 ft (1524 m): 278.24 K, 84307 Pa, 1.0556 kg per m3", () => {
    const h = ftToM(5000);
    expect(isaTemperatureK(h)).toBeCloseTo(278.24, 1);
    expect(isaPressurePa(h)).toBeCloseTo(84307, -1);
    expect(isaDensity(h)).toBeCloseTo(1.0556, 3);
  });
  it("matches the table at 8000 ft (2438.4 m): 272.31 K, 0.9629 kg per m3", () => {
    const h = ftToM(8000);
    expect(isaTemperatureK(h)).toBeCloseTo(272.31, 1);
    expect(isaDensity(h)).toBeCloseTo(0.9629, 3);
  });
  it("goes isothermal above the tropopause (11000 m: 216.65 K, 22632 Pa)", () => {
    expect(isaTemperatureK(11000)).toBeCloseTo(216.65, 1);
    expect(isaPressurePa(11000)).toBeCloseTo(22632, -1);
    expect(isaTemperatureK(15000)).toBeCloseTo(216.65, 2);
    expect(isaPressurePa(15000)).toBeLessThan(isaPressurePa(11000));
  });
  it("clamps below sea level rather than extrapolating into nonsense", () => {
    expect(isaDensity(-500)).toBeGreaterThan(RHO_SL);
    expect(Number.isFinite(isaDensity(-500))).toBe(true);
  });
});

describe("IAS / TAS", () => {
  it("are equal at sea level", () => {
    expect(msToKt(tasToIas(ktToMs(100), 0))).toBeCloseTo(100, 6);
  });
  it("IAS reads lower than TAS with altitude (100 kt TAS at 8000 ft reads ~88.6 kt)", () => {
    const ias = msToKt(tasToIas(ktToMs(100), ftToM(8000)));
    expect(ias).toBeGreaterThan(87);
    expect(ias).toBeLessThan(90);
  });
  it("round-trips TAS -> IAS -> TAS", () => {
    const tas = ktToMs(180);
    expect(iasToTas(tasToIas(tas, ftToM(12000)), ftToM(12000))).toBeCloseTo(tas, 9);
  });
});
```

- [ ] **Step 11: Run to see it fail** — `cd frontend && npm run test -- src/sim/isa.test.ts`. Expected: "Failed to load url ./isa".

- [ ] **Step 12: Implement ISA**

```ts
// frontend/src/sim/isa.ts
/*
 * ICAO standard atmosphere, troposphere + lower stratosphere. Still air only (no wind, no
 * turbulence, no non-standard temperature) — v1 scope, parent spec §4.
 *
 * IAS here is really equivalent airspeed: IAS = TAS * sqrt(rho/rho0). Below ~250 kt and
 * ~15000 ft the compressibility and position errors that separate EAS/CAS/IAS are inside
 * the ±3 kt band this project asserts, so the single square-root form is honest enough and
 * is documented as such rather than dressed up as a full pitot model.
 */
export const RHO_SL = 1.225;
const P_SL = 101325;
const T_SL = 288.15;
const LAPSE = 0.0065; // K/m
const R_AIR = 287.05287; // J/(kg*K)
const G0 = 9.80665;
const TROPOPAUSE_M = 11000;
const T_TROPOPAUSE = T_SL - LAPSE * TROPOPAUSE_M; // 216.65 K
const P_TROPOPAUSE = P_SL * Math.pow(T_TROPOPAUSE / T_SL, G0 / (LAPSE * R_AIR));

export function isaTemperatureK(altitudeM: number): number {
  if (altitudeM >= TROPOPAUSE_M) return T_TROPOPAUSE;
  return T_SL - LAPSE * altitudeM;
}

export function isaPressurePa(altitudeM: number): number {
  if (altitudeM >= TROPOPAUSE_M) {
    return P_TROPOPAUSE * Math.exp((-G0 * (altitudeM - TROPOPAUSE_M)) / (R_AIR * T_TROPOPAUSE));
  }
  return P_SL * Math.pow(isaTemperatureK(altitudeM) / T_SL, G0 / (LAPSE * R_AIR));
}

export function isaDensity(altitudeM: number): number {
  return isaPressurePa(altitudeM) / (R_AIR * isaTemperatureK(altitudeM));
}

export function tasToIas(tasMs: number, altitudeM: number): number {
  return tasMs * Math.sqrt(isaDensity(altitudeM) / RHO_SL);
}

export function iasToTas(iasMs: number, altitudeM: number): number {
  return iasMs / Math.sqrt(isaDensity(altitudeM) / RHO_SL);
}
```

- [ ] **Step 13: Run to see it pass** — `cd frontend && npm run test -- src/sim/isa.test.ts`. Expected: 8 passed.

- [ ] **Step 14: Write `params/c172.json`** — every number is either sourced from `docs/research/aero-parameters.md` §1 or explicitly marked as a tuning knob in `sources`.

```json
{
  "id": "c172s",
  "label": "C172S",
  "modelNote": "C172 MODEL THIS BUILD",
  "massKg": 950,
  "wingAreaM2": 16.2,
  "wingSpanM": 11.0,
  "aspectRatio": 7.469,
  "aero": {
    "cl0": 0.25,
    "clAlphaPerRad": 4.9,
    "stallAlphaRad": 0.2618,
    "postStallDecayRad": 0.2,
    "cd0": 0.035,
    "oswaldE": 0.7,
    "cyBeta": -0.31
  },
  "control": {
    "rollRateMaxRadS": 0.6981,
    "pitchRateMaxRadS": 0.3491,
    "yawRateMaxRadS": 0.2618,
    "rollDampingPerS": 3.0,
    "pitchDampingPerS": 2.5,
    "yawDampingPerS": 2.0,
    "pitchStiffnessPerS2": 3.0,
    "yawStiffnessPerS2": 2.0,
    "refDynamicPressurePa": 1200,
    "trimAlphaCenterRad": 0.0175,
    "trimAlphaRangeRad": 0.0873
  },
  "propulsion": {
    "maxPowerW": 134226,
    "propEfficiency": 0.8,
    "propPeakSpeedMs": 60
  },
  "limits": {
    "vneIasMs": 83.85,
    "gLimitPos": 3.8,
    "gLimitNeg": -1.52,
    "serviceCeilingM": 4267
  },
  "flaps": [
    { "label": "0", "dCL0": 0.0, "dStallAlphaRad": 0.0, "dCD0": 0.0 },
    { "label": "10", "dCL0": 0.3, "dStallAlphaRad": -0.0175, "dCD0": 0.007 },
    { "label": "20", "dCL0": 0.6, "dStallAlphaRad": -0.035, "dCD0": 0.02 },
    { "label": "30", "dCL0": 0.9, "dStallAlphaRad": -0.0524, "dCD0": 0.04 }
  ],
  "gear": "fixed",
  "sources": {
    "massKg": "typical 2-pax + fuel operating mass, research doc range 950-1050 kg. NOT max gross (1157 kg): the POH V-speeds are quoted at max gross, but hitting them at max gross would require a CLmax outside the sourced 1.47-1.58 range. Documented compromise, decisions.md B-006.",
    "wingAreaM2": "JSBSim c172x.xml, cross-checked Roskam (174 sq ft)",
    "wingSpanM": "JSBSim c172x.xml (36.0 ft)",
    "aspectRatio": "derived b^2/S = 121/16.2",
    "cl0": "NACA 2412 zero-AoA lift, typical value",
    "clAlphaPerRad": "NACA 2412 2D slope with finite-AR correction; JSBSim table range 4.5-4.7",
    "stallAlphaRad": "15.0 deg — NACA 2412 critical AoA. Implies CLmax_clean = 0.25 + 4.9*0.2618 = 1.533, inside the sourced 1.47-1.58 range.",
    "postStallDecayRad": "TUNING KNOB — 0.20 rad (11.5 deg) fade width from CLmax toward flat-plate lift past the break. Gives the soft mushy stall the 172 is known for (about 15% CL lost in the first 2 deg past the break); smaller is a sharper CL cliff. Does NOT move CLmax.",
    "cd0": "TUNING KNOB — raised from the JSBSim book value 0.032 to 0.035 so that 75% power at 8000 ft settles at ~123 kt TAS, inside the POH 122-124 kt band. Real CD0 is unpublished.",
    "oswaldE": "TUNING KNOB — 0.70, derived from a published C172 model (CD0=0.0329, K=0.0599).",
    "cyBeta": "textbook light-single side-force slope; makes a slip cost energy",
    "rollRateMaxRadS": "40 deg/s — middle of the research doc's 30-45 deg/s light-GA estimate",
    "pitchRateMaxRadS": "20 deg/s — TUNING KNOB, no published figure",
    "yawRateMaxRadS": "15 deg/s — TUNING KNOB, no published figure",
    "damping/stiffness": "TUNING KNOBS. Pitch: omega_n = sqrt(3.0) = 1.73 rad/s, zeta = 2.5/(2*1.73) = 0.72 — a well-damped short period.",
    "refDynamicPressurePa": "TUNING KNOB — 1200 Pa (~44 m/s at sea level). Controls scale with q/qref, clamped to 1, so authority fades toward the stall.",
    "trimAlphaCenterRad": "1.0 deg — near the cruise AoA so trim = 0 is roughly hands-off cruise",
    "maxPowerW": "180 hp Lycoming IO-360-L2A = 134226 W",
    "propEfficiency": "0.80 cruise assumption, research doc",
    "propPeakSpeedMs": "TUNING KNOB — 60 m/s (117 kt). Below it, prop efficiency falls linearly, which both caps static thrust at eta*P/60 = 1790 N (402 lbf) and brings sea-level climb from an absurd 1570 fpm down to ~740 fpm vs the POH's 730 fpm.",
    "vneIasMs": "163 KIAS = 83.85 m/s, 172S POH",
    "gLimits": "+3.8 / -1.52, FAR/CS-23 Normal category",
    "serviceCeilingM": "14000 ft = 4267 m, 172S POH",
    "flaps": "172S has 0/10/20/30 detents. dCL0/dStallAlpha tuned so flaps-30 CLmax = 1.0 + 4.9*0.2094 = 2.03, putting Vs0 at ~41.8 kt against the POH's 40 KIAS. dCD0 values are TUNING KNOBS.",
    "gear": "fixed — the 172 has no retractable gear; the HUD reads FIXED and G is inert"
  }
}
```

- [ ] **Step 15: Write failing params-validator tests**

```ts
// frontend/src/sim/params.test.ts
import { describe, it, expect } from "vitest";
import { validateClassParams, loadC172 } from "./params";

describe("loadC172", () => {
  it("loads and validates the shipped C172S parameter file", () => {
    const p = loadC172();
    expect(p.id).toBe("c172s");
    expect(p.label).toBe("C172S");
    expect(p.modelNote).toBe("C172 MODEL THIS BUILD");
    expect(p.massKg).toBeGreaterThan(0);
    expect(p.flaps).toHaveLength(4);
    expect(p.flaps.map((f) => f.label)).toEqual(["0", "10", "20", "30"]);
    expect(p.gear).toBe("fixed");
  });
  it("has an aspect ratio consistent with its span and area", () => {
    const p = loadC172();
    expect(p.aspectRatio).toBeCloseTo((p.wingSpanM * p.wingSpanM) / p.wingAreaM2, 2);
  });
  it("documents every tuning knob in sources", () => {
    const text = JSON.stringify(loadC172().sources);
    expect(text).toContain("TUNING KNOB");
  });
});

describe("validateClassParams", () => {
  it("rejects a non-object", () => {
    expect(() => validateClassParams(null)).toThrow(/must be an object/);
    expect(() => validateClassParams(42)).toThrow(/must be an object/);
  });
  it("names the missing field", () => {
    expect(() => validateClassParams({ id: "x" })).toThrow(/label/);
  });
  it("rejects a non-positive mass", () => {
    const bad = { ...(loadC172() as unknown as Record<string, unknown>), massKg: 0 };
    expect(() => validateClassParams(bad)).toThrow(/massKg/);
  });
  it("rejects an empty flap list", () => {
    const bad = { ...(loadC172() as unknown as Record<string, unknown>), flaps: [] };
    expect(() => validateClassParams(bad)).toThrow(/flaps/);
  });
  it("rejects a flap detent missing a delta", () => {
    const bad = {
      ...(loadC172() as unknown as Record<string, unknown>),
      flaps: [{ label: "0", dCL0: 0, dStallAlphaRad: 0 }],
    };
    expect(() => validateClassParams(bad)).toThrow(/dCD0/);
  });
  it("accepts the shipped file unchanged", () => {
    expect(() => validateClassParams(loadC172())).not.toThrow();
  });
});
```

- [ ] **Step 16: Run to see it fail** — `cd frontend && npm run test -- src/sim/params.test.ts`. Expected: "Failed to load url ./params".

- [ ] **Step 17: Implement the params loader/validator**

```ts
// frontend/src/sim/params.ts
/*
 * Parameter files are data, not code — so they get validated once, loudly, at load time
 * rather than producing NaN somewhere inside the integrator three seconds into a flight.
 * A hand-written validator (not a schema library) keeps the dependency list untouched.
 */
import type { ClassParams, FlapDetent } from "./types";
import c172Raw from "../params/c172.json";

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function num(obj: Record<string, unknown>, key: string, path: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`${path}.${key} must be a finite number`);
  }
  return v;
}

function positive(obj: Record<string, unknown>, key: string, path: string): number {
  const v = num(obj, key, path);
  if (v <= 0) throw new Error(`${path}.${key} must be greater than zero`);
  return v;
}

function str(obj: Record<string, unknown>, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${path}.${key} must be a non-empty string`);
  }
  return v;
}

function flapDetent(raw: unknown, index: number): FlapDetent {
  const path = `flaps[${index}]`;
  const o = asRecord(raw, path);
  return {
    label: str(o, "label", path),
    dCL0: num(o, "dCL0", path),
    dStallAlphaRad: num(o, "dStallAlphaRad", path),
    dCD0: num(o, "dCD0", path),
  };
}

export function validateClassParams(raw: unknown): ClassParams {
  const o = asRecord(raw, "params");
  const aero = asRecord(o.aero, "params.aero");
  const control = asRecord(o.control, "params.control");
  const propulsion = asRecord(o.propulsion, "params.propulsion");
  const limits = asRecord(o.limits, "params.limits");

  if (!Array.isArray(o.flaps) || o.flaps.length === 0) {
    throw new Error("params.flaps must be a non-empty array");
  }
  const gear = str(o, "gear", "params");
  if (gear !== "fixed" && gear !== "retractable") {
    throw new Error('params.gear must be "fixed" or "retractable"');
  }

  return {
    id: str(o, "id", "params"),
    label: str(o, "label", "params"),
    modelNote: str(o, "modelNote", "params"),
    massKg: positive(o, "massKg", "params"),
    wingAreaM2: positive(o, "wingAreaM2", "params"),
    wingSpanM: positive(o, "wingSpanM", "params"),
    aspectRatio: positive(o, "aspectRatio", "params"),
    aero: {
      cl0: num(aero, "cl0", "params.aero"),
      clAlphaPerRad: positive(aero, "clAlphaPerRad", "params.aero"),
      stallAlphaRad: positive(aero, "stallAlphaRad", "params.aero"),
      postStallDecayRad: positive(aero, "postStallDecayRad", "params.aero"),
      cd0: positive(aero, "cd0", "params.aero"),
      oswaldE: positive(aero, "oswaldE", "params.aero"),
      cyBeta: num(aero, "cyBeta", "params.aero"),
    },
    control: {
      rollRateMaxRadS: positive(control, "rollRateMaxRadS", "params.control"),
      pitchRateMaxRadS: positive(control, "pitchRateMaxRadS", "params.control"),
      yawRateMaxRadS: positive(control, "yawRateMaxRadS", "params.control"),
      rollDampingPerS: positive(control, "rollDampingPerS", "params.control"),
      pitchDampingPerS: positive(control, "pitchDampingPerS", "params.control"),
      yawDampingPerS: positive(control, "yawDampingPerS", "params.control"),
      pitchStiffnessPerS2: positive(control, "pitchStiffnessPerS2", "params.control"),
      yawStiffnessPerS2: positive(control, "yawStiffnessPerS2", "params.control"),
      refDynamicPressurePa: positive(control, "refDynamicPressurePa", "params.control"),
      trimAlphaCenterRad: num(control, "trimAlphaCenterRad", "params.control"),
      trimAlphaRangeRad: positive(control, "trimAlphaRangeRad", "params.control"),
    },
    propulsion: {
      maxPowerW: positive(propulsion, "maxPowerW", "params.propulsion"),
      propEfficiency: positive(propulsion, "propEfficiency", "params.propulsion"),
      propPeakSpeedMs: positive(propulsion, "propPeakSpeedMs", "params.propulsion"),
    },
    limits: {
      vneIasMs: positive(limits, "vneIasMs", "params.limits"),
      gLimitPos: positive(limits, "gLimitPos", "params.limits"),
      gLimitNeg: num(limits, "gLimitNeg", "params.limits"),
      serviceCeilingM: positive(limits, "serviceCeilingM", "params.limits"),
    },
    flaps: o.flaps.map(flapDetent),
    gear,
    sources: asRecord(o.sources, "params.sources") as Record<string, string>,
  };
}

let cached: ClassParams | null = null;

/** The only class parameter set this phase (owner decision B-2). */
export function loadC172(): ClassParams {
  if (cached === null) cached = validateClassParams(c172Raw);
  return cached;
}
```

- [ ] **Step 18: Run to see it pass** — `cd frontend && npm run test -- src/sim/params.test.ts`. Expected: 9 passed.

- [ ] **Step 19: Log the mass/V-speed compromise** — append to `docs/decisions.md`:

```markdown
## 2026-08-05 — B-006 · C172S parameters are tuned at typical operating mass, not max gross

The POH quotes Vs1 48 / Vs0 40 KIAS at max gross (1157 kg), but reproducing those at max
gross needs CLmax ≈ 1.85 — well outside the sourced 1.47–1.58 range. Rather than invent a
wing, `params/c172.json` uses the sourced typical operating mass (950 kg, research doc
range 950–1050) with a sourced CLmax of 1.533, which lands Vs1 at 48.1 kt and Vs0 at
41.8 kt against the book numbers. The trade is stated in `sources.massKg` in the file
itself. Two knobs carry the rest of the tuning and are labelled TUNING KNOB in `sources`:
`cd0` 0.032 → 0.035 (cruise lands at ~123 kt TAS inside the POH's 122–124 kt band) and
`propPeakSpeedMs` (a linear prop-efficiency ramp below 60 m/s, which both caps static
thrust and brings sea-level climb from ~1570 fpm to ~740 fpm vs the POH's 730 fpm — a
constant-efficiency `T = ηP/V` model is wildly optimistic in the climb).
```

- [ ] **Step 20: Full suite + typecheck + commit** — `cd frontend && npm run test && npm run typecheck`. Expected: 52 tests passed (26 Phase A + 26 new: units 5, vec3 4, isa 8, params 9), typecheck clean. Then:

```bash
git add frontend/src/sim frontend/src/params docs/decisions.md && git commit -m "feat(sim): units, vec3, ISA atmosphere and validated C172S parameter file"
```

---

### Task 2: Sim rigid body — geodesy, quaternions, forces, integrator, step

**Files:**
- Create: `frontend/src/sim/geo.ts`, `frontend/src/sim/quat.ts`, `frontend/src/sim/forces.ts`, `frontend/src/sim/integrator.ts`, `frontend/src/sim/aircraft.ts`
- Test: `frontend/src/sim/geo.test.ts`, `frontend/src/sim/quat.test.ts`, `frontend/src/sim/forces.test.ts`, `frontend/src/sim/integrator.test.ts`, `frontend/src/sim/aircraft.test.ts`
- Modify: `docs/decisions.md` (append B-007)

**Interfaces:**
- Consumes: `Vec3`, `Quat`, `ClassParams`, `ControlVector`, `SimState` from `sim/types.ts`; `vAdd/vSub/vScale/vDot/vCross/vLength/vNormalize/V_ZERO` from `sim/vec3.ts`; `isaDensity`, `tasToIas`, `RHO_SL` from `sim/isa.ts`.
- Produces:
  - `sim/geo.ts`: `WGS84_A:number`, `WGS84_B:number`, `geodeticToEcef(latRad:number, lonRad:number, heightM:number):Vec3`, `ecefToGeodetic(p:Vec3):{latRad:number; lonRad:number; heightM:number}`, `geodeticSurfaceNormal(p:Vec3):Vec3`, `enuBasis(p:Vec3):{east:Vec3; north:Vec3; up:Vec3}`.
  - `sim/quat.ts`: `QUAT_IDENTITY:Quat`, `qMultiply(a:Quat,b:Quat):Quat`, `qNormalize(q:Quat):Quat`, `qConjugate(q:Quat):Quat`, `qRotate(q:Quat,v:Vec3):Vec3`, `qRotateInverse(q:Quat,v:Vec3):Vec3`, `qIntegrate(q:Quat, ratesBody:Vec3, dt:number):Quat`, `hprFromQuat(q:Quat, positionEcef:Vec3):{headingRad:number; pitchRad:number; rollRad:number}`, `quatFromHpr(positionEcef:Vec3, headingRad:number, pitchRad:number, rollRad:number):Quat`.
  - `sim/forces.ts`: `liftCoefficient(alphaRad:number, params:ClassParams, flap:FlapDetent):number`, `dragCoefficient(cl:number, params:ClassParams, flap:FlapDetent):number`, `stallAlphaFor(params:ClassParams, flap:FlapDetent):number`, `clMaxFor(params:ClassParams, flap:FlapDetent):number`, `stallSpeedIasMs(params:ClassParams, flapIndex:number):number`, `thrustNewtons(params:ClassParams, throttle:number, tasMs:number):number`, `controlAuthority(qBarPa:number, params:ClassParams):number`, `computeForces(state:SimState, controls:ControlVector, params:ClassParams):ForceResult` where `ForceResult = { forceEcef:Vec3; ratesDotBody:Vec3; aoaRad:number; sideslipRad:number; tasMs:number; iasMs:number; loadFactor:number; gLimited:boolean; stalled:boolean }`.
  - `sim/integrator.ts`: `FIXED_DT:number` (1/60), `MAX_FRAME_S:number` (0.25), `MAX_STEPS_PER_FRAME:number` (15), `createAccumulator():Accumulator`, `runFixedSteps(acc:Accumulator, elapsedS:number, step:()=>void):{steps:number; clamped:boolean}`.
  - `sim/aircraft.ts`: `stepAircraft(state:SimState, controls:ControlVector, params:ClassParams, dt?:number):SimState`, `refreshDerived(state:SimState, controls:ControlVector, params:ClassParams):SimState`.

- [ ] **Step 1: Write failing geodesy tests**

```ts
// frontend/src/sim/geo.test.ts
import { describe, it, expect } from "vitest";
import { WGS84_A, geodeticToEcef, ecefToGeodetic, geodeticSurfaceNormal, enuBasis } from "./geo";
import { vDot, vLength } from "./vec3";
import { degToRad, radToDeg } from "./units";

describe("geodeticToEcef", () => {
  it("puts 0N 0E at (a, 0, 0)", () => {
    const p = geodeticToEcef(0, 0, 0);
    expect(p.x).toBeCloseTo(WGS84_A, 3);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });
  it("puts 0N 90E on the +y axis", () => {
    const p = geodeticToEcef(0, Math.PI / 2, 0);
    expect(p.x).toBeCloseTo(0, 3);
    expect(p.y).toBeCloseTo(WGS84_A, 3);
  });
  it("adds height along the surface normal", () => {
    const a = geodeticToEcef(degToRad(30.6944), degToRad(-88.0399), 0);
    const b = geodeticToEcef(degToRad(30.6944), degToRad(-88.0399), 1000);
    expect(vLength(b) - vLength(a)).toBeCloseTo(1000, 3);
  });
});

describe("ecefToGeodetic round-trip", () => {
  const cases: Array<[number, number, number]> = [
    [30.6944, -88.0399, 1500],
    [0, 0, 0],
    [-45.2, 170.5, 12000],
    [89.9, 12.0, 300],
    [-89.9, -12.0, 300],
  ];
  for (const [lat, lon, h] of cases) {
    it(`round-trips ${lat} ${lon} ${h}m`, () => {
      const g = ecefToGeodetic(geodeticToEcef(degToRad(lat), degToRad(lon), h));
      expect(radToDeg(g.latRad)).toBeCloseTo(lat, 7);
      expect(radToDeg(g.lonRad)).toBeCloseTo(lon, 7);
      expect(g.heightM).toBeCloseTo(h, 4);
    });
  }
});

describe("geodeticSurfaceNormal", () => {
  it("is a unit vector", () => {
    const n = geodeticSurfaceNormal(geodeticToEcef(degToRad(30.7), degToRad(-88), 3000));
    expect(vLength(n)).toBeCloseTo(1, 12);
  });
  it("points along +x at 0N 0E", () => {
    const n = geodeticSurfaceNormal(geodeticToEcef(0, 0, 0));
    expect(n.x).toBeCloseTo(1, 9);
  });
  it("is NOT the radial direction away from the equator (that is the whole point)", () => {
    const p = geodeticToEcef(degToRad(45), 0, 0);
    const radial = { x: p.x / vLength(p), y: p.y / vLength(p), z: p.z / vLength(p) };
    const n = geodeticSurfaceNormal(p);
    expect(vDot(radial, n)).toBeLessThan(1 - 1e-9);
  });
});

describe("enuBasis", () => {
  it("is orthonormal and right-handed", () => {
    const { east, north, up } = enuBasis(geodeticToEcef(degToRad(30.7), degToRad(-88), 0));
    expect(vLength(east)).toBeCloseTo(1, 12);
    expect(vLength(north)).toBeCloseTo(1, 12);
    expect(vLength(up)).toBeCloseTo(1, 12);
    expect(vDot(east, north)).toBeCloseTo(0, 12);
    expect(vDot(north, up)).toBeCloseTo(0, 12);
    expect(vDot(east, up)).toBeCloseTo(0, 12);
  });
  it("at 0N 0E: east is +y, north is +z, up is +x", () => {
    const { east, north, up } = enuBasis(geodeticToEcef(0, 0, 0));
    expect(east.y).toBeCloseTo(1, 9);
    expect(north.z).toBeCloseTo(1, 9);
    expect(up.x).toBeCloseTo(1, 9);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `cd frontend && npm run test -- src/sim/geo.test.ts`. Expected: "Failed to load url ./geo".

- [ ] **Step 3: Implement geodesy** (this is why `sim/` needs no Cesium: `Ellipsoid.WGS84.geodeticSurfaceNormal` is four lines)

```ts
// frontend/src/sim/geo.ts
/*
 * WGS84 geodesy, hand-rolled so sim/ keeps ZERO Cesium imports (module rule, spec §3).
 * Same ellipsoid constants Cesium's Ellipsoid.WGS84 uses, so ECEF positions produced here
 * hand straight to Cesium's Cartesian3 without a datum shift.
 *
 * Earth rotation is deliberately ignored: no Coriolis, no transport rate. At C172 speeds
 * over a few minutes of flight the omitted terms are far below the terrain resolution this
 * game collides against (parent spec §6). Documented, not forgotten.
 */
import type { Vec3 } from "./types";
import { vCross, vLength, vNormalize } from "./vec3";

export const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
export const WGS84_B = WGS84_A * (1 - WGS84_F);
const E2 = WGS84_F * (2 - WGS84_F);
const EP2 = E2 / (1 - E2);

export function geodeticToEcef(latRad: number, lonRad: number, heightM: number): Vec3 {
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const n = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  return {
    x: (n + heightM) * cosLat * Math.cos(lonRad),
    y: (n + heightM) * cosLat * Math.sin(lonRad),
    z: (n * (1 - E2) + heightM) * sinLat,
  };
}

/**
 * Bowring's closed-form solution — accurate to well under a millimetre for terrestrial
 * heights and, unlike the naive `r / cos(lat) - N` height form, stable at the poles.
 */
export function ecefToGeodetic(p: Vec3): { latRad: number; lonRad: number; heightM: number } {
  const lonRad = Math.atan2(p.y, p.x);
  const r = Math.hypot(p.x, p.y);
  const theta = Math.atan2(p.z * WGS84_A, r * WGS84_B);
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const latRad = Math.atan2(
    p.z + EP2 * WGS84_B * sinT * sinT * sinT,
    r - E2 * WGS84_A * cosT * cosT * cosT,
  );
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const n = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  const heightM = r * cosLat + p.z * sinLat - n * (1 - E2 * sinLat * sinLat);
  return { latRad, lonRad, heightM };
}

/** The ellipsoid normal — "up". Matches Cesium's Ellipsoid.geodeticSurfaceNormal. */
export function geodeticSurfaceNormal(p: Vec3): Vec3 {
  return vNormalize({
    x: p.x / (WGS84_A * WGS84_A),
    y: p.y / (WGS84_A * WGS84_A),
    z: p.z / (WGS84_B * WGS84_B),
  });
}

/** East-north-up unit vectors in ECEF at the given position. */
export function enuBasis(p: Vec3): { east: Vec3; north: Vec3; up: Vec3 } {
  const up = geodeticSurfaceNormal(p);
  const lonRad = Math.atan2(p.y, p.x);
  const east: Vec3 = { x: -Math.sin(lonRad), y: Math.cos(lonRad), z: 0 };
  // At the exact pole `east` degenerates; fall back to the prime meridian's east.
  const eastSafe = vLength(east) < 1e-9 ? { x: 0, y: 1, z: 0 } : vNormalize(east);
  return { east: eastSafe, north: vNormalize(vCross(up, eastSafe)), up };
}
```

- [ ] **Step 4: Run to see it pass** — `cd frontend && npm run test -- src/sim/geo.test.ts`. Expected: 13 passed.

- [ ] **Step 5: Write failing quaternion tests** (these are the 4 known attitudes that pin the HPR sign conventions, plus drift and round-trip)

```ts
// frontend/src/sim/quat.test.ts
import { describe, it, expect } from "vitest";
import {
  QUAT_IDENTITY, qMultiply, qNormalize, qConjugate, qRotate, qRotateInverse,
  qIntegrate, hprFromQuat, quatFromHpr,
} from "./quat";
import { geodeticToEcef, enuBasis } from "./geo";
import { degToRad, radToDeg } from "./units";
import { vDot, vLength } from "./vec3";

const HOME = geodeticToEcef(degToRad(30.6944), degToRad(-88.0399), 2000);

describe("quaternion algebra", () => {
  it("identity rotates nothing", () => {
    expect(qRotate(QUAT_IDENTITY, { x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 });
  });
  it("conjugate undoes rotate", () => {
    const q = qNormalize({ x: 0.2, y: -0.3, z: 0.5, w: 0.8 });
    const v = { x: 1, y: -2, z: 3 };
    const back = qRotateInverse(q, qRotate(q, v));
    expect(back.x).toBeCloseTo(v.x, 10);
    expect(back.y).toBeCloseTo(v.y, 10);
    expect(back.z).toBeCloseTo(v.z, 10);
  });
  it("multiplication composes rotations", () => {
    const half = qNormalize({ x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) });
    const full = qMultiply(half, half); // 180 deg about z
    const v = qRotate(full, { x: 1, y: 0, z: 0 });
    expect(v.x).toBeCloseTo(-1, 9);
  });
  it("conjugate leaves the norm alone", () => {
    const q = qNormalize({ x: 0.2, y: -0.3, z: 0.5, w: 0.8 });
    const c = qConjugate(q);
    expect(Math.hypot(c.x, c.y, c.z, c.w)).toBeCloseTo(1, 12);
  });
});

describe("qIntegrate", () => {
  it("a full 360 deg roll returns to the starting attitude", () => {
    const rate = 2 * Math.PI; // one rev per second about body x
    let q = QUAT_IDENTITY;
    for (let i = 0; i < 60; i++) q = qIntegrate(q, { x: rate, y: 0, z: 0 }, 1 / 60);
    const y = qRotate(q, { x: 0, y: 1, z: 0 });
    expect(y.x).toBeCloseTo(0, 3);
    expect(y.y).toBeCloseTo(1, 3);
    expect(y.z).toBeCloseTo(0, 3);
  });
  it("stays unit-norm over 60000 steps (renormalization actually happens)", () => {
    let q = QUAT_IDENTITY;
    for (let i = 0; i < 60000; i++) {
      q = qIntegrate(q, { x: 0.7, y: -0.4, z: 0.3 }, 1 / 60);
    }
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
    expect(Number.isFinite(q.w)).toBe(true);
  });
});

describe("hprFromQuat pins the Cesium HPR sign conventions", () => {
  // The four known attitudes. Body axes: X nose, Y right wing, Z down.
  it("1. wings level, nose north -> heading 0, pitch 0, roll 0", () => {
    const q = quatFromHpr(HOME, 0, 0, 0);
    const hpr = hprFromQuat(q, HOME);
    expect(radToDeg(hpr.headingRad)).toBeCloseTo(0, 6);
    expect(radToDeg(hpr.pitchRad)).toBeCloseTo(0, 6);
    expect(radToDeg(hpr.rollRad)).toBeCloseTo(0, 6);
    // and the nose really points north
    const nose = qRotate(q, { x: 1, y: 0, z: 0 });
    expect(vDot(nose, enuBasis(HOME).north)).toBeCloseTo(1, 9);
  });
  it("2. wings level, nose east -> heading +90", () => {
    const q = quatFromHpr(HOME, degToRad(90), 0, 0);
    expect(radToDeg(hprFromQuat(q, HOME).headingRad)).toBeCloseTo(90, 6);
    const nose = qRotate(q, { x: 1, y: 0, z: 0 });
    expect(vDot(nose, enuBasis(HOME).east)).toBeCloseTo(1, 9);
  });
  it("3. nose up 30 deg facing north -> pitch +30, nose has +up component", () => {
    const q = quatFromHpr(HOME, 0, degToRad(30), 0);
    const hpr = hprFromQuat(q, HOME);
    expect(radToDeg(hpr.pitchRad)).toBeCloseTo(30, 6);
    const nose = qRotate(q, { x: 1, y: 0, z: 0 });
    expect(vDot(nose, enuBasis(HOME).up)).toBeCloseTo(0.5, 6);
  });
  it("4. right wing down 45 deg -> roll +45, right wing has -up component", () => {
    const q = quatFromHpr(HOME, 0, 0, degToRad(45));
    const hpr = hprFromQuat(q, HOME);
    expect(radToDeg(hpr.rollRad)).toBeCloseTo(45, 6);
    const rightWing = qRotate(q, { x: 0, y: 1, z: 0 });
    expect(vDot(rightWing, enuBasis(HOME).up)).toBeCloseTo(-Math.SQRT1_2, 6);
  });
});

describe("HPR round-trip", () => {
  const cases: Array<[number, number, number]> = [
    [0, 0, 0],
    [37, 12, -20],
    [359, -5, 179],
    [180, 89, 45],
    [180, -89, -45],
  ];
  for (const [h, p, r] of cases) {
    it(`round-trips h=${h} p=${p} r=${r}`, () => {
      const q = quatFromHpr(HOME, degToRad(h), degToRad(p), degToRad(r));
      const back = hprFromQuat(q, HOME);
      // heading is compared modulo 360
      const dh = ((radToDeg(back.headingRad) - h + 540) % 360) - 180;
      expect(dh).toBeCloseTo(0, 4);
      expect(radToDeg(back.pitchRad)).toBeCloseTo(p, 4);
      const dr = ((radToDeg(back.rollRad) - r + 540) % 360) - 180;
      expect(dr).toBeCloseTo(0, 4);
    });
  }
  it("produces a unit quaternion", () => {
    const q = quatFromHpr(HOME, degToRad(210), degToRad(-30), degToRad(15));
    expect(vLength({ x: q.x, y: q.y, z: q.z })).toBeLessThanOrEqual(1);
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 12);
  });
});
```

- [ ] **Step 6: Run to see it fail** — `cd frontend && npm run test -- src/sim/quat.test.ts`. Expected: "Failed to load url ./quat".

- [ ] **Step 7: Implement quaternions + the HPR boundary**

```ts
// frontend/src/sim/quat.ts
/*
 * Attitude is a body -> ECEF quaternion. Body axes: X out the nose, Y out the right wing,
 * Z down. Body rates: p about X (right wing down positive), q about Y (nose up positive),
 * r about Z (nose right positive) — standard aerospace, verified by the sign tests.
 *
 * Heading/pitch/roll exist ONLY at the Cesium boundary (camera.setView). They are computed
 * from the ENU basis at the aircraft's own position, so nothing drifts as it flies around
 * the planet and there is no Euler state to hit a gimbal singularity.
 */
import type { Quat, Vec3 } from "./types";
import { enuBasis } from "./geo";
import { vCross, vDot, vNormalize } from "./vec3";

export const QUAT_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function qMultiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  if (n === 0) return QUAT_IDENTITY;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

export function qConjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** Rotate a body-frame vector into ECEF. */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  // t = 2 * (q_vec x v);  v' = v + q.w * t + q_vec x t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Rotate an ECEF vector into the body frame. */
export function qRotateInverse(q: Quat, v: Vec3): Vec3 {
  return qRotate(qConjugate(q), v);
}

/**
 * One integration step of the body rates onto the attitude, renormalized every call.
 * q' = q + 0.5 * q (x) omega_body * dt — first-order, which at 1/60 s and light-GA rates
 * costs far less attitude error than the terrain resolution we collide against, and the
 * renormalize keeps it a rotation forever (60000-step drift test).
 */
export function qIntegrate(q: Quat, ratesBody: Vec3, dt: number): Quat {
  const omega: Quat = { x: ratesBody.x, y: ratesBody.y, z: ratesBody.z, w: 0 };
  const d = qMultiply(q, omega);
  return qNormalize({
    x: q.x + 0.5 * d.x * dt,
    y: q.y + 0.5 * d.y * dt,
    z: q.z + 0.5 * d.z * dt,
    w: q.w + 0.5 * d.w * dt,
  });
}

/**
 * Attitude -> Cesium camera HPR at this position.
 *  heading: clockwise from local north, 0 = north
 *  pitch:   positive = nose above the local horizontal plane
 *  roll:    positive = right wing down
 * These are the conventions `camera.setView({orientation:{heading,pitch,roll}})` expects.
 */
export function hprFromQuat(
  q: Quat,
  positionEcef: Vec3,
): { headingRad: number; pitchRad: number; rollRad: number } {
  const { east, north, up } = enuBasis(positionEcef);
  const nose = qRotate(q, { x: 1, y: 0, z: 0 });
  const rightWing = qRotate(q, { x: 0, y: 1, z: 0 });

  const noseE = vDot(nose, east);
  const noseN = vDot(nose, north);
  const noseU = vDot(nose, up);

  const headingRad = Math.atan2(noseE, noseN);
  const pitchRad = Math.atan2(noseU, Math.hypot(noseE, noseN));

  // Wings-level reference: the horizontal vector 90 deg right of the nose.
  const horizontalRight = vNormalize(vCross(nose, up));
  const rollRad = Math.atan2(
    vDot(vCross(horizontalRight, rightWing), nose),
    vDot(horizontalRight, rightWing),
  );
  return { headingRad, pitchRad, rollRad };
}

/** The inverse: build a body -> ECEF attitude from ENU heading/pitch/roll. */
export function quatFromHpr(
  positionEcef: Vec3,
  headingRad: number,
  pitchRad: number,
  rollRad: number,
): Quat {
  const { east, north, up } = enuBasis(positionEcef);
  const ch = Math.cos(headingRad);
  const sh = Math.sin(headingRad);
  const cp = Math.cos(pitchRad);
  const sp = Math.sin(pitchRad);
  const cr = Math.cos(rollRad);
  const sr = Math.sin(rollRad);

  // Body axes expressed in ENU components, then mapped into ECEF.
  const enu = (e: number, n: number, u: number): Vec3 => ({
    x: east.x * e + north.x * n + up.x * u,
    y: east.y * e + north.y * n + up.y * u,
    z: east.z * e + north.z * n + up.z * u,
  });
  const nose = enu(cp * sh, cp * ch, sp);
  const rightWing = enu(
    cr * ch + sr * sp * sh,
    -cr * sh + sr * sp * ch,
    -sr * cp,
  );
  const down = vNormalize(vCross(nose, rightWing));

  // Rotation matrix columns are the body axes in ECEF; convert to a quaternion (Shepperd).
  const m00 = nose.x, m10 = nose.y, m20 = nose.z;
  const m01 = rightWing.x, m11 = rightWing.y, m21 = rightWing.z;
  const m02 = down.x, m12 = down.y, m22 = down.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return qNormalize({ w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s });
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return qNormalize({ w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s });
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return qNormalize({ w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s });
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return qNormalize({ w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s });
}
```

- [ ] **Step 8: Run to see it pass** — `cd frontend && npm run test -- src/sim/quat.test.ts`. Expected: 16 passed. If a round-trip case fails by an exact sign, the bug is in `quatFromHpr`'s `rightWing` row — fix it there, never by flipping the test's expectation.

- [ ] **Step 9: Write failing force-model tests** (behavioral only; the book-number envelope suite is Task 3)

```ts
// frontend/src/sim/forces.test.ts
import { describe, it, expect } from "vitest";
import {
  liftCoefficient, dragCoefficient, clMaxFor, stallAlphaFor, stallSpeedIasMs,
  thrustNewtons, controlAuthority, computeForces,
} from "./forces";
import { loadC172 } from "./params";
import { degToRad } from "./units";
import { quatFromHpr, qRotate } from "./quat";
import { geodeticToEcef } from "./geo";
import type { SimState, ControlVector, Vec3 } from "./types";

const P = loadC172();
const CLEAN = P.flaps[0];
const FULL = P.flaps[3];

const CONTROLS: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle: 0.75, flapDetent: 0, trim: 0 };

/** Velocity vector for a flight path `fpaDeg` above the horizon, tracking north. */
function velocityAlong(positionEcef: Vec3, tasMs: number, fpaDeg: number): Vec3 {
  return qRotate(quatFromHpr(positionEcef, 0, degToRad(fpaDeg), 0), { x: tasMs, y: 0, z: 0 });
}

/**
 * A state with a REAL velocity vector: body pitched `pitchDeg`, flight path at `fpaDeg`,
 * so the angle of attack is `pitchDeg - fpaDeg`. This matters more than it looks — a state
 * with zero velocity makes every aerodynamic force zero, which would let force assertions
 * pass without the force model doing anything at all.
 */
function stateAt(altM: number, tasMs: number, pitchDeg = 0, fpaDeg = pitchDeg): SimState {
  const position = geodeticToEcef(degToRad(30.6944), degToRad(-88.0399), altM);
  return {
    position,
    velocity: velocityAlong(position, tasMs, fpaDeg),
    attitude: quatFromHpr(position, 0, degToRad(pitchDeg), 0),
    rates: { x: 0, y: 0, z: 0 },
    timeS: 0,
    altitudeM: altM,
    tasMs, iasMs: 0, aoaRad: 0, sideslipRad: 0, verticalSpeedMs: 0,
    loadFactor: 1, gLimited: false, stalled: false,
  };
}

describe("liftCoefficient", () => {
  it("is exactly linear below the stall", () => {
    expect(liftCoefficient(degToRad(5), P, CLEAN)).toBeCloseTo(
      P.aero.cl0 + P.aero.clAlphaPerRad * degToRad(5), 12);
  });
  it("peaks at exactly CLmax at the break", () => {
    expect(liftCoefficient(stallAlphaFor(P, CLEAN), P, CLEAN)).toBeCloseTo(clMaxFor(P, CLEAN), 12);
  });
  it("rolls off softly past the break rather than falling off a cliff", () => {
    const peak = clMaxFor(P, CLEAN);
    const past = liftCoefficient(stallAlphaFor(P, CLEAN) + degToRad(6), P, CLEAN);
    expect(past).toBeLessThan(peak);
    expect(past).toBeGreaterThan(0.55 * peak); // soft, mushy — still flying, badly
  });
  it("keeps falling deeper into the stall", () => {
    const a = liftCoefficient(stallAlphaFor(P, CLEAN) + degToRad(6), P, CLEAN);
    const b = liftCoefficient(stallAlphaFor(P, CLEAN) + degToRad(20), P, CLEAN);
    expect(b).toBeLessThan(a);
  });
  it("is antisymmetric-ish about zero-lift AoA (negative AoA gives negative lift)", () => {
    expect(liftCoefficient(degToRad(-10), P, CLEAN)).toBeLessThan(0);
  });
  it("flaps raise CLmax and lower the stall AoA", () => {
    expect(clMaxFor(P, FULL)).toBeGreaterThan(clMaxFor(P, CLEAN));
    expect(stallAlphaFor(P, FULL)).toBeLessThan(stallAlphaFor(P, CLEAN));
  });
});

describe("dragCoefficient", () => {
  it("is a parabolic polar: CD = CD0 + CL^2/(pi e AR)", () => {
    const cl = 0.6;
    const expected = P.aero.cd0 + (cl * cl) / (Math.PI * P.aero.oswaldE * P.aspectRatio);
    expect(dragCoefficient(cl, P, CLEAN)).toBeCloseTo(expected, 12);
  });
  it("flaps add parasite drag as well as lift", () => {
    expect(dragCoefficient(0.6, P, FULL)).toBeGreaterThan(dragCoefficient(0.6, P, CLEAN));
  });
  it("is minimum at zero lift", () => {
    expect(dragCoefficient(0, P, CLEAN)).toBeCloseTo(P.aero.cd0, 12);
  });
});

describe("thrustNewtons", () => {
  it("is power-limited above the prop peak speed: T = eta*P/V", () => {
    const v = 70;
    expect(thrustNewtons(P, 1, v)).toBeCloseTo((P.propulsion.propEfficiency * P.propulsion.maxPowerW) / v, 6);
  });
  it("does not run away as V -> 0 (static thrust is finite)", () => {
    const t0 = thrustNewtons(P, 1, 0);
    expect(Number.isFinite(t0)).toBe(true);
    expect(t0).toBeCloseTo(
      (P.propulsion.propEfficiency * P.propulsion.maxPowerW) / P.propulsion.propPeakSpeedMs, 6);
  });
  it("scales linearly with throttle and is zero at idle", () => {
    expect(thrustNewtons(P, 0.5, 70)).toBeCloseTo(thrustNewtons(P, 1, 70) / 2, 9);
    expect(thrustNewtons(P, 0, 70)).toBe(0);
  });
  it("falls with speed above the peak (a top-speed asymptote exists)", () => {
    expect(thrustNewtons(P, 1, 90)).toBeLessThan(thrustNewtons(P, 1, 70));
  });
});

describe("controlAuthority", () => {
  it("is full at and above the reference dynamic pressure", () => {
    expect(controlAuthority(P.control.refDynamicPressurePa, P)).toBeCloseTo(1, 9);
    expect(controlAuthority(5000, P)).toBe(1);
  });
  it("goes mushy at low q", () => {
    expect(controlAuthority(300, P)).toBeCloseTo(0.25, 6);
    expect(controlAuthority(0, P)).toBe(0);
  });
});

describe("stallSpeedIasMs", () => {
  it("is lower with flaps down", () => {
    expect(stallSpeedIasMs(P, 3)).toBeLessThan(stallSpeedIasMs(P, 0));
  });
});

describe("computeForces", () => {
  it("returns a finite force with zero airspeed instead of NaN", () => {
    const r = computeForces(stateAt(1000, 0), CONTROLS, P);
    expect(Number.isFinite(r.forceEcef.x)).toBe(true);
    expect(Number.isFinite(r.aoaRad)).toBe(true);
    expect(r.tasMs).toBe(0);
  });
  it("does NOT clamp in ordinary flight — the clamp must not be always-on", () => {
    // 50 m/s, wings level, zero AoA: nowhere near the envelope.
    const r = computeForces(stateAt(1000, 50, 0, 0), CONTROLS, P);
    expect(r.gLimited).toBe(false);
    expect(r.loadFactor).toBeLessThan(P.limits.gLimitPos);
  });
  it("clamps a hard pull at +3.8 g and says it clamped", () => {
    // 90 m/s (175 kt) with the nose 6° above a level flight path = 6° AoA. Unclamped that
    // is about 6 g for this airframe, so the clamp MUST engage.
    const r = computeForces(stateAt(1000, 90, 6, 0), CONTROLS, P);
    expect(r.gLimited).toBe(true);
    expect(r.loadFactor).toBeCloseTo(P.limits.gLimitPos, 6);
  });
  it("clamps a hard push at -1.52 g and says it clamped", () => {
    // Same speed, nose 8° BELOW a level flight path: strongly negative lift.
    const r = computeForces(stateAt(1000, 90, -8, 0), CONTROLS, P);
    expect(r.gLimited).toBe(true);
    expect(r.loadFactor).toBeCloseTo(P.limits.gLimitNeg, 6);
  });
});
```

- [ ] **Step 10: Run to see it fail** — `cd frontend && npm run test -- src/sim/forces.test.ts`. Expected: "Failed to load url ./forces".

- [ ] **Step 11: Implement the force model**

```ts
// frontend/src/sim/forces.ts
/*
 * One 6-DOF force/moment model, parameterized entirely by ClassParams — no per-class
 * branches (spec §5, CLAUDE.md). Parent spec §4 is the shape:
 *
 *   lift   = 0.5 * rho * V^2 * S * CL(alpha), CL blending to a flat plate past the stall
 *   drag   = 0.5 * rho * V^2 * S * (CD0(flap) + CL^2/(pi e AR))
 *   thrust = power-limited, T = eta(V) * P / V along the body X axis
 *   gravity= m * g0 along -geodeticSurfaceNormal (NOT radial)
 *   moments= commanded body rate * control authority(q) - per-axis rate damping,
 *            plus static pitch stiffness toward the trimmed AoA and weathercock in yaw
 *
 * Angular dynamics are a rate-command-with-lag form rather than explicit coefficient
 * moments: the research doc gives us max roll rate but no Cl_p / Cl_delta, so writing
 * derivative coefficients would mean inventing numbers and calling them physics. The
 * response constants are named, documented tuning knobs instead. Decisions.md B-007.
 */
import type { ClassParams, ControlVector, FlapDetent, SimState, Vec3 } from "./types";
import { isaDensity, RHO_SL, tasToIas } from "./isa";
import { geodeticSurfaceNormal } from "./geo";
import { qRotate, qRotateInverse } from "./quat";
import { vAdd, vLength, vScale } from "./vec3";

const G0 = 9.80665;

export type ForceResult = {
  /** Total external force on the aircraft, ECEF newtons. */
  forceEcef: Vec3;
  /** Body angular acceleration, rad/s^2. */
  ratesDotBody: Vec3;
  aoaRad: number;
  sideslipRad: number;
  tasMs: number;
  iasMs: number;
  loadFactor: number;
  gLimited: boolean;
  stalled: boolean;
};

export function stallAlphaFor(params: ClassParams, flap: FlapDetent): number {
  return params.aero.stallAlphaRad + flap.dStallAlphaRad;
}

/** CLmax is analytic and exact: the linear curve evaluated at the break. */
export function clMaxFor(params: ClassParams, flap: FlapDetent): number {
  return params.aero.cl0 + flap.dCL0 + params.aero.clAlphaPerRad * stallAlphaFor(params, flap);
}

/**
 * Linear lift curve up to the break, then an exponential fade from CLmax toward flat-plate
 * lift over `postStallDecayRad` — soft and mushy (the 172's signature) rather than a CL
 * cliff. Continuous at the break by construction, and CLmax is exactly the linear value,
 * so `stallSpeedIasMs` and the book V-speeds stay in agreement with what the wing actually
 * does. (A double-sigmoid blend was considered and rejected: it caps the achievable CL
 * well below the stated CLmax, which would have made the stall-speed readout a lie.)
 */
export function liftCoefficient(alphaRad: number, params: ClassParams, flap: FlapDetent): number {
  const alphaStall = stallAlphaFor(params, flap);
  const cl0 = params.aero.cl0 + flap.dCL0;
  if (Math.abs(alphaRad) <= alphaStall) {
    return cl0 + params.aero.clAlphaPerRad * alphaRad;
  }
  const sign = Math.sign(alphaRad);
  const clPeak = cl0 + params.aero.clAlphaPerRad * alphaStall * sign;
  const over = Math.abs(alphaRad) - alphaStall;
  const w = Math.exp(-over / params.aero.postStallDecayRad);
  const clPlate = 2 * sign * Math.sin(alphaRad) ** 2 * Math.cos(alphaRad);
  return w * clPeak + (1 - w) * clPlate;
}

export function dragCoefficient(cl: number, params: ClassParams, flap: FlapDetent): number {
  const induced = (cl * cl) / (Math.PI * params.aero.oswaldE * params.aspectRatio);
  return params.aero.cd0 + flap.dCD0 + induced;
}

/** Wings-level 1 g stall speed as indicated airspeed, for the given flap detent. */
export function stallSpeedIasMs(params: ClassParams, flapIndex: number): number {
  const flap = params.flaps[flapIndex] ?? params.flaps[0];
  const clMax = clMaxFor(params, flap);
  return Math.sqrt((2 * params.massKg * G0) / (RHO_SL * params.wingAreaM2 * clMax));
}

/**
 * Power-limited propeller thrust with a linear efficiency ramp below the prop's peak
 * speed. `eta(V) * P / V` with `eta(V) = etaMax * min(1, V/Vpeak)` collapses to
 * `etaMax * P / max(V, Vpeak)` — which is finite at V = 0, so static thrust needs no
 * separate cap, and which gives a top-speed asymptote a constant-thrust model cannot.
 */
export function thrustNewtons(params: ClassParams, throttle: number, tasMs: number): number {
  const { maxPowerW, propEfficiency, propPeakSpeedMs } = params.propulsion;
  const clamped = Math.min(1, Math.max(0, throttle));
  return (clamped * propEfficiency * maxPowerW) / Math.max(tasMs, propPeakSpeedMs);
}

/** Control effectiveness scales with dynamic pressure and saturates at 1. */
export function controlAuthority(qBarPa: number, params: ClassParams): number {
  return Math.min(1, Math.max(0, qBarPa / params.control.refDynamicPressurePa));
}

export function computeForces(
  state: SimState,
  controls: ControlVector,
  params: ClassParams,
): ForceResult {
  const flap = params.flaps[controls.flapDetent] ?? params.flaps[0];
  const rho = isaDensity(state.altitudeM);

  // Still air: the ECEF velocity IS the airspeed vector (parent spec §4, v1 scope).
  const vBody = qRotateInverse(state.attitude, state.velocity);
  const tasMs = vLength(vBody);
  const iasMs = tasToIas(tasMs, state.altitudeM);
  const aoaRad = tasMs > 0.1 ? Math.atan2(vBody.z, vBody.x) : 0;
  const sideslipRad = tasMs > 0.1 ? Math.asin(Math.min(1, Math.max(-1, vBody.y / tasMs))) : 0;

  const qBar = 0.5 * rho * tasMs * tasMs;
  const cl = liftCoefficient(aoaRad, params, flap);
  const cd = dragCoefficient(cl, params, flap);

  let lift = qBar * params.wingAreaM2 * cl;
  const drag = qBar * params.wingAreaM2 * cd;
  const side = qBar * params.wingAreaM2 * params.aero.cyBeta * sideslipRad;

  // Load factor is the specific force along -body-z. Clamp + warn only (no structural
  // failure this phase, parent spec §4): scale lift so n stays inside the cert envelope.
  const weight = params.massKg * G0;
  const nUnclamped = (lift * Math.cos(aoaRad) + drag * Math.sin(aoaRad)) / weight;
  let gLimited = false;
  let loadFactor = nUnclamped;
  if (nUnclamped > params.limits.gLimitPos) {
    lift *= params.limits.gLimitPos / nUnclamped;
    loadFactor = params.limits.gLimitPos;
    gLimited = true;
  } else if (nUnclamped < params.limits.gLimitNeg) {
    lift *= params.limits.gLimitNeg / nUnclamped;
    loadFactor = params.limits.gLimitNeg;
    gLimited = true;
  }

  // Wind axes -> body axes (rotate by AoA about the body Y axis).
  const forceBody: Vec3 = {
    x: -drag * Math.cos(aoaRad) + lift * Math.sin(aoaRad) + thrustNewtons(params, controls.throttle, tasMs),
    y: side,
    z: -drag * Math.sin(aoaRad) - lift * Math.cos(aoaRad),
  };

  const gravityEcef = vScale(geodeticSurfaceNormal(state.position), -weight);
  const forceEcef = vAdd(qRotate(state.attitude, forceBody), gravityEcef);

  // ---- moments as rate command + damping ----
  const authority = controlAuthority(qBar, params);
  const c = params.control;
  const alphaTrim = c.trimAlphaCenterRad + controls.trim * c.trimAlphaRangeRad;
  const pCmd = controls.roll * c.rollRateMaxRadS * authority;
  const qCmd = controls.pitch * c.pitchRateMaxRadS * authority;
  const rCmd = controls.yaw * c.yawRateMaxRadS * authority;

  const ratesDotBody: Vec3 = {
    x: (pCmd - state.rates.x) * c.rollDampingPerS,
    y:
      (qCmd - state.rates.y) * c.pitchDampingPerS +
      c.pitchStiffnessPerS2 * (alphaTrim - aoaRad) * authority,
    z:
      (rCmd - state.rates.z) * c.yawDampingPerS +
      c.yawStiffnessPerS2 * sideslipRad * authority,
  };

  return {
    forceEcef,
    ratesDotBody,
    aoaRad,
    sideslipRad,
    tasMs,
    iasMs,
    loadFactor,
    gLimited,
    stalled: Math.abs(aoaRad) > stallAlphaFor(params, flap),
  };
}
```

- [ ] **Step 12: Run to see it pass** — `cd frontend && npm run test -- src/sim/forces.test.ts`. Expected: 20 passed.

- [ ] **Step 13: Write failing accumulator tests**

```ts
// frontend/src/sim/integrator.test.ts
import { describe, it, expect } from "vitest";
import { FIXED_DT, MAX_FRAME_S, MAX_STEPS_PER_FRAME, createAccumulator, runFixedSteps } from "./integrator";

describe("fixed-step accumulator", () => {
  it("runs at 60 Hz", () => {
    expect(FIXED_DT).toBeCloseTo(1 / 60, 12);
    expect(MAX_STEPS_PER_FRAME).toBe(Math.round(MAX_FRAME_S / FIXED_DT));
  });
  it("runs 0 steps for a frame shorter than one tick, and carries the remainder", () => {
    const acc = createAccumulator();
    expect(runFixedSteps(acc, 0.008, () => {})).toEqual({ steps: 0, clamped: false });
    expect(runFixedSteps(acc, 0.009, () => {}).steps).toBe(1);
  });
  it("runs exactly 6 steps for a 100 ms frame", () => {
    const acc = createAccumulator();
    let n = 0;
    const r = runFixedSteps(acc, 0.1, () => { n++; });
    expect(r.steps).toBe(6);
    expect(n).toBe(6);
    expect(r.clamped).toBe(false);
  });
  it("a 30 s gap (backgrounded tab) is capped at 15 steps and reported as clamped", () => {
    const acc = createAccumulator();
    let n = 0;
    const r = runFixedSteps(acc, 30, () => { n++; });
    expect(r.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(n).toBe(MAX_STEPS_PER_FRAME);
    expect(r.clamped).toBe(true);
  });
  it("drops the excess rather than carrying it (no death spiral after a gap)", () => {
    const acc = createAccumulator();
    runFixedSteps(acc, 30, () => {});
    const next = runFixedSteps(acc, 0.016, () => {});
    expect(next.steps).toBeLessThanOrEqual(1);
    expect(next.clamped).toBe(false);
  });
  it("a synthetic dt sequence totals the right number of steps", () => {
    const acc = createAccumulator();
    const frames = [0.016, 0.017, 0.016, 0.033, 0.016, 0.016, 0.016, 0.016];
    let n = 0;
    for (const f of frames) runFixedSteps(acc, f, () => { n++; });
    const total = frames.reduce((a, b) => a + b, 0);
    expect(n).toBe(Math.floor(total / FIXED_DT));
  });
  it("ignores negative or non-finite elapsed times", () => {
    const acc = createAccumulator();
    expect(runFixedSteps(acc, -5, () => {}).steps).toBe(0);
    expect(runFixedSteps(acc, Number.NaN, () => {}).steps).toBe(0);
  });
});
```

- [ ] **Step 14: Run to see it fail** — `cd frontend && npm run test -- src/sim/integrator.test.ts`. Expected: "Failed to load url ./integrator".

- [ ] **Step 15: Implement the accumulator**

```ts
// frontend/src/sim/integrator.ts
/*
 * Fixed 60 Hz physics decoupled from render (parent spec §3). The clamp is the important
 * part: a backgrounded tab or a long stall in the main thread hands us a huge elapsed time,
 * and simulating all of it would either freeze the frame or teleport the aircraft through
 * terrain. We cap at 0.25 s (15 steps) and DROP the excess — the sim honestly falls behind
 * wall time, and game/simRate.ts surfaces that as "SIM RATE 0.7x" instead of hiding it.
 */
export const FIXED_DT = 1 / 60;
export const MAX_FRAME_S = 0.25;
export const MAX_STEPS_PER_FRAME = Math.round(MAX_FRAME_S / FIXED_DT); // 15

export type Accumulator = { carryS: number };

export function createAccumulator(): Accumulator {
  return { carryS: 0 };
}

export function runFixedSteps(
  acc: Accumulator,
  elapsedS: number,
  step: () => void,
): { steps: number; clamped: boolean } {
  if (!Number.isFinite(elapsedS) || elapsedS <= 0) return { steps: 0, clamped: false };
  const clamped = elapsedS > MAX_FRAME_S;
  acc.carryS += clamped ? MAX_FRAME_S : elapsedS;

  let steps = 0;
  while (acc.carryS >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    acc.carryS -= FIXED_DT;
    step();
    steps++;
  }
  // Anything still in the accumulator after the cap is time we are never going to
  // simulate. Throwing it away is what keeps the next frame from spiralling.
  if (steps === MAX_STEPS_PER_FRAME) acc.carryS = 0;
  return { steps, clamped };
}
```

- [ ] **Step 16: Run to see it pass** — `cd frontend && npm run test -- src/sim/integrator.test.ts`. Expected: 7 passed.

- [ ] **Step 17: Write failing `stepAircraft` tests**

```ts
// frontend/src/sim/aircraft.test.ts
import { describe, it, expect } from "vitest";
import { stepAircraft, refreshDerived } from "./aircraft";
import { loadC172 } from "./params";
import { geodeticToEcef, ecefToGeodetic } from "./geo";
import { quatFromHpr, qRotate, hprFromQuat } from "./quat";
import { enuBasis } from "./geo";
import { vDot } from "./vec3";
import { degToRad, radToDeg } from "./units";
import { FIXED_DT } from "./integrator";
import type { ControlVector, SimState } from "./types";

/** Ground-track heading of the velocity vector, radians clockwise from north. */
function trackRad(s: SimState): number {
  const { east, north } = enuBasis(s.position);
  return Math.atan2(vDot(s.velocity, east), vDot(s.velocity, north));
}

/** Signed shortest-arc difference, degrees. */
function headingDeltaDeg(from: number, to: number): number {
  return (((radToDeg(to - from) % 360) + 540) % 360) - 180;
}

const P = loadC172();
const LAT = degToRad(30.6944);
const LON = degToRad(-88.0399);

const CONTROLS: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle: 0.75, flapDetent: 0, trim: 0 };

function levelState(altM: number, tasMs: number): SimState {
  const position = geodeticToEcef(LAT, LON, altM);
  const attitude = quatFromHpr(position, 0, 0, 0);
  const state: SimState = {
    position,
    velocity: qRotate(attitude, { x: tasMs, y: 0, z: 0 }),
    attitude,
    rates: { x: 0, y: 0, z: 0 },
    timeS: 0,
    altitudeM: altM, tasMs, iasMs: 0, aoaRad: 0, sideslipRad: 0,
    verticalSpeedMs: 0, loadFactor: 1, gLimited: false, stalled: false,
  };
  return refreshDerived(state, CONTROLS, P);
}

describe("stepAircraft", () => {
  it("advances sim time by exactly one fixed step", () => {
    const s = stepAircraft(levelState(2000, 60), CONTROLS, P);
    expect(s.timeS).toBeCloseTo(FIXED_DT, 12);
  });
  it("keeps the attitude quaternion unit-norm", () => {
    let s = levelState(2000, 60);
    for (let i = 0; i < 600; i++) s = stepAircraft(s, { ...CONTROLS, roll: 0.5, pitch: 0.2 }, P);
    const q = s.attitude;
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
  });
  it("never produces NaN, even from a dead stop", () => {
    let s = levelState(2000, 0);
    for (let i = 0; i < 600; i++) s = stepAircraft(s, CONTROLS, P);
    expect(Number.isFinite(s.position.x)).toBe(true);
    expect(Number.isFinite(s.velocity.z)).toBe(true);
    expect(Number.isFinite(s.altitudeM)).toBe(true);
  });
  it("an unpowered aircraft loses altitude", () => {
    let s = levelState(2000, 60);
    for (let i = 0; i < 600; i++) s = stepAircraft(s, { ...CONTROLS, throttle: 0 }, P);
    expect(s.altitudeM).toBeLessThan(2000);
    expect(s.verticalSpeedMs).toBeLessThan(0);
  });
  it("full power at a trimmed climb attitude gains altitude", () => {
    let s = levelState(500, 40);
    for (let i = 0; i < 900; i++) s = stepAircraft(s, { ...CONTROLS, throttle: 1, trim: 1 }, P);
    expect(s.altitudeM).toBeGreaterThan(500);
  });
  it("roll input rolls the aircraft right (positive roll = right wing down)", () => {
    let s = levelState(2000, 60);
    for (let i = 0; i < 60; i++) s = stepAircraft(s, { ...CONTROLS, roll: 1 }, P);
    expect(s.rates.x).toBeGreaterThan(0);
    expect(hprFromQuat(s.attitude, s.position).rollRad).toBeGreaterThan(degToRad(5));
  });
  it("a banked aircraft turns — the ground track swings toward the low wing", () => {
    // Roll right for 0.75 s (rate damping then holds the bank), then hold it with back
    // pressure for 10 s. Tilting the lift vector is what turns the velocity, so the GROUND
    // TRACK is the direct evidence — a position that merely moved would also pass in
    // straight flight, which is why this asserts a heading change and not a displacement.
    let s = levelState(2000, 60);
    for (let i = 0; i < 45; i++) s = stepAircraft(s, { ...CONTROLS, roll: 1 }, P);
    const before = trackRad(s);
    for (let i = 0; i < 600; i++) s = stepAircraft(s, { ...CONTROLS, pitch: 0.3 }, P);
    expect(headingDeltaDeg(before, trackRad(s))).toBeGreaterThan(20); // right turn
  });
  it("wings level, the ground track holds — the turn above came from the bank", () => {
    let s = levelState(2000, 60);
    const before = trackRad(s);
    for (let i = 0; i < 600; i++) s = stepAircraft(s, { ...CONTROLS, pitch: 0.3 }, P);
    expect(Math.abs(headingDeltaDeg(before, trackRad(s)))).toBeLessThan(5);
  });
  it("derived readouts stay consistent with the raw state", () => {
    const s = stepAircraft(levelState(2000, 60), CONTROLS, P);
    expect(s.altitudeM).toBeCloseTo(ecefToGeodetic(s.position).heightM, 6);
    expect(s.tasMs).toBeGreaterThan(50);
    expect(s.iasMs).toBeLessThan(s.tasMs); // 2000 m up, IAS reads low
  });
  it("does not mutate the state object it was given", () => {
    const s0 = levelState(2000, 60);
    const snapshot = JSON.stringify(s0);
    stepAircraft(s0, CONTROLS, P);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});
```

- [ ] **Step 18: Run to see it fail** — `cd frontend && npm run test -- src/sim/aircraft.test.ts`. Expected: "Failed to load url ./aircraft".

- [ ] **Step 19: Implement `stepAircraft`**

```ts
// frontend/src/sim/aircraft.ts
/*
 * One physics step. Semi-implicit (symplectic) Euler: integrate the derivatives first,
 * then advance position/attitude with the NEW velocity/rates.
 *
 * Why semi-implicit Euler and not RK2/RK4: at dt = 1/60 s the fastest mode in this model is
 * the pitch short period (omega_n ~ 1.7 rad/s, zeta 0.7) — three orders of magnitude below
 * the sample rate — so accuracy is not the constraint. Semi-implicit Euler is one force
 * evaluation per step (RK2 is two, and would double the terrain-sample and force cost for
 * no visible difference), it does not pump energy into oscillatory modes the way explicit
 * Euler does, and it is four lines a DBA can read. Documented in decisions.md B-007.
 */
import type { ClassParams, ControlVector, SimState } from "./types";
import { computeForces } from "./forces";
import { ecefToGeodetic, geodeticSurfaceNormal } from "./geo";
import { qIntegrate } from "./quat";
import { FIXED_DT } from "./integrator";
import { vAdd, vDot, vScale } from "./vec3";

/** Recompute the derived readouts on a state without advancing time. */
export function refreshDerived(
  state: SimState,
  controls: ControlVector,
  params: ClassParams,
): SimState {
  const geo = ecefToGeodetic(state.position);
  const withAlt: SimState = { ...state, altitudeM: geo.heightM };
  const f = computeForces(withAlt, controls, params);
  return {
    ...withAlt,
    tasMs: f.tasMs,
    iasMs: f.iasMs,
    aoaRad: f.aoaRad,
    sideslipRad: f.sideslipRad,
    verticalSpeedMs: vDot(state.velocity, geodeticSurfaceNormal(state.position)),
    loadFactor: f.loadFactor,
    gLimited: f.gLimited,
    stalled: f.stalled,
  };
}

export function stepAircraft(
  state: SimState,
  controls: ControlVector,
  params: ClassParams,
  dt: number = FIXED_DT,
): SimState {
  const f = computeForces(state, controls, params);

  // Semi-implicit: new derivatives first...
  const velocity = vAdd(state.velocity, vScale(f.forceEcef, dt / params.massKg));
  const rates = vAdd(state.rates, vScale(f.ratesDotBody, dt));

  // ...then advance the integrals with them.
  const position = vAdd(state.position, vScale(velocity, dt));
  const attitude = qIntegrate(state.attitude, rates, dt);

  const geo = ecefToGeodetic(position);
  const advanced: SimState = {
    position,
    velocity,
    attitude,
    rates,
    timeS: state.timeS + dt,
    altitudeM: geo.heightM,
    tasMs: f.tasMs,
    iasMs: f.iasMs,
    aoaRad: f.aoaRad,
    sideslipRad: f.sideslipRad,
    verticalSpeedMs: vDot(velocity, geodeticSurfaceNormal(position)),
    loadFactor: f.loadFactor,
    gLimited: f.gLimited,
    stalled: f.stalled,
  };
  return advanced;
}
```

- [ ] **Step 20: Run to see it pass** — `cd frontend && npm run test -- src/sim/aircraft.test.ts`. Expected: 10 passed.

- [ ] **Step 21: Log the modelling calls** — append to `docs/decisions.md`:

```markdown
## 2026-08-05 — B-007 · Rate-command moments and semi-implicit Euler in the sim core

Two modelling calls that shape everything downstream:

**Moments are rate-command-with-lag, not coefficient moments.** `docs/research/
aero-parameters.md` gives a max roll rate for the C172 but no Cl_p, Cl_delta_a, Cm_q or
Cm_alpha — writing a derivative-coefficient moment model would mean inventing numbers and
presenting them as physics. Instead `sim/forces.ts` commands a body rate proportional to
stick and dynamic-pressure authority and lets a per-axis damping constant pull the actual
rate toward it, plus a static pitch stiffness toward the trimmed AoA (so elevator trim sets
speed, as it does in the real aircraft) and a weathercock term in yaw. Every constant is
named and marked TUNING KNOB in `params/c172.json` `sources`. Consequence to accept: the
model has no inertia coupling and no adverse yaw.

**Semi-implicit Euler at 60 Hz, not RK2/RK4.** The fastest mode in the model (pitch short
period, omega_n ≈ 1.7 rad/s) is three orders of magnitude below the sample rate, so the
integrator is not the accuracy bottleneck; semi-implicit Euler costs one force evaluation
per step instead of two or four and does not pump energy into oscillatory modes. Rationale
is repeated in the header of `sim/aircraft.ts` where a reader will actually meet it.

**Earth rotation is ignored** — no Coriolis, no transport rate, documented in
`sim/geo.ts`. Gravity is taken along `geodeticSurfaceNormal`, not radially (spec §5).
```

- [ ] **Step 22: Full suite + typecheck + commit** — `cd frontend && npm run test && npm run typecheck`. Expected: 118 tests passed (26 Phase A + 26 Task 1 + 66 Task 2: geo 13, quat 16, forces 20, integrator 7, aircraft 10), typecheck clean. Then:

```bash
git add frontend/src/sim docs/decisions.md && git commit -m "feat(sim): WGS84 geodesy, quaternion attitude, force model, fixed-step integrator"
```

---

### Task 3: Envelope tests + tuning — the C172S must fly the book numbers

This task's deliverable is a **green envelope suite plus the tuning values recorded in `params/c172.json` `sources`**. The suite is the acceptance criterion for the whole sim core: if a later change moves cruise speed or stall speed outside the band, this suite is what says so.

It also forces one physics addition the earlier tasks did not need: a **normally-aspirated piston power lapse with density altitude**. Without it a C172 climbs at 780 fpm at its service ceiling, which the ceiling test catches.

**Files:**
- Create: `frontend/src/sim/envelope.test.ts`
- Modify: `frontend/src/sim/forces.ts` (add `pistonPowerLapse`; `thrustNewtons` gains an `altitudeM` parameter), `frontend/src/sim/forces.test.ts` (thrust tests pass an altitude), `frontend/src/params/c172.json` (final tuned values + `sources`), `docs/decisions.md` (append B-008)
- No changes to `sim/aircraft.ts` beyond the one call site (`computeForces` already knows `state.altitudeM`).

**Interfaces:**
- Consumes: `loadC172()`, `liftCoefficient`, `dragCoefficient`, `clMaxFor`, `stallSpeedIasMs`, `thrustNewtons`, `computeForces`, `stepAircraft`, `refreshDerived`, `isaDensity`, `RHO_SL`, `msToKt`, `ktToMs`, `ftToM`, `msToFpm`, `geodeticToEcef`, `quatFromHpr`, `qRotate`, `FIXED_DT`.
- Produces:
  - `sim/forces.ts`: `pistonPowerLapse(altitudeM:number):number`; **changed signature** `thrustNewtons(params:ClassParams, throttle:number, tasMs:number, altitudeM:number):number`.
  - `sim/envelope.test.ts` exports nothing; it defines two local helpers reused across its cases: `levelFlightExcessThrustN(params, altM, throttle, flapIndex, tasMs)` and `maxLevelSpeedMs(params, altM, throttle, flapIndex)` (bisection on the high-speed root), plus `trimForLevelFlight(altM, throttle, startTasMs)` (bisection on the trim control to null the climb rate; it closes over `P` rather than taking params).

- [ ] **Step 1: Write the failing envelope suite** — every expectation is a published 172S POH number with the tolerance band the spec asks for.

```ts
// frontend/src/sim/envelope.test.ts
/*
 * The C172S performance envelope, asserted against the 172S POH numbers in
 * docs/research/aero-parameters.md §1. These are the numbers that decide whether the
 * parameter file is honest. Tolerances come from the Phase B spec §8 / plan brief:
 * cruise ±5 kt, stall speeds ±3 kt.
 *
 * Speeds are found by search (bisection on the force balance, and a trim search through
 * the real integrator) rather than by hard-coding an expected answer — so the test proves
 * the model produces the number, not that someone typed the number twice.
 */
import { describe, it, expect } from "vitest";
import { loadC172 } from "./params";
import {
  dragCoefficient, stallSpeedIasMs, thrustNewtons, pistonPowerLapse, computeForces, clMaxFor,
} from "./forces";
import { isaDensity } from "./isa";
import { stepAircraft, refreshDerived } from "./aircraft";
import { geodeticToEcef } from "./geo";
import { quatFromHpr, qRotate } from "./quat";
import { degToRad, ftToM, ktToMs, msToKt, msToFpm } from "./units";
import type { ClassParams, ControlVector, SimState } from "./types";

const P = loadC172();
const G0 = 9.80665;
const LAT = degToRad(30.6944);
const LON = degToRad(-88.0399);

/** Thrust minus the drag required to hold level flight at this speed. */
function levelFlightExcessThrustN(
  params: ClassParams, altM: number, throttle: number, flapIndex: number, tasMs: number,
): number {
  const qBar = 0.5 * isaDensity(altM) * tasMs * tasMs;
  const cl = (params.massKg * G0) / (qBar * params.wingAreaM2);
  const cd = dragCoefficient(cl, params, params.flaps[flapIndex]);
  return thrustNewtons(params, throttle, tasMs, altM) - cd * qBar * params.wingAreaM2;
}

/** The high-speed root of thrust = drag: the fastest speed this power setting can hold. */
function maxLevelSpeedMs(params: ClassParams, altM: number, throttle: number, flapIndex = 0): number {
  const f = (v: number) => levelFlightExcessThrustN(params, altM, throttle, flapIndex, v);
  // Scan for the speed of maximum excess thrust, then bisect upward from there.
  let lo = 10;
  let best = -Infinity;
  for (let v = 10; v <= 200; v += 0.5) {
    const e = f(v);
    if (e > best) { best = e; lo = v; }
  }
  expect(best).toBeGreaterThan(0); // this power setting can hold level flight at all
  let hi = 200;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Best rate of climb at this altitude and power, m/s, by scanning the speed range. */
function bestClimbRateMs(params: ClassParams, altM: number, throttle: number): number {
  let best = -Infinity;
  for (let v = 15; v <= 120; v += 0.25) {
    const excess = levelFlightExcessThrustN(params, altM, throttle, 0, v);
    const climb = (excess * v) / (params.massKg * G0);
    if (climb > best) best = climb;
  }
  return best;
}

function levelState(altM: number, tasMs: number, controls: ControlVector): SimState {
  const position = geodeticToEcef(LAT, LON, altM);
  const attitude = quatFromHpr(position, 0, 0, 0);
  return refreshDerived(
    {
      position,
      velocity: qRotate(attitude, { x: tasMs, y: 0, z: 0 }),
      attitude,
      rates: { x: 0, y: 0, z: 0 },
      timeS: 0,
      altitudeM: altM, tasMs, iasMs: 0, aoaRad: 0, sideslipRad: 0,
      verticalSpeedMs: 0, loadFactor: 1, gLimited: false, stalled: false,
    },
    controls,
    P,
  );
}

/** Fly for `seconds` and report the altitude change and the mean TAS over the last third. */
function flyAndMeasure(
  start: SimState, controls: ControlVector, seconds: number,
): { dAltM: number; meanTasMs: number } {
  const steps = Math.round(seconds * 60);
  const tailFrom = Math.floor(steps * (2 / 3));
  let s = start;
  let tasSum = 0;
  let tasN = 0;
  for (let i = 0; i < steps; i++) {
    s = stepAircraft(s, controls, P);
    if (i >= tailFrom) { tasSum += s.tasMs; tasN++; }
  }
  return { dAltM: s.altitudeM - start.altitudeM, meanTasMs: tasSum / tasN };
}

/** Bisect on elevator trim until 120 s of flight ends at the altitude it started at. */
function trimForLevelFlight(altM: number, throttle: number, startTasMs: number): number {
  const run = (trim: number) => {
    const controls: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle, flapDetent: 0, trim };
    return flyAndMeasure(levelState(altM, startTasMs, controls), controls, 120).dAltM;
  };
  let lo = -1;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (run(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

describe("C172S envelope — cruise", () => {
  it("75% rated power is still available at 8000 ft (throttle needed is under 100%)", () => {
    const throttle = 0.75 / pistonPowerLapse(ftToM(8000));
    expect(throttle).toBeLessThanOrEqual(1);
  });
  it("cruises at 122 kt TAS +/- 5 at 75% power, 8000 ft (POH: 122-124 kt)", () => {
    const alt = ftToM(8000);
    const throttle = 0.75 / pistonPowerLapse(alt);
    const tas = msToKt(maxLevelSpeedMs(P, alt, throttle));
    expect(tas).toBeGreaterThan(117);
    expect(tas).toBeLessThan(127);
  });
  it("the integrator agrees with the force balance: trimmed level flight settles at the same speed", () => {
    const alt = ftToM(8000);
    const throttle = 0.75 / pistonPowerLapse(alt);
    const analytic = maxLevelSpeedMs(P, alt, throttle);
    const trim = trimForLevelFlight(alt, throttle, analytic);
    const controls: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle, flapDetent: 0, trim };
    const flown = flyAndMeasure(levelState(alt, analytic, controls), controls, 180);
    expect(Math.abs(flown.dAltM)).toBeLessThan(150); // held altitude within 150 m over 3 min
    expect(msToKt(flown.meanTasMs)).toBeGreaterThan(117);
    expect(msToKt(flown.meanTasMs)).toBeLessThan(127);
  });
  it("tops out near 126 kt TAS at sea level, full power (POH Vh 126 kt)", () => {
    const tas = msToKt(maxLevelSpeedMs(P, 0, 1));
    expect(tas).toBeGreaterThan(118);
    expect(tas).toBeLessThan(134);
  });
});

describe("C172S envelope — stall speeds", () => {
  it("Vs1 clean is 48 KCAS +/- 3 (POH 48)", () => {
    const vs1 = msToKt(stallSpeedIasMs(P, 0));
    expect(vs1).toBeGreaterThan(45);
    expect(vs1).toBeLessThan(51);
  });
  it("Vs0 with full flap is 40 KCAS +/- 3 (POH 40)", () => {
    const vs0 = msToKt(stallSpeedIasMs(P, 3));
    expect(vs0).toBeGreaterThan(37);
    expect(vs0).toBeLessThan(43);
  });
  it("clean CLmax stays inside the sourced 1.47-1.58 range", () => {
    expect(clMaxFor(P, P.flaps[0])).toBeGreaterThan(1.47);
    expect(clMaxFor(P, P.flaps[0])).toBeLessThan(1.58);
  });
  it("each flap detent lowers the stall speed monotonically", () => {
    const speeds = P.flaps.map((_, i) => stallSpeedIasMs(P, i));
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeLessThan(speeds[i - 1]);
  });
  it("holding the stick back below Vs1 stalls rather than climbing away", () => {
    const controls: ControlVector = { pitch: 1, roll: 0, yaw: 0, throttle: 0.2, flapDetent: 0, trim: 1 };
    let s = levelState(1500, stallSpeedIasMs(P, 0) * 0.95, controls);
    let sawStall = false;
    for (let i = 0; i < 600; i++) {
      s = stepAircraft(s, controls, P);
      if (s.stalled) sawStall = true;
    }
    expect(sawStall).toBe(true);
    expect(s.altitudeM).toBeLessThan(1500 + 60);
  });
});

describe("C172S envelope — climb and ceiling", () => {
  it("climbs about 730 fpm at sea level, full power (POH 730)", () => {
    const fpm = msToFpm(bestClimbRateMs(P, 0, 1));
    expect(fpm).toBeGreaterThan(630);
    expect(fpm).toBeLessThan(830);
  });
  it("still climbs, but barely, at the 14000 ft service ceiling", () => {
    const fpm = msToFpm(bestClimbRateMs(P, P.limits.serviceCeilingM, 1));
    expect(fpm).toBeGreaterThan(0);
    expect(fpm).toBeLessThan(300);
  });
  it("engine power lapses with density altitude", () => {
    expect(pistonPowerLapse(0)).toBeCloseTo(1, 6);
    expect(pistonPowerLapse(ftToM(8000))).toBeLessThan(0.85);
    expect(pistonPowerLapse(ftToM(8000))).toBeGreaterThan(0.65);
    expect(pistonPowerLapse(ftToM(14000))).toBeLessThan(pistonPowerLapse(ftToM(8000)));
  });
});

describe("C172S envelope — limits", () => {
  it("Vne is 163 KIAS", () => {
    expect(msToKt(P.limits.vneIasMs)).toBeCloseTo(163, 0);
  });
  it("g is clamped to +3.8 / -1.52", () => {
    expect(P.limits.gLimitPos).toBe(3.8);
    expect(P.limits.gLimitNeg).toBe(-1.52);
  });
  it("a hard pull at speed is clamped at +3.8 g and reports it", () => {
    const controls: ControlVector = { pitch: 1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: 1 };
    let s = levelState(2000, ktToMs(140), controls);
    let maxG = 0;
    let sawLimit = false;
    for (let i = 0; i < 600; i++) {
      s = stepAircraft(s, controls, P);
      maxG = Math.max(maxG, s.loadFactor);
      if (s.gLimited) sawLimit = true;
    }
    expect(maxG).toBeLessThanOrEqual(P.limits.gLimitPos + 1e-9);
    expect(sawLimit).toBe(true);
  });
  it("a hard push is clamped at -1.52 g, and actually reaches it", () => {
    const controls: ControlVector = { pitch: -1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: -1 };
    let s = levelState(2000, ktToMs(140), controls);
    let minG = Number.POSITIVE_INFINITY;
    let sawNegLimit = false;
    for (let i = 0; i < 600; i++) {
      s = stepAircraft(s, controls, P);
      minG = Math.min(minG, s.loadFactor);
      if (s.gLimited && s.loadFactor < 0) sawNegLimit = true;
    }
    // Without this second assertion the clamp check passes even if the push never
    // produced negative g at all.
    expect(sawNegLimit).toBe(true);
    expect(minG).toBeGreaterThanOrEqual(P.limits.gLimitNeg - 1e-9);
    expect(minG).toBeCloseTo(P.limits.gLimitNeg, 6);
  });
  it("cannot exceed Vne in level flight at full power (Vne is a dive speed)", () => {
    expect(maxLevelSpeedMs(P, 0, 1)).toBeLessThan(P.limits.vneIasMs);
  });
  it("the aircraft never produces NaN across the whole envelope sweep", () => {
    const controls: ControlVector = { pitch: 0.6, roll: 0.6, yaw: 0.6, throttle: 1, flapDetent: 3, trim: 1 };
    let s = levelState(3000, ktToMs(90), controls);
    for (let i = 0; i < 3600; i++) s = stepAircraft(s, controls, P);
    expect(Number.isFinite(s.position.x)).toBe(true);
    expect(Number.isFinite(s.tasMs)).toBe(true);
    expect(Number.isFinite(s.loadFactor)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `cd frontend && npm run test -- src/sim/envelope.test.ts`. Expected: the file fails to import (`pistonPowerLapse` is not exported from `./forces`). This is the honest first failure — the physics gap comes next.

- [ ] **Step 3: Add the piston power lapse and thread altitude through thrust** — edit `frontend/src/sim/forces.ts`:

```ts
/**
 * Normally-aspirated piston power lapse with density altitude (Gagg-Ferrar):
 *   P(h)/P(0) = (sigma - 0.117) / 0.883,  sigma = rho(h)/rho(0)
 * Without this a C172 climbs at 780 fpm at its published service ceiling — the ceiling
 * only exists because the engine loses power with air density, not because drag rises.
 */
export function pistonPowerLapse(altitudeM: number): number {
  const sigma = isaDensity(altitudeM) / RHO_SL;
  return Math.max(0, (sigma - 0.117) / 0.883);
}

export function thrustNewtons(
  params: ClassParams,
  throttle: number,
  tasMs: number,
  altitudeM: number,
): number {
  const { maxPowerW, propEfficiency, propPeakSpeedMs } = params.propulsion;
  const clamped = Math.min(1, Math.max(0, throttle));
  const shaftPowerW = clamped * maxPowerW * pistonPowerLapse(altitudeM);
  return (propEfficiency * shaftPowerW) / Math.max(tasMs, propPeakSpeedMs);
}
```

  and the single call site inside `computeForces`:

```ts
    x: -drag * Math.cos(aoaRad) + lift * Math.sin(aoaRad) +
       thrustNewtons(params, controls.throttle, tasMs, state.altitudeM),
```

- [ ] **Step 4: Update the Task 2 thrust tests for the new signature** — edit `frontend/src/sim/forces.test.ts`, `describe("thrustNewtons")`: pass `0` (sea level) as the fourth argument in every call, and add one case:

```ts
  it("lapses with density altitude", () => {
    expect(thrustNewtons(P, 1, 70, 3000)).toBeLessThan(thrustNewtons(P, 1, 70, 0));
  });
```

- [ ] **Step 5: Run both files** — `cd frontend && npm run test -- src/sim/forces.test.ts src/sim/envelope.test.ts`. Expected: `forces` 21 passed; `envelope` runs and most cases pass. Record which envelope cases fail — that list drives Step 6.

- [ ] **Step 6: Tune, one knob at a time, re-running the suite after each change.** Only these three knobs may move; nothing else in `params/c172.json` and nothing in `sim/`:
  - `aero.cd0` — moves cruise and top speed together. Higher = slower. Expected landing value **0.035** (cruise ≈ 123 kt TAS at 8000 ft, sea-level top speed ≈ 128 kt).
  - `propulsion.propPeakSpeedMs` — moves climb rate without touching cruise (it only bites below the peak speed, and cruise is above it). Higher = less climb. Expected landing value **60** (sea-level best climb ≈ 740 fpm, inside the tight 630–830 fpm band the suite asserts).
  - `aero.stallAlphaRad` / `flaps[].dCL0` — move the stall speeds. Expected landing values **0.2618** (CLmax 1.533, Vs1 ≈ 48.1 kt) and **0 / 0.3 / 0.6 / 0.9** (flap-30 CLmax 2.176, Vs0 ≈ 40.4 kt).

  If a knob has to leave the range its `sources` entry documents, update that entry in the same edit — a tuned number with a stale provenance string is worse than an untuned one.

- [ ] **Step 7: Run the envelope suite green** — `cd frontend && npm run test -- src/sim/envelope.test.ts`. Expected: 18 passed. The trim-search case is the slow one (~15 s of wall time for ~700k sim steps); if it exceeds vitest's 5 s default timeout, give that single `it()` a third argument of `20000` rather than shortening the flight.

- [ ] **Step 8: Record the tuning outcome** — append to `docs/decisions.md`:

```markdown
## 2026-08-05 — B-008 · C172S tuning knobs and how the envelope is defended

`frontend/src/sim/envelope.test.ts` is the contract for the flight model: 75% power at
8000 ft cruises at 122 kt TAS ±5, Vs1 48 KCAS ±3, Vs0 40 KCAS ±3, sea-level top speed near
the POH's 126 kt Vh, sea-level climb near 730 fpm, and a service ceiling where climb has
almost but not quite died. Speeds are found by bisection on the force balance and by a trim
search through the real integrator, so the test proves the model produces the number rather
than that someone typed it twice.

Three knobs carry the tuning and are marked TUNING KNOB in `params/c172.json` `sources`:
`aero.cd0` (cruise/top speed), `propulsion.propPeakSpeedMs` (climb, without disturbing
cruise), and `aero.stallAlphaRad` + `flaps[].dCL0` (stall speeds).

Two model additions came out of writing the suite:
- **Piston power lapses with density altitude** (Gagg-Ferrar, `pistonPowerLapse`). Without
  it the aircraft climbs at 780 fpm at its published ceiling. A consequence worth knowing:
  "75% power at 8000 ft" means 75% of *rated* power, which at 8000 ft needs ~99% throttle —
  the suite asserts that it is still achievable, as the POH implies.
- **Vne is warn-only, not clamped.** The parent spec says limits are "clamps + HUD
  warnings"; for g that means an actual force clamp, but clamping airspeed would mean an
  invisible hand holding the aircraft back in a dive. Vne is enforced as a HUD warning
  (`hud/format.ts`), and the suite asserts level flight at full power cannot reach it, so
  the only way past Vne is a deliberate dive.
```

- [ ] **Step 9: Full suite + typecheck + commit** — `cd frontend && npm run test && npm run typecheck`. Expected: 137 tests passed (118 + envelope 18 + the new thrust-lapse case), typecheck clean. Then:

```bash
git add frontend/src/sim frontend/src/params docs/decisions.md && git commit -m "test(sim): C172S envelope suite (cruise/stall/climb/ceiling/g) + density-altitude power lapse"
```

---

### Task 4: Input — keyboard capture and the control vector

**Files:**
- Create: `frontend/src/input/keyboard.ts`, `frontend/src/input/controls.ts`
- Test: `frontend/src/input/keyboard.test.ts`, `frontend/src/input/controls.test.ts`
- Modify: `docs/decisions.md` (append B-009)

**Interfaces:**
- Consumes: `ControlVector`, `ClassParams` from `sim/types.ts`.
- Produces:
  - `input/keyboard.ts`: `GAME_KEY_CODES: ReadonlySet<string>`, `type KeyboardTarget = { addEventListener(type: string, fn: (e: any) => void): void; removeEventListener(type: string, fn: (e: any) => void): void }`, `createKeyboard(target: KeyboardTarget): { held: Set<string>; dispose(): void }`.
  - `input/controls.ts`: `KEYMAP` (a readonly record documenting every bound key), `createControlSampler(params: ClassParams, initial?: ControlVector): { sample(held: ReadonlySet<string>, dtS: number): ControlVector; reset(): void }` — `initial` defaults to a cold start (centred, idle, flaps up, neutral trim) and is how the spawn hands over a trimmed, powered aircraft.

**Keymap** (parent spec §8, keyboard-only this phase — see B-009):

| `KeyboardEvent.code` | Action |
|---|---|
| `ArrowUp` / `ArrowDown` | pitch down / pitch up (stick forward / back) |
| `ArrowLeft` / `ArrowRight` | roll left / roll right |
| `KeyA` / `KeyD` | rudder left / right |
| `KeyW` / `KeyS`, `Equal` / `Minus` | throttle up / down |
| `KeyF` / `KeyV` | flaps down one detent / up one detent (edge-triggered) |
| `KeyG` | gear (inert on the C172 — HUD reads `GEAR FIXED`) |
| `Comma` / `Period` | trim nose down / nose up |
| `Escape` | pause (handled by the flight loop, NOT swallowed here) |

- [ ] **Step 1: Write failing keyboard tests** (a fake target — no jsdom available, and none is being added)

```ts
// frontend/src/input/keyboard.test.ts
import { describe, it, expect } from "vitest";
import { createKeyboard, GAME_KEY_CODES } from "./keyboard";

type Handler = (e: unknown) => void;

/** Minimal stand-in for `window`: records listeners so tests can fire events by hand. */
function fakeTarget() {
  const listeners = new Map<string, Set<Handler>>();
  return {
    addEventListener(type: string, fn: Handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Handler) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string, event: unknown) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

const keyEvent = (code: string) => {
  let prevented = false;
  return {
    code,
    preventDefault() { prevented = true; },
    get defaultPrevented() { return prevented; },
  };
};

describe("createKeyboard", () => {
  it("tracks a held key from keydown to keyup", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    t.fire("keydown", keyEvent("KeyW"));
    expect(kb.held.has("KeyW")).toBe(true);
    t.fire("keyup", keyEvent("KeyW"));
    expect(kb.held.has("KeyW")).toBe(false);
    kb.dispose();
  });
  it("holds several keys at once", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    t.fire("keydown", keyEvent("ArrowLeft"));
    t.fire("keydown", keyEvent("ArrowUp"));
    t.fire("keydown", keyEvent("KeyW"));
    expect([...kb.held].sort()).toEqual(["ArrowLeft", "ArrowUp", "KeyW"]);
    kb.dispose();
  });
  it("preventDefault's game keys so arrows do not scroll the page", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    const e = keyEvent("ArrowDown");
    t.fire("keydown", e);
    expect(e.defaultPrevented).toBe(true);
    kb.dispose();
  });
  it("leaves non-game keys alone, including Escape and browser shortcuts", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    for (const code of ["Escape", "F5", "KeyR", "Tab"]) {
      const e = keyEvent(code);
      t.fire("keydown", e);
      expect(e.defaultPrevented).toBe(false);
    }
    kb.dispose();
  });
  it("clears every held key on blur (no stuck throttle when you alt-tab away)", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    t.fire("keydown", keyEvent("KeyW"));
    t.fire("keydown", keyEvent("ArrowUp"));
    t.fire("blur", {});
    expect(kb.held.size).toBe(0);
    kb.dispose();
  });
  it("ignores an autorepeat keydown for an already-held key", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    t.fire("keydown", keyEvent("KeyF"));
    t.fire("keydown", keyEvent("KeyF"));
    expect(kb.held.size).toBe(1);
    kb.dispose();
  });
  it("dispose removes every listener and stops tracking", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    expect(t.count("keydown")).toBe(1);
    kb.dispose();
    expect(t.count("keydown")).toBe(0);
    expect(t.count("keyup")).toBe(0);
    expect(t.count("blur")).toBe(0);
    t.fire("keydown", keyEvent("KeyW"));
    expect(kb.held.size).toBe(0);
  });
  it("Escape is deliberately NOT a game key (the flight loop owns pause)", () => {
    expect(GAME_KEY_CODES.has("Escape")).toBe(false);
    expect(GAME_KEY_CODES.has("ArrowUp")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `cd frontend && npm run test -- src/input/keyboard.test.ts`. Expected: "Failed to load url ./keyboard".

- [ ] **Step 3: Implement the keyboard capture**

```ts
// frontend/src/input/keyboard.ts
/*
 * Window-level key capture: a Set of held key codes, nothing more. Sampling that Set into
 * a control vector is controls.ts's job, so this file has no idea what a throttle is.
 *
 * `code` (physical key) not `key` (character) so the bindings survive a non-US layout.
 * Escape is deliberately absent from GAME_KEY_CODES: it cannot be preventDefault'ed out of
 * exiting pointer lock anyway, and the flight loop wants it as the pause key (spec §6).
 */
export const GAME_KEY_CODES: ReadonlySet<string> = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "KeyW", "KeyS", "KeyA", "KeyD",
  "Equal", "Minus", "NumpadAdd", "NumpadSubtract",
  "KeyF", "KeyV", "KeyG",
  "Comma", "Period",
]);

export type KeyboardTarget = {
  addEventListener(type: string, fn: (e: any) => void): void;
  removeEventListener(type: string, fn: (e: any) => void): void;
};

export function createKeyboard(target: KeyboardTarget): { held: Set<string>; dispose(): void } {
  const held = new Set<string>();

  const onKeyDown = (e: { code: string; preventDefault(): void }) => {
    if (GAME_KEY_CODES.has(e.code)) {
      e.preventDefault(); // arrows must not scroll the page out from under the sim
      held.add(e.code);
    }
  };
  const onKeyUp = (e: { code: string }) => {
    held.delete(e.code);
  };
  // Losing focus mid-throttle would otherwise leave the key "held" forever.
  const onBlur = () => held.clear();

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);

  return {
    held,
    dispose() {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", onBlur);
      held.clear();
    },
  };
}
```

- [ ] **Step 4: Run to see it pass** — `cd frontend && npm run test -- src/input/keyboard.test.ts`. Expected: 8 passed.

- [ ] **Step 5: Write failing control-sampler tests**

```ts
// frontend/src/input/controls.test.ts
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
    expect(c).toEqual({ pitch: 0, roll: 0, yaw: 0, throttle: 0, flapDetent: 0, trim: 0 });
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
      pitch: 0, roll: 0, yaw: 0, throttle: 0.62, flapDetent: 2, trim: -0.4,
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
      pitch: 0, roll: 0, yaw: 0, throttle: 0, flapDetent: 0, trim: 0,
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
```

- [ ] **Step 6: Run to see it fail** — `cd frontend && npm run test -- src/input/controls.test.ts`. Expected: "Failed to load url ./controls".

- [ ] **Step 7: Implement the control sampler**

```ts
// frontend/src/input/controls.ts
/*
 * Held-key Set -> normalized ControlVector, sampled once per physics tick.
 *
 * Three different behaviours live here on purpose:
 *  - stick axes are SPRUNG: they ramp toward the commanded deflection while a key is held
 *    and self-centre when it is released, so a digital keyboard feels like an analogue
 *    stick instead of a bang-bang switch;
 *  - throttle and trim are LEVERS: they ramp while held and stay where they were left;
 *  - flaps are a DETENT SWITCH: edge-triggered, one detent per press, which is why the
 *    sampler keeps its own memory of the previous tick's keys.
 */
import type { ClassParams, ControlVector } from "../sim/types";

/** Documented for the README and the HUD help line; the sampler reads the codes directly. */
export const KEYMAP: Readonly<Record<string, string>> = {
  ArrowUp: "pitch down (stick forward)",
  ArrowDown: "pitch up (stick back)",
  ArrowLeft: "roll left",
  ArrowRight: "roll right",
  KeyA: "rudder left",
  KeyD: "rudder right",
  KeyW: "throttle up",
  KeyS: "throttle down",
  Equal: "throttle up",
  Minus: "throttle down",
  KeyF: "flaps down one detent",
  KeyV: "flaps up one detent",
  KeyG: "gear (fixed on this aircraft)",
  Comma: "trim nose down",
  Period: "trim nose up",
  Escape: "pause",
};

const STICK_RATE_PER_S = 2.5; // full deflection in 0.4 s
const STICK_CENTRE_PER_S = 4.0; // springs back faster than it deflects
const THROTTLE_RATE_PER_S = 0.5; // idle to full in 2 s
const TRIM_RATE_PER_S = 0.25; // full range in 8 s — trim is a slow, deliberate control

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** One sprung axis: ramp toward `target`, or spring back to zero when target is 0. */
function stepAxis(current: number, target: number, dtS: number): number {
  if (target === 0) {
    const decay = STICK_CENTRE_PER_S * dtS;
    if (Math.abs(current) <= decay) return 0;
    return current - Math.sign(current) * decay;
  }
  const next = current + Math.sign(target) * STICK_RATE_PER_S * dtS;
  return clamp(next, -1, 1);
}

/** Cold start: centred stick, idle, flaps up, neutral trim. */
const COLD: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle: 0, flapDetent: 0, trim: 0 };

/**
 * `initial` is how the takeover hands over a TRIMMED, POWERED aircraft: buildSpawnState
 * works out the throttle and trim that hold the snapshot's speed, and they have to be the
 * sampler's starting position or the player inherits an idle, untrimmed aeroplane and the
 * handoff card's promise is a lie.
 */
export function createControlSampler(params: ClassParams, initial: ControlVector = COLD): {
  sample(held: ReadonlySet<string>, dtS: number): ControlVector;
  reset(): void;
} {
  let pitch = initial.pitch;
  let roll = initial.roll;
  let yaw = initial.yaw;
  let throttle = initial.throttle;
  let trim = initial.trim;
  let flapDetent = initial.flapDetent;
  let prevFlapDown = false;
  let prevFlapUp = false;

  return {
    sample(held, dtS) {
      const axis = (neg: string, pos: string) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);

      // ArrowDown = stick back = nose up, so ArrowDown is the positive direction.
      pitch = stepAxis(pitch, axis("ArrowUp", "ArrowDown"), dtS);
      roll = stepAxis(roll, axis("ArrowLeft", "ArrowRight"), dtS);
      yaw = stepAxis(yaw, axis("KeyA", "KeyD"), dtS);

      const throttleDir =
        (held.has("KeyW") || held.has("Equal") || held.has("NumpadAdd") ? 1 : 0) -
        (held.has("KeyS") || held.has("Minus") || held.has("NumpadSubtract") ? 1 : 0);
      throttle = clamp(throttle + throttleDir * THROTTLE_RATE_PER_S * dtS, 0, 1);

      const trimDir = (held.has("Period") ? 1 : 0) - (held.has("Comma") ? 1 : 0);
      trim = clamp(trim + trimDir * TRIM_RATE_PER_S * dtS, -1, 1);

      // Edge-triggered: one detent per press, however long the key is held.
      const flapDown = held.has("KeyF");
      const flapUp = held.has("KeyV");
      if (flapDown && !prevFlapDown) flapDetent = Math.min(params.flaps.length - 1, flapDetent + 1);
      if (flapUp && !prevFlapUp) flapDetent = Math.max(0, flapDetent - 1);
      prevFlapDown = flapDown;
      prevFlapUp = flapUp;

      return { pitch, roll, yaw, throttle, flapDetent, trim };
    },
    reset() {
      pitch = initial.pitch; roll = initial.roll; yaw = initial.yaw;
      throttle = initial.throttle; trim = initial.trim; flapDetent = initial.flapDetent;
      prevFlapDown = false; prevFlapUp = false;
    },
  };
}
```

- [ ] **Step 8: Run to see it pass** — `cd frontend && npm run test -- src/input/controls.test.ts`. Expected: 22 passed.

- [ ] **Step 9: Log the input-scope decision** — append to `docs/decisions.md`:

```markdown
## 2026-08-05 — B-009 · Keyboard-only stick this phase; mouse stick deferred

Parent spec §8 lists a mouse stick (hold-LMB or pointer-lock) alongside the arrow keys.
Phase B ships keyboard only. Two reasons: the Phase B spec's own acceptance (§9) says "fly
the C172 by keyboard"; and pointer lock collides head-on with the Esc-is-pause decision
(spec §6) — Esc always exits pointer lock, and Chrome rate-limits re-locking, so a
mouse-stick build would either fight the pause key or need a second re-entry gesture. The
`ControlVector` interface is unchanged and mouse/touch/tilt still implement it later.

Two keys are Phase B additions to the §8 table, both recorded in `input/controls.ts`
`KEYMAP` and the README: `Comma`/`Period` for nose-down/nose-up elevator trim (spec §5
requires two trim keys but does not name them), and `Escape` reassigned from "quit to
browse" to "pause overlay" per spec §6 — QUIT is a button inside that overlay.
```

- [ ] **Step 10: Full suite + typecheck + commit** — `cd frontend && npm run test && npm run typecheck`. Expected: 167 tests passed (137 + keyboard 8 + controls 22), typecheck clean. Then:

```bash
git add frontend/src/input docs/decisions.md && git commit -m "feat(input): keyboard capture and normalized control vector with ramps, detents and trim"
```

---

### Task 5: Takeover — GA-type allowlist, eligibility gate, spawn state

**Files:**
- Create: `frontend/src/params/ga-types.json`, `frontend/src/takeover/eligibility.ts`, `frontend/src/takeover/spawn.ts`
- Test: `frontend/src/takeover/eligibility.test.ts`, `frontend/src/takeover/spawn.test.ts`

**Interfaces:**
- Consumes: `Contact` from `data/types.ts`; `ClassParams`, `ControlVector`, `SimState` from `sim/types.ts`; `stallSpeedIasMs`, `dragCoefficient`, `liftCoefficient`, `pistonPowerLapse` from `sim/forces.ts`; `tasToIas`, `iasToTas`, `isaDensity` from `sim/isa.ts`; `geodeticToEcef`, `geodeticSurfaceNormal` from `sim/geo.ts`; `quatFromHpr`, `qRotate` from `sim/quat.ts`; `vDot` from `sim/vec3.ts`; `ktToMs`, `ftToM`, `fpmToMs`, `degToRad`, `msToKt`, `mToFt` from `sim/units.ts`.
- Produces:
  - `takeover/eligibility.ts`: `GA_TYPE_DESIGNATORS: ReadonlySet<string>`, `MAX_SEEN_POS_S = 15`, `type EligibilityResult = { eligible: true } | { eligible: false; reason: string }`, `checkEligibility(contact: Contact | null | undefined): EligibilityResult`.
  - `takeover/spawn.ts`: `type SpawnAdjustment = { field: string; from: string; to: string; reason: string }`, `type SpawnResult = { state: SimState; controls: ControlVector; adjustments: SpawnAdjustment[]; altitudeSource: "alt_geom" | "alt_baro" }`, `buildSpawnState(contact: Contact, params: ClassParams, opts: { terrainHeightM: number | null }): SpawnResult`.

- [ ] **Step 1: Write `params/ga-types.json`** — the takeover gate is a data file, not code branches (spec §4). ICAO type designators for piston singles and light piston twins in common ADS-B traffic.

```json
{
  "note": "ICAO type designators treated as GA-piston for the Phase B takeover gate. Data, not code: adding a type here is the only thing needed to make it flyable. Every one of these is flown with the C172S parameter set this phase, which the handoff card discloses.",
  "designators": [
    "AA1", "AA5", "AC11", "AT3", "BE19", "BE23", "BE24", "BE33", "BE35", "BE36",
    "BE50", "BE55", "BE58", "BE60", "BE76", "BE95", "C150", "C152", "C162", "C170",
    "C172", "C175", "C177", "C180", "C182", "C185", "C188", "C195", "C205", "C206",
    "C207", "C210", "C310", "C337", "COL4", "CH60", "CH7A", "DA20", "DA40", "DA42",
    "DR40", "DV20", "F260", "GLAS", "GY80", "LNC2", "LNC4", "M20P", "M20T", "MO20",
    "P28A", "P28B", "P28R", "P28T", "P32R", "P32T", "PA11", "PA18", "PA22", "PA23",
    "PA24", "PA25", "PA27", "PA28", "PA30", "PA31", "PA32", "PA34", "PA38", "PA44",
    "PAY1", "RV4", "RV6", "RV7", "RV8", "RV9", "RV10", "RV14", "S208", "SR20",
    "SR22", "TB10", "TB20", "TB21", "TOBA", "VELO"
  ]
}
```

- [ ] **Step 2: Write failing eligibility tests**

```ts
// frontend/src/takeover/eligibility.test.ts
import { describe, it, expect } from "vitest";
import { checkEligibility, GA_TYPE_DESIGNATORS, MAX_SEEN_POS_S } from "./eligibility";
import type { Contact } from "../data/types";

const ga = (overrides: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.7, lon: -88.0,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2,
  ...overrides,
});

describe("checkEligibility — the happy path", () => {
  it("accepts a fresh, airborne, civil GA contact", () => {
    expect(checkEligibility(ga())).toEqual({ eligible: true });
  });
  it("accepts every designator in the allowlist", () => {
    // Assert the list is populated FIRST — iterating an empty set would otherwise make
    // this test pass with zero assertions.
    expect(GA_TYPE_DESIGNATORS.size).toBeGreaterThan(50);
    for (const t of GA_TYPE_DESIGNATORS) {
      expect(checkEligibility(ga({ t })).eligible).toBe(true);
    }
  });
  it("accepts a contact with only alt_baro (no alt_geom)", () => {
    expect(checkEligibility(ga({ alt_geom: null })).eligible).toBe(true);
  });
  it("accepts track 0 (due north is a real heading, not missing data)", () => {
    expect(checkEligibility(ga({ track: 0 })).eligible).toBe(true);
  });
  it("accepts gs 0 as a real value", () => {
    expect(checkEligibility(ga({ gs: 0 })).eligible).toBe(true);
  });
});

describe("checkEligibility — each gate names itself", () => {
  const cases: Array<[string, Partial<Contact> | null, RegExp]> = [
    ["nothing selected", null, /NO CONTACT SELECTED/],
    ["no type in the feed", { t: null }, /NO TYPE IN FEED/],
    ["not a GA piston type", { t: "B738" }, /NOT GA PISTON/],
    ["military", { military: true }, /MILITARY/],
    ["on the ground", { alt_baro: "ground" }, /ON GROUND/],
    ["stale position", { seen_pos: 40 }, /POSITION STALE/],
    ["missing seen_pos", { seen_pos: null }, /POSITION STALE/],
    ["no altitude at all", { alt_geom: null, alt_baro: null }, /NO ALTITUDE/],
    ["no ground speed", { gs: null }, /NO GROUND SPEED/],
    ["no track", { track: null }, /NO TRACK/],
  ];
  for (const [name, overrides, pattern] of cases) {
    it(`rejects: ${name}`, () => {
      const result = checkEligibility(overrides === null ? null : ga(overrides));
      expect(result.eligible).toBe(false);
      if (!result.eligible) expect(result.reason).toMatch(pattern);
    });
  }
  it("names the offending type in the reason so the tooltip is useful", () => {
    const r = checkEligibility(ga({ t: "B738" }));
    if (!r.eligible) expect(r.reason).toContain("B738");
  });
  it("names the age in the stale reason", () => {
    const r = checkEligibility(ga({ seen_pos: 40 }));
    if (!r.eligible) expect(r.reason).toContain("40");
  });
});

describe("the freshness threshold", () => {
  it("is 15 s", () => {
    expect(MAX_SEEN_POS_S).toBe(15);
  });
  it("accepts exactly 15 s and rejects just past it", () => {
    expect(checkEligibility(ga({ seen_pos: 15 })).eligible).toBe(true);
    expect(checkEligibility(ga({ seen_pos: 15.1 })).eligible).toBe(false);
  });
});
```

- [ ] **Step 3: Run to see it fail** — `cd frontend && npm run test -- src/takeover/eligibility.test.ts`. Expected: "Failed to load url ./eligibility".

- [ ] **Step 4: Implement the eligibility gate**

```ts
// frontend/src/takeover/eligibility.ts
/*
 * The takeover gate (spec §4). Pure, shared by the TAKE CONTROLS button's disabled state
 * and by its tooltip — the SAME predicate produces the reason string, so the button can
 * never be disabled for a reason the UI cannot name.
 *
 * Owner decision B-3: GA-class contacts only this phase. The allowlist is a data file, so
 * widening the gate is a JSON edit, not a code change.
 */
import type { Contact } from "../data/types";
import gaTypes from "../params/ga-types.json";

export const GA_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(gaTypes.designators);

/** readsb `seen_pos` can run to ~50 s; spawning on a 50-second-old position is a lie. */
export const MAX_SEEN_POS_S = 15;

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string };

export function checkEligibility(contact: Contact | null | undefined): EligibilityResult {
  if (!contact) return { eligible: false, reason: "NO CONTACT SELECTED" };

  if (contact.t === null) return { eligible: false, reason: "NO TYPE IN FEED" };
  if (!GA_TYPE_DESIGNATORS.has(contact.t)) {
    return { eligible: false, reason: `TYPE ${contact.t} NOT GA PISTON` };
  }
  if (contact.military) return { eligible: false, reason: "MILITARY CONTACT" };
  if (contact.alt_baro === "ground") return { eligible: false, reason: "ON GROUND" };
  if (contact.seen_pos === null || contact.seen_pos > MAX_SEEN_POS_S) {
    const age = contact.seen_pos === null ? "—" : String(contact.seen_pos);
    return { eligible: false, reason: `POSITION STALE (${age}S)` };
  }
  if (contact.alt_geom === null && contact.alt_baro === null) {
    return { eligible: false, reason: "NO ALTITUDE" };
  }
  if (contact.gs === null) return { eligible: false, reason: "NO GROUND SPEED" };
  if (contact.track === null) return { eligible: false, reason: "NO TRACK" };

  return { eligible: true };
}
```

- [ ] **Step 5: Run to see it pass** — `cd frontend && npm run test -- src/takeover/eligibility.test.ts`. Expected: 19 passed.

- [ ] **Step 6: Write failing spawn tests**

```ts
// frontend/src/takeover/spawn.test.ts
import { describe, it, expect } from "vitest";
import { buildSpawnState } from "./spawn";
import { loadC172 } from "../sim/params";
import { stallSpeedIasMs } from "../sim/forces";
import { ecefToGeodetic } from "../sim/geo";
import { hprFromQuat } from "../sim/quat";
import { ftToM, msToKt, mToFt, radToDeg } from "../sim/units";
import { tasToIas } from "../sim/isa";
import { vLength } from "../sim/vec3";
import type { Contact } from "../data/types";

const P = loadC172();

const ga = (overrides: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.6944, lon: -88.0399,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2,
  ...overrides,
});

describe("buildSpawnState — units and datum", () => {
  it("puts the aircraft at the contact's lat/lon", () => {
    const { state } = buildSpawnState(ga(), P, { terrainHeightM: 20 });
    const g = ecefToGeodetic(state.position);
    expect(radToDeg(g.latRad)).toBeCloseTo(30.6944, 5);
    expect(radToDeg(g.lonRad)).toBeCloseTo(-88.0399, 5);
  });
  it("prefers alt_geom (ellipsoidal — same datum as the terrain)", () => {
    const r = buildSpawnState(ga({ alt_geom: 3500, alt_baro: 3400 }), P, { terrainHeightM: 20 });
    expect(r.altitudeSource).toBe("alt_geom");
    expect(mToFt(r.state.altitudeM)).toBeCloseTo(3500, 1);
  });
  it("converts knots to m/s", () => {
    const { state } = buildSpawnState(ga({ gs: 105 }), P, { terrainHeightM: 20 });
    expect(msToKt(state.tasMs)).toBeCloseTo(105, 1);
    expect(msToKt(vLength(state.velocity))).toBeCloseTo(105, 1);
  });
  it("converts track to heading", () => {
    const { state } = buildSpawnState(ga({ track: 270 }), P, { terrainHeightM: 20 });
    const hpr = hprFromQuat(state.attitude, state.position);
    const heading = (radToDeg(hpr.headingRad) + 360) % 360;
    expect(heading).toBeCloseTo(270, 1);
  });
  it("converts baro_rate (fpm) to a vertical speed and a nose-up attitude", () => {
    const { state } = buildSpawnState(ga({ baro_rate: 500 }), P, { terrainHeightM: 20 });
    expect(state.verticalSpeedMs).toBeGreaterThan(2);
    expect(hprFromQuat(state.attitude, state.position).pitchRad).toBeGreaterThan(0);
  });
  it("treats a missing baro_rate as level, not as a dive", () => {
    const { state } = buildSpawnState(ga({ baro_rate: null }), P, { terrainHeightM: 20 });
    expect(state.verticalSpeedMs).toBeCloseTo(0, 1);
  });
  it("spawns wings level with no rotation rates and zero sim time", () => {
    const { state } = buildSpawnState(ga(), P, { terrainHeightM: 20 });
    expect(radToDeg(hprFromQuat(state.attitude, state.position).rollRad)).toBeCloseTo(0, 6);
    expect(state.rates).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.timeS).toBe(0);
  });
  it("hands over a throttle that roughly holds the snapshot speed, not idle", () => {
    const { controls } = buildSpawnState(ga(), P, { terrainHeightM: 20 });
    expect(controls.throttle).toBeGreaterThan(0.2);
    expect(controls.throttle).toBeLessThanOrEqual(1);
    expect(controls.flapDetent).toBe(0);
  });
});

describe("buildSpawnState — the alt_baro fallback path", () => {
  it("uses alt_baro when alt_geom is missing and says so", () => {
    const r = buildSpawnState(ga({ alt_geom: null, alt_baro: 3400 }), P, { terrainHeightM: 20 });
    expect(r.altitudeSource).toBe("alt_baro");
    expect(r.adjustments.some((a) => /pressure altitude/i.test(a.reason))).toBe(true);
  });
  it("clamps a pressure altitude to at least terrain + 300 m and lists the adjustment", () => {
    const terrain = ftToM(3000);
    const r = buildSpawnState(ga({ alt_geom: null, alt_baro: 3100 }), P, { terrainHeightM: terrain });
    expect(r.state.altitudeM).toBeCloseTo(terrain + 300, 1);
    const adj = r.adjustments.find((a) => a.field === "ALTITUDE");
    expect(adj).toBeTruthy();
    expect(adj!.to).toContain("FT");
  });
  it("does not clamp a pressure altitude that is already clear of terrain", () => {
    const r = buildSpawnState(ga({ alt_geom: null, alt_baro: 8000 }), P, { terrainHeightM: 100 });
    expect(mToFt(r.state.altitudeM)).toBeCloseTo(8000, 1);
  });
  it("cannot clamp when terrain height is unknown, and says that too", () => {
    const r = buildSpawnState(ga({ alt_geom: null, alt_baro: 3100 }), P, { terrainHeightM: null });
    expect(mToFt(r.state.altitudeM)).toBeCloseTo(3100, 1);
    expect(r.adjustments.some((a) => /terrain height unknown/i.test(a.reason))).toBe(true);
  });
});

describe("buildSpawnState — envelope safety net", () => {
  it("raises a below-stall snapshot to 1.3 Vs and lists it", () => {
    const r = buildSpawnState(ga({ gs: 30 }), P, { terrainHeightM: 20 });
    const ias = tasToIas(r.state.tasMs, r.state.altitudeM);
    expect(ias).toBeGreaterThanOrEqual(1.3 * stallSpeedIasMs(P, 0) - 1e-6);
    const adj = r.adjustments.find((a) => a.field === "SPEED");
    expect(adj).toBeTruthy();
    expect(adj!.from).toContain("30");
    expect(adj!.reason).toMatch(/stall/i);
  });
  it("lowers an above-Vne snapshot to 0.9 Vne and lists it", () => {
    const r = buildSpawnState(ga({ gs: 260 }), P, { terrainHeightM: 20 });
    const ias = tasToIas(r.state.tasMs, r.state.altitudeM);
    expect(ias).toBeLessThanOrEqual(0.9 * P.limits.vneIasMs + 1e-6);
    expect(r.adjustments.find((a) => a.field === "SPEED")!.reason).toMatch(/vne/i);
  });
  it("clamps above-ceiling altitude and lists it", () => {
    const r = buildSpawnState(ga({ alt_geom: 20000 }), P, { terrainHeightM: 20 });
    expect(r.state.altitudeM).toBeLessThanOrEqual(P.limits.serviceCeilingM + 1e-6);
    expect(r.adjustments.find((a) => a.field === "ALTITUDE")!.reason).toMatch(/ceiling/i);
  });
  it("adjusts nothing for a snapshot already inside the envelope", () => {
    expect(buildSpawnState(ga(), P, { terrainHeightM: 20 }).adjustments).toEqual([]);
  });
  it("every adjustment carries a from, a to and a reason (the card prints them verbatim)", () => {
    const r = buildSpawnState(ga({ gs: 30, alt_geom: 20000 }), P, { terrainHeightM: 20 });
    expect(r.adjustments.length).toBeGreaterThanOrEqual(2);
    for (const a of r.adjustments) {
      expect(a.field.length).toBeGreaterThan(0);
      expect(a.from.length).toBeGreaterThan(0);
      expect(a.to.length).toBeGreaterThan(0);
      expect(a.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("buildSpawnState — purity", () => {
  it("does not mutate the contact it was handed", () => {
    const c = ga({ gs: 30 });
    const before = JSON.stringify(c);
    buildSpawnState(c, P, { terrainHeightM: 20 });
    expect(JSON.stringify(c)).toBe(before);
  });
  it("is deterministic", () => {
    const a = buildSpawnState(ga(), P, { terrainHeightM: 20 });
    const b = buildSpawnState(ga(), P, { terrainHeightM: 20 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
```

- [ ] **Step 7: Run to see it fail** — `cd frontend && npm run test -- src/takeover/spawn.test.ts`. Expected: "Failed to load url ./spawn".

- [ ] **Step 8: Implement `buildSpawnState`**

```ts
// frontend/src/takeover/spawn.ts
/*
 * Feed snapshot -> initial sim state. Pure: no Cesium, no clock, no store.
 *
 * Honesty rule for this file (spec §4): clamping a synthetic aircraft into its own flight
 * envelope is legal, doing it silently is not. Every value this function changes goes into
 * `adjustments[]` with the before, the after and the reason, and the handoff card prints
 * that list verbatim.
 */
import type { Contact } from "../data/types";
import type { ClassParams, ControlVector, SimState } from "../sim/types";
import { dragCoefficient, liftCoefficient, pistonPowerLapse, stallSpeedIasMs } from "../sim/forces";
import { iasToTas, isaDensity, tasToIas } from "../sim/isa";
import { geodeticSurfaceNormal, geodeticToEcef } from "../sim/geo";
import { qRotate, quatFromHpr } from "../sim/quat";
import { degToRad, fpmToMs, ftToM, ktToMs, msToKt, mToFt } from "../sim/units";
import { vDot } from "../sim/vec3";

const G0 = 9.80665;
/** Minimum clearance when a pressure altitude has to be clamped onto real terrain. */
const BARO_CLEARANCE_M = 300;

export type SpawnAdjustment = { field: string; from: string; to: string; reason: string };

export type SpawnResult = {
  state: SimState;
  /** The control positions the player inherits — trimmed and powered for the snapshot. */
  controls: ControlVector;
  adjustments: SpawnAdjustment[];
  altitudeSource: "alt_geom" | "alt_baro";
};

export function buildSpawnState(
  contact: Contact,
  params: ClassParams,
  opts: { terrainHeightM: number | null },
): SpawnResult {
  const adjustments: SpawnAdjustment[] = [];

  // ---- altitude: alt_geom is ellipsoidal, the same datum as the terrain (G-003) ----
  const altGeomM = contact.alt_geom === null ? null : ftToM(contact.alt_geom);
  const altBaroFt = typeof contact.alt_baro === "number" ? contact.alt_baro : null;
  const altitudeSource: "alt_geom" | "alt_baro" = altGeomM !== null ? "alt_geom" : "alt_baro";
  let altitudeM = altGeomM ?? (altBaroFt === null ? 0 : ftToM(altBaroFt));

  if (altitudeSource === "alt_baro") {
    if (opts.terrainHeightM === null) {
      adjustments.push({
        field: "ALTITUDE",
        from: `${Math.round(mToFt(altitudeM))} FT PRESSURE`,
        to: `${Math.round(mToFt(altitudeM))} FT ASSUMED`,
        reason: "No alt_geom in the feed and terrain height unknown — pressure altitude used as-is.",
      });
    } else {
      const floor = opts.terrainHeightM + BARO_CLEARANCE_M;
      if (altitudeM < floor) {
        adjustments.push({
          field: "ALTITUDE",
          from: `${Math.round(mToFt(altitudeM))} FT PRESSURE`,
          to: `${Math.round(mToFt(floor))} FT`,
          reason: `Feed had only pressure altitude; raised to terrain + ${BARO_CLEARANCE_M} m so the spawn is not underground.`,
        });
        altitudeM = floor;
      } else {
        adjustments.push({
          field: "ALTITUDE",
          from: `${Math.round(mToFt(altitudeM))} FT PRESSURE`,
          to: `${Math.round(mToFt(altitudeM))} FT`,
          reason: "No alt_geom in the feed — pressure altitude used, already clear of terrain.",
        });
      }
    }
  }

  if (altitudeM > params.limits.serviceCeilingM) {
    adjustments.push({
      field: "ALTITUDE",
      from: `${Math.round(mToFt(altitudeM))} FT`,
      to: `${Math.round(mToFt(params.limits.serviceCeilingM))} FT`,
      reason: `Above the ${params.label} service ceiling.`,
    });
    altitudeM = params.limits.serviceCeilingM;
  }

  // ---- speed: ground speed approximates TAS (still air, v1 scope) ----
  const snapshotKt = contact.gs ?? 0;
  let tasMs = ktToMs(snapshotKt);
  const vsMin = 1.3 * stallSpeedIasMs(params, 0);
  const vneMax = 0.9 * params.limits.vneIasMs;
  const iasMs = tasToIas(tasMs, altitudeM);
  if (iasMs < vsMin) {
    tasMs = iasToTas(vsMin, altitudeM);
    adjustments.push({
      field: "SPEED",
      from: `${Math.round(snapshotKt)} KT`,
      to: `${Math.round(msToKt(tasMs))} KT`,
      reason: `Below 1.3 x stall speed for the ${params.label} — raised to avoid spawning stalled.`,
    });
  } else if (iasMs > vneMax) {
    tasMs = iasToTas(vneMax, altitudeM);
    adjustments.push({
      field: "SPEED",
      from: `${Math.round(snapshotKt)} KT`,
      to: `${Math.round(msToKt(tasMs))} KT`,
      reason: `Above 0.9 x Vne for the ${params.label} — lowered into the envelope.`,
    });
  }

  // ---- attitude: flight path from the vertical rate, body pitched by the trimmed AoA ----
  const latRad = degToRad(contact.lat);
  const lonRad = degToRad(contact.lon);
  const position = geodeticToEcef(latRad, lonRad, altitudeM);
  const headingRad = degToRad(contact.track ?? 0);
  const verticalSpeedMs = contact.baro_rate === null ? 0 : fpmToMs(contact.baro_rate);
  const fpaRad =
    tasMs > 0.1 ? Math.asin(Math.min(1, Math.max(-1, verticalSpeedMs / tasMs))) : 0;

  // AoA that makes lift equal weight at this speed and density — spawn trimmed, not lurching.
  const rho = isaDensity(altitudeM);
  const qBar = 0.5 * rho * tasMs * tasMs;
  const clNeeded = qBar > 0 ? (params.massKg * G0) / (qBar * params.wingAreaM2) : 0;
  const flap = params.flaps[0];
  const alphaTrimRad = Math.min(
    params.aero.stallAlphaRad,
    (clNeeded - (params.aero.cl0 + flap.dCL0)) / params.aero.clAlphaPerRad,
  );

  const flightPath = quatFromHpr(position, headingRad, fpaRad, 0);
  const attitude = quatFromHpr(position, headingRad, fpaRad + alphaTrimRad, 0);
  const velocity = qRotate(flightPath, { x: tasMs, y: 0, z: 0 });

  // ---- controls: the throttle that holds this speed, and the trim that holds this AoA ----
  const cl = liftCoefficient(alphaTrimRad, params, flap);
  const dragN = dragCoefficient(cl, params, flap) * qBar * params.wingAreaM2;
  const thrustCapacityN =
    (params.propulsion.propEfficiency * params.propulsion.maxPowerW * pistonPowerLapse(altitudeM)) /
    Math.max(tasMs, params.propulsion.propPeakSpeedMs);
  const throttle = thrustCapacityN > 0 ? Math.min(1, Math.max(0, dragN / thrustCapacityN)) : 0;
  const trim = Math.min(
    1,
    Math.max(
      -1,
      (alphaTrimRad - params.control.trimAlphaCenterRad) / params.control.trimAlphaRangeRad,
    ),
  );

  const state: SimState = {
    position,
    velocity,
    attitude,
    rates: { x: 0, y: 0, z: 0 },
    timeS: 0,
    altitudeM,
    tasMs,
    iasMs: tasToIas(tasMs, altitudeM),
    aoaRad: alphaTrimRad,
    sideslipRad: 0,
    verticalSpeedMs: vDot(velocity, geodeticSurfaceNormal(position)),
    loadFactor: 1,
    gLimited: false,
    stalled: false,
  };

  return {
    state,
    controls: { pitch: 0, roll: 0, yaw: 0, throttle, flapDetent: 0, trim },
    adjustments,
    altitudeSource,
  };
}
```

- [ ] **Step 9: Run to see it pass** — `cd frontend && npm run test -- src/takeover/spawn.test.ts`. Expected: 19 passed.

- [ ] **Step 10: Full suite + typecheck + commit** — `cd frontend && npm run test && npm run typecheck`. Expected: 205 tests passed (167 + eligibility 19 + spawn 19), typecheck clean. Then:

```bash
git add frontend/src/takeover frontend/src/params && git commit -m "feat(takeover): GA-type allowlist, eligibility gate with named reasons, disclosed spawn clamps"
```

---

### Task 6: Game state machine, end classification, stats, zustand session fields

**Files:**
- Create: `frontend/src/game/machine.ts`, `frontend/src/game/classify.ts`, `frontend/src/game/stats.ts`, `frontend/src/game/simRate.ts`
- Test: `frontend/src/game/machine.test.ts`, `frontend/src/game/classify.test.ts`, `frontend/src/game/stats.test.ts`, `frontend/src/game/simRate.test.ts`
- Modify: `frontend/src/state/store.ts` (lines 6–20 `State` type; add three fields and four actions after `select`), `frontend/src/state/store.test.ts` (add a session-state describe block), `docs/decisions.md` (append B-010)

**Interfaces:**
- Consumes: `Contact` from `data/types.ts`; `SimState`, `ClassParams` from `sim/types.ts`; `stallSpeedIasMs` from `sim/forces.ts`; `msToFpm`, `radToDeg` from `sim/units.ts`; `hprFromQuat` from `sim/quat.ts`; `vLength`, `vSub` from `sim/vec3.ts`. The store additions additionally consume `nextMode` and the `Mode`/`GameEvent` types from `game/machine.ts` (produced earlier in this same task).
- Produces:
  - `game/machine.ts`: `type Mode = "BROWSE" | "COUNTDOWN" | "FLYING" | "PAUSED" | "ENDED"`, `type GameEvent = "TAKE_CONTROLS" | "COUNTDOWN_DONE" | "COUNTDOWN_ABORT" | "PAUSE" | "RESUME" | "IMPACT" | "QUIT" | "EXIT_END"`, `nextMode(from: Mode, event: GameEvent): Mode` (returns `from` unchanged for an illegal event), `canFire(from: Mode, event: GameEvent): boolean`.
  - `game/classify.ts`: `type EndKind = "LANDED" | "CRASHED"`, `type ImpactReading = { sinkRateFpm: number; pitchDeg: number; bankDeg: number; iasMs: number; stallIasMs: number }`, `MAX_LANDING_SINK_FPM = 600`, `MAX_LANDING_BANK_DEG = 10`, `LANDING_PITCH_RANGE_DEG = [-5, 15]`, `LANDING_SPEED_FACTOR = 1.3`, `classifyEnd(r: ImpactReading): EndKind`, `readImpact(state: SimState, params: ClassParams, flapIndex: number): ImpactReading`.
  - `game/stats.ts`: `type FlightStats = { airtimeS: number; distanceM: number; maxIasMs: number; maxAltitudeM: number; maxG: number; impactSinkFpm: number; impactIasMs: number; classification: EndKind }`, `createStatsAccumulator(start: SimState): { update(state: SimState): void; finish(state: SimState, classification: EndKind): FlightStats }`.
  - `game/simRate.ts`: `createRateMeter(windowS?: number): { record(simSecondsAdvanced: number, wallSeconds: number): void; rate(): number }`.
  - `state/store.ts` additions: `mode: Mode`, `origin: { hex: string; snapshot: Contact } | null`, `endStats: FlightStats | null`, `fire(event: GameEvent): void` (**the only way mode ever changes** — it delegates to `nextMode`), `setOrigin(o: { hex: string; snapshot: Contact } | null): void`, `setEndStats(s: FlightStats | null): void`, `clearSession(): void` (payload only), `resetSession(): void` (hard reset to BROWSE). There is deliberately **no** `setMode`: exposing one would let a caller bypass `machine.ts` and the table would rot into decoration.

- [ ] **Step 1: Write failing state-machine tests**

```ts
// frontend/src/game/machine.test.ts
import { describe, it, expect } from "vitest";
import { nextMode, canFire } from "./machine";
import type { Mode, GameEvent } from "./machine";

describe("mode transitions", () => {
  const legal: Array<[Mode, GameEvent, Mode]> = [
    ["BROWSE", "TAKE_CONTROLS", "COUNTDOWN"],
    ["COUNTDOWN", "COUNTDOWN_DONE", "FLYING"],
    ["COUNTDOWN", "COUNTDOWN_ABORT", "BROWSE"],
    ["COUNTDOWN", "QUIT", "BROWSE"],
    ["FLYING", "PAUSE", "PAUSED"],
    ["PAUSED", "RESUME", "FLYING"],
    ["PAUSED", "QUIT", "BROWSE"],
    ["FLYING", "IMPACT", "ENDED"],
    ["FLYING", "QUIT", "BROWSE"],
    ["ENDED", "EXIT_END", "BROWSE"],
  ];
  for (const [from, event, to] of legal) {
    it(`${from} --${event}--> ${to}`, () => {
      expect(canFire(from, event)).toBe(true);
      expect(nextMode(from, event)).toBe(to);
    });
  }
});

describe("illegal transitions are refused, not thrown", () => {
  const illegal: Array<[Mode, GameEvent]> = [
    ["BROWSE", "PAUSE"],
    ["BROWSE", "IMPACT"],
    ["BROWSE", "RESUME"],
    ["FLYING", "TAKE_CONTROLS"],
    ["ENDED", "PAUSE"],
    ["ENDED", "IMPACT"],
    ["PAUSED", "IMPACT"],
    ["COUNTDOWN", "PAUSE"],
  ];
  for (const [from, event] of illegal) {
    it(`${from} ignores ${event}`, () => {
      expect(canFire(from, event)).toBe(false);
      expect(nextMode(from, event)).toBe(from);
    });
  }
});

describe("the arc always gets home", () => {
  it("every mode can reach BROWSE", () => {
    expect(nextMode("COUNTDOWN", "QUIT")).toBe("BROWSE");
    expect(nextMode("FLYING", "QUIT")).toBe("BROWSE");
    expect(nextMode("PAUSED", "QUIT")).toBe("BROWSE");
    expect(nextMode("ENDED", "EXIT_END")).toBe("BROWSE");
  });
  it("a paused session cannot be ended by an impact it is not simulating", () => {
    expect(nextMode("PAUSED", "IMPACT")).toBe("PAUSED");
  });
});
```

- [ ] **Step 2: Run to see it fail** — `cd frontend && npm run test -- src/game/machine.test.ts`. Expected: "Failed to load url ./machine".

- [ ] **Step 3: Implement the machine**

```ts
// frontend/src/game/machine.ts
/*
 * Session modes (spec §3, parent spec §5), as a table rather than a pile of ifs.
 *
 *   BROWSE --TAKE_CONTROLS--> COUNTDOWN --COUNTDOWN_DONE--> FLYING --IMPACT--> ENDED
 *      ^                          |  COUNTDOWN_ABORT / QUIT    | PAUSE ^ RESUME    |
 *      |                          v                            v      |           |
 *      +--------------------------+------------------------ PAUSED ---+  EXIT_END -+
 *
 * An illegal event returns the current mode unchanged instead of throwing: these events
 * come from user input and async callbacks that can race (a terrain impact resolving one
 * frame after QUIT), and a race should be a no-op, not a crash.
 */
export type Mode = "BROWSE" | "COUNTDOWN" | "FLYING" | "PAUSED" | "ENDED";

export type GameEvent =
  | "TAKE_CONTROLS"
  | "COUNTDOWN_DONE"
  | "COUNTDOWN_ABORT"
  | "PAUSE"
  | "RESUME"
  | "IMPACT"
  | "QUIT"
  | "EXIT_END";

const TABLE: Record<Mode, Partial<Record<GameEvent, Mode>>> = {
  BROWSE: { TAKE_CONTROLS: "COUNTDOWN" },
  COUNTDOWN: { COUNTDOWN_DONE: "FLYING", COUNTDOWN_ABORT: "BROWSE", QUIT: "BROWSE" },
  FLYING: { PAUSE: "PAUSED", IMPACT: "ENDED", QUIT: "BROWSE" },
  PAUSED: { RESUME: "FLYING", QUIT: "BROWSE" },
  ENDED: { EXIT_END: "BROWSE" },
};

export function canFire(from: Mode, event: GameEvent): boolean {
  return TABLE[from][event] !== undefined;
}

export function nextMode(from: Mode, event: GameEvent): Mode {
  return TABLE[from][event] ?? from;
}
```

- [ ] **Step 4: Run to see it pass** — `cd frontend && npm run test -- src/game/machine.test.ts`. Expected: 20 passed.

- [ ] **Step 5: Write failing classification tests, boundaries included**

```ts
// frontend/src/game/classify.test.ts
import { describe, it, expect } from "vitest";
import {
  classifyEnd, readImpact, MAX_LANDING_SINK_FPM, MAX_LANDING_BANK_DEG,
  LANDING_PITCH_RANGE_DEG, LANDING_SPEED_FACTOR,
} from "./classify";
import type { ImpactReading } from "./classify";
import { loadC172 } from "../sim/params";
import { stallSpeedIasMs } from "../sim/forces";
import { geodeticToEcef } from "../sim/geo";
import { quatFromHpr, qRotate } from "../sim/quat";
import { degToRad, ktToMs } from "../sim/units";
import type { SimState } from "../sim/types";

const P = loadC172();
const VS = stallSpeedIasMs(P, 0);

const reading = (o: Partial<ImpactReading> = {}): ImpactReading => ({
  sinkRateFpm: 200,
  pitchDeg: 2,
  bankDeg: 0,
  iasMs: VS * 1.1,
  stallIasMs: VS,
  ...o,
});

describe("classifyEnd — a good touchdown", () => {
  it("gentle, level and slow reads LANDED", () => {
    expect(classifyEnd(reading())).toBe("LANDED");
  });
  it("a nose-up flare still reads LANDED", () => {
    expect(classifyEnd(reading({ pitchDeg: 8 }))).toBe("LANDED");
  });
});

describe("classifyEnd — each gate on its own", () => {
  it("too much sink is CRASHED", () => {
    expect(classifyEnd(reading({ sinkRateFpm: 900 }))).toBe("CRASHED");
  });
  it("too much bank is CRASHED", () => {
    expect(classifyEnd(reading({ bankDeg: 35 }))).toBe("CRASHED");
    expect(classifyEnd(reading({ bankDeg: -35 }))).toBe("CRASHED");
  });
  it("nose-down into the ground is CRASHED", () => {
    expect(classifyEnd(reading({ pitchDeg: -20 }))).toBe("CRASHED");
  });
  it("an extreme nose-high arrival is CRASHED", () => {
    expect(classifyEnd(reading({ pitchDeg: 40 }))).toBe("CRASHED");
  });
  it("too fast is CRASHED", () => {
    expect(classifyEnd(reading({ iasMs: VS * 2 }))).toBe("CRASHED");
  });
});

describe("classifyEnd — the thresholds themselves", () => {
  it("pins every constant, so a silent tweak fails here and not in someone's flight", () => {
    expect(MAX_LANDING_SINK_FPM).toBe(600);
    expect(MAX_LANDING_BANK_DEG).toBe(10);
    expect(LANDING_PITCH_RANGE_DEG).toEqual([-5, 15]);
    expect(LANDING_SPEED_FACTOR).toBe(1.3);
  });
});

describe("classifyEnd — exact boundaries", () => {
  it("exactly 600 fpm of sink is CRASHED (the threshold is strictly less than)", () => {
    expect(classifyEnd(reading({ sinkRateFpm: MAX_LANDING_SINK_FPM }))).toBe("CRASHED");
    expect(classifyEnd(reading({ sinkRateFpm: MAX_LANDING_SINK_FPM - 0.001 }))).toBe("LANDED");
  });
  it("exactly 10 deg of bank is still LANDED", () => {
    expect(classifyEnd(reading({ bankDeg: MAX_LANDING_BANK_DEG }))).toBe("LANDED");
    expect(classifyEnd(reading({ bankDeg: MAX_LANDING_BANK_DEG + 0.001 }))).toBe("CRASHED");
  });
  it("exactly 1.3 Vs is CRASHED, a hair under is LANDED", () => {
    expect(classifyEnd(reading({ iasMs: VS * LANDING_SPEED_FACTOR }))).toBe("CRASHED");
    expect(classifyEnd(reading({ iasMs: VS * LANDING_SPEED_FACTOR - 0.001 }))).toBe("LANDED");
  });
  it("the pitch window ends are inclusive", () => {
    const [lo, hi] = LANDING_PITCH_RANGE_DEG;
    expect(classifyEnd(reading({ pitchDeg: lo }))).toBe("LANDED");
    expect(classifyEnd(reading({ pitchDeg: hi }))).toBe("LANDED");
    expect(classifyEnd(reading({ pitchDeg: lo - 0.001 }))).toBe("CRASHED");
    expect(classifyEnd(reading({ pitchDeg: hi + 0.001 }))).toBe("CRASHED");
  });
});

describe("classifyEnd — the stall speed is flap-dependent", () => {
  it("a speed that is too fast clean is fine with full flap", () => {
    const ias = stallSpeedIasMs(P, 3) * 1.25;
    expect(classifyEnd(reading({ iasMs: ias, stallIasMs: stallSpeedIasMs(P, 0) }))).toBe("CRASHED");
    expect(classifyEnd(reading({ iasMs: ias, stallIasMs: stallSpeedIasMs(P, 3) }))).toBe("LANDED");
  });
});

describe("readImpact", () => {
  function stateWith(pitchDeg: number, bankDeg: number, tasMs: number, sinkMs: number): SimState {
    const position = geodeticToEcef(degToRad(30.7), degToRad(-88), 300);
    const attitude = quatFromHpr(position, 0, degToRad(pitchDeg), degToRad(bankDeg));
    const flightPath = quatFromHpr(position, 0, -Math.asin(sinkMs / tasMs), 0);
    return {
      position,
      velocity: qRotate(flightPath, { x: tasMs, y: 0, z: 0 }),
      attitude,
      rates: { x: 0, y: 0, z: 0 },
      timeS: 10,
      altitudeM: 300, tasMs, iasMs: tasMs, aoaRad: 0, sideslipRad: 0,
      verticalSpeedMs: -sinkMs, loadFactor: 1, gLimited: false, stalled: false,
    };
  }
  it("reports sink rate as a positive fpm number when descending", () => {
    const r = readImpact(stateWith(2, 0, ktToMs(60), 2), P, 0);
    expect(r.sinkRateFpm).toBeGreaterThan(300);
    expect(r.sinkRateFpm).toBeLessThan(500);
  });
  it("reports pitch and bank in degrees", () => {
    const r = readImpact(stateWith(6, -12, ktToMs(60), 1), P, 0);
    expect(r.pitchDeg).toBeCloseTo(6, 3);
    expect(r.bankDeg).toBeCloseTo(-12, 3);
  });
  it("uses the stall speed for the flap setting actually selected", () => {
    expect(readImpact(stateWith(2, 0, ktToMs(60), 1), P, 3).stallIasMs)
      .toBeCloseTo(stallSpeedIasMs(P, 3), 9);
  });
  it("classifies a real gentle arrival as LANDED end to end", () => {
    expect(classifyEnd(readImpact(stateWith(4, 1, ktToMs(48), 1.5), P, 3))).toBe("LANDED");
  });
  it("classifies a real dive into terrain as CRASHED end to end", () => {
    expect(classifyEnd(readImpact(stateWith(-30, 40, ktToMs(140), 30), P, 0))).toBe("CRASHED");
  });
});
```

- [ ] **Step 6: Run to see it fail** — `cd frontend && npm run test -- src/game/classify.test.ts`. Expected: "Failed to load url ./classify".

- [ ] **Step 7: Implement classification**

```ts
// frontend/src/game/classify.ts
/*
 * Terrain contact always ends the session (parent spec §5); this decides whether it reads
 * LANDED or CRASHED. The spec fixes two of the four gates — sink under 600 fpm and speed
 * under 1.3 Vs — and says "near-level attitude" for the rest. This file makes that concrete
 * (see decisions.md B-010) and the boundaries are pinned by tests so nobody can drift them.
 */
import type { ClassParams, SimState } from "../sim/types";
import { stallSpeedIasMs } from "../sim/forces";
import { hprFromQuat } from "../sim/quat";
import { msToFpm, radToDeg } from "../sim/units";

export type EndKind = "LANDED" | "CRASHED";

export type ImpactReading = {
  /** Positive = descending. */
  sinkRateFpm: number;
  pitchDeg: number;
  bankDeg: number;
  iasMs: number;
  /** Stall speed for the flap setting that was actually selected. */
  stallIasMs: number;
};

export const MAX_LANDING_SINK_FPM = 600;
export const MAX_LANDING_BANK_DEG = 10;
/** Asymmetric on purpose: a nose-up flare is a landing, a nose-down arrival is not. */
export const LANDING_PITCH_RANGE_DEG: readonly [number, number] = [-5, 15];
export const LANDING_SPEED_FACTOR = 1.3;

export function classifyEnd(r: ImpactReading): EndKind {
  const [pitchLo, pitchHi] = LANDING_PITCH_RANGE_DEG;
  const gentle = r.sinkRateFpm < MAX_LANDING_SINK_FPM;
  const level = Math.abs(r.bankDeg) <= MAX_LANDING_BANK_DEG &&
    r.pitchDeg >= pitchLo && r.pitchDeg <= pitchHi;
  const slow = r.iasMs < LANDING_SPEED_FACTOR * r.stallIasMs;
  return gentle && level && slow ? "LANDED" : "CRASHED";
}

export function readImpact(
  state: SimState,
  params: ClassParams,
  flapIndex: number,
): ImpactReading {
  const hpr = hprFromQuat(state.attitude, state.position);
  return {
    sinkRateFpm: -msToFpm(state.verticalSpeedMs),
    pitchDeg: radToDeg(hpr.pitchRad),
    bankDeg: radToDeg(hpr.rollRad),
    iasMs: state.iasMs,
    stallIasMs: stallSpeedIasMs(params, flapIndex),
  };
}
```

- [ ] **Step 8: Run to see it pass** — `cd frontend && npm run test -- src/game/classify.test.ts`. Expected: 18 passed.

- [ ] **Step 9: Write failing stats and sim-rate tests**

```ts
// frontend/src/game/stats.test.ts
import { describe, it, expect } from "vitest";
import { createStatsAccumulator } from "./stats";
import { geodeticToEcef } from "../sim/geo";
import { quatFromHpr } from "../sim/quat";
import { degToRad, ktToMs, msToKt, mToFt } from "../sim/units";
import type { SimState } from "../sim/types";

function state(o: Partial<SimState> = {}): SimState {
  const position = o.position ?? geodeticToEcef(degToRad(30.7), degToRad(-88), 1000);
  return {
    position,
    velocity: { x: 0, y: 0, z: 0 },
    attitude: quatFromHpr(position, 0, 0, 0),
    rates: { x: 0, y: 0, z: 0 },
    timeS: 0,
    altitudeM: 1000, tasMs: ktToMs(100), iasMs: ktToMs(95), aoaRad: 0, sideslipRad: 0,
    verticalSpeedMs: 0, loadFactor: 1, gLimited: false, stalled: false,
    ...o,
  };
}

describe("stats accumulator", () => {
  it("airtime is the sim time elapsed since the spawn", () => {
    const acc = createStatsAccumulator(state({ timeS: 0 }));
    acc.update(state({ timeS: 42.5 }));
    expect(acc.finish(state({ timeS: 42.5 }), "LANDED").airtimeS).toBeCloseTo(42.5, 6);
  });
  it("distance accumulates along the path, not as the crow flies from the start", () => {
    const acc = createStatsAccumulator(state({ position: geodeticToEcef(degToRad(30.7), degToRad(-88), 1000) }));
    acc.update(state({ position: geodeticToEcef(degToRad(30.8), degToRad(-88), 1000) }));
    acc.update(state({ position: geodeticToEcef(degToRad(30.7), degToRad(-88), 1000) }));
    const s = acc.finish(state(), "CRASHED");
    expect(s.distanceM).toBeGreaterThan(20000); // ~11 km out and ~11 km back
  });
  it("tracks the maxima, not the last value", () => {
    const acc = createStatsAccumulator(state());
    acc.update(state({ iasMs: ktToMs(150), altitudeM: 4000, loadFactor: 3.1 }));
    acc.update(state({ iasMs: ktToMs(80), altitudeM: 900, loadFactor: 0.4 }));
    const s = acc.finish(state(), "CRASHED");
    expect(msToKt(s.maxIasMs)).toBeCloseTo(150, 3);
    expect(mToFt(s.maxAltitudeM)).toBeCloseTo(mToFt(4000), 3);
    expect(s.maxG).toBeCloseTo(3.1, 6);
  });
  it("records the impact sink rate as a positive fpm and the impact speed", () => {
    const acc = createStatsAccumulator(state());
    const s = acc.finish(state({ verticalSpeedMs: -4, iasMs: ktToMs(65) }), "CRASHED");
    expect(s.impactSinkFpm).toBeGreaterThan(700);
    expect(msToKt(s.impactIasMs)).toBeCloseTo(65, 3);
  });
  it("a climbing arrival reports a negative sink rather than lying about it", () => {
    const acc = createStatsAccumulator(state());
    expect(acc.finish(state({ verticalSpeedMs: 2 }), "CRASHED").impactSinkFpm).toBeLessThan(0);
  });
  it("carries the classification through", () => {
    const acc = createStatsAccumulator(state());
    expect(acc.finish(state(), "LANDED").classification).toBe("LANDED");
  });
  it("a session that ends immediately reports zeroes, not NaN", () => {
    const start = state();
    const s = createStatsAccumulator(start).finish(start, "CRASHED");
    expect(s.airtimeS).toBe(0);
    expect(s.distanceM).toBe(0);
    expect(Number.isFinite(s.maxG)).toBe(true);
  });
});
```

```ts
// frontend/src/game/simRate.test.ts
import { describe, it, expect } from "vitest";
import { createRateMeter } from "./simRate";

describe("sim rate meter", () => {
  it("reads 1.0 when the sim keeps up with the wall clock", () => {
    const m = createRateMeter(2);
    for (let i = 0; i < 120; i++) m.record(1 / 60, 1 / 60);
    expect(m.rate()).toBeCloseTo(1, 3);
  });
  it("reads about 0.5 when the sim runs at half speed", () => {
    const m = createRateMeter(2);
    for (let i = 0; i < 120; i++) m.record(1 / 60, 2 / 60);
    expect(m.rate()).toBeCloseTo(0.5, 3);
  });
  it("recovers once the sim catches up (the window rolls)", () => {
    const m = createRateMeter(1);
    for (let i = 0; i < 60; i++) m.record(1 / 60, 4 / 60);
    expect(m.rate()).toBeLessThan(0.4);
    for (let i = 0; i < 120; i++) m.record(1 / 60, 1 / 60);
    expect(m.rate()).toBeGreaterThan(0.9);
  });
  it("reads 1.0 before any samples rather than 0 (no false SIM RATE warning on frame one)", () => {
    expect(createRateMeter(2).rate()).toBe(1);
  });
  it("ignores a zero-length wall interval instead of dividing by zero", () => {
    const m = createRateMeter(2);
    m.record(1 / 60, 0);
    expect(Number.isFinite(m.rate())).toBe(true);
  });
});
```

- [ ] **Step 10: Run to see them fail** — `cd frontend && npm run test -- src/game/stats.test.ts src/game/simRate.test.ts`. Expected: both fail to import.

- [ ] **Step 11: Implement stats and the rate meter**

```ts
// frontend/src/game/stats.ts
/*
 * The numbers on the end card (parent spec §5). Accumulated live during the flight so the
 * card needs nothing but the final state.
 */
import type { SimState } from "../sim/types";
import type { EndKind } from "./classify";
import { msToFpm } from "../sim/units";
import { vLength, vSub } from "../sim/vec3";

export type FlightStats = {
  airtimeS: number;
  distanceM: number;
  maxIasMs: number;
  maxAltitudeM: number;
  maxG: number;
  /** Positive = descending at the moment of contact. */
  impactSinkFpm: number;
  impactIasMs: number;
  classification: EndKind;
};

export function createStatsAccumulator(start: SimState): {
  update(state: SimState): void;
  finish(state: SimState, classification: EndKind): FlightStats;
} {
  const startTimeS = start.timeS;
  let previousPosition = start.position;
  let distanceM = 0;
  let maxIasMs = start.iasMs;
  let maxAltitudeM = start.altitudeM;
  let maxG = start.loadFactor;

  function absorb(state: SimState) {
    // Path length, not displacement — a circuit that lands where it took off flew a distance.
    distanceM += vLength(vSub(state.position, previousPosition));
    previousPosition = state.position;
    if (state.iasMs > maxIasMs) maxIasMs = state.iasMs;
    if (state.altitudeM > maxAltitudeM) maxAltitudeM = state.altitudeM;
    if (state.loadFactor > maxG) maxG = state.loadFactor;
  }

  return {
    update(state) {
      absorb(state);
    },
    finish(state, classification) {
      absorb(state);
      return {
        airtimeS: state.timeS - startTimeS,
        distanceM,
        maxIasMs,
        maxAltitudeM,
        maxG,
        impactSinkFpm: -msToFpm(state.verticalSpeedMs),
        impactIasMs: state.iasMs,
        classification,
      };
    },
  };
}
```

```ts
// frontend/src/game/simRate.ts
/*
 * How much sim time we managed per second of wall time, over a rolling window. When the
 * accumulator clamps (a slow machine, a backgrounded tab), this is what turns the shortfall
 * into an honest "SIM RATE 0.7x" on the HUD instead of a silent slow-motion flight.
 */
export function createRateMeter(windowS = 2): {
  record(simSecondsAdvanced: number, wallSeconds: number): void;
  rate(): number;
} {
  const samples: Array<{ sim: number; wall: number }> = [];
  let simSum = 0;
  let wallSum = 0;

  return {
    record(simSecondsAdvanced, wallSeconds) {
      if (!Number.isFinite(wallSeconds) || wallSeconds <= 0) return;
      samples.push({ sim: simSecondsAdvanced, wall: wallSeconds });
      simSum += simSecondsAdvanced;
      wallSum += wallSeconds;
      while (wallSum > windowS && samples.length > 1) {
        const oldest = samples.shift()!;
        simSum -= oldest.sim;
        wallSum -= oldest.wall;
      }
    },
    rate() {
      if (wallSum <= 0) return 1; // nothing measured yet is not a slowdown
      return simSum / wallSum;
    },
  };
}
```

- [ ] **Step 12: Run to see them pass** — `cd frontend && npm run test -- src/game/stats.test.ts src/game/simRate.test.ts`. Expected: stats 7 passed, simRate 5 passed.

- [ ] **Step 13: Write failing store-session tests** — append to `frontend/src/state/store.test.ts`:

```ts
describe("session state", () => {
  it("starts in BROWSE with no origin and no stats", () => {
    useStore.getState().resetSession();
    const s = useStore.getState();
    expect(s.mode).toBe("BROWSE");
    expect(s.origin).toBeNull();
    expect(s.endStats).toBeNull();
  });
  it("holds the frozen origin snapshot independently of selectedHex", () => {
    const c = contact("abc123");
    useStore.getState().setOrigin({ hex: "abc123", snapshot: c });
    // the contact ages out of the feed and the selection is nulled...
    useStore.getState().applyFetch({ contacts: [], source: "t", fetched_at: 5 });
    expect(useStore.getState().selectedHex).toBeNull();
    // ...but the origin snapshot survives
    expect(useStore.getState().origin?.hex).toBe("abc123");
    expect(useStore.getState().origin?.snapshot.gs).toBe(120);
  });
  it("fire routes every transition through the machine", () => {
    useStore.getState().resetSession();
    useStore.getState().fire("TAKE_CONTROLS");
    expect(useStore.getState().mode).toBe("COUNTDOWN");
    useStore.getState().fire("COUNTDOWN_DONE");
    expect(useStore.getState().mode).toBe("FLYING");
    useStore.getState().fire("IMPACT");
    expect(useStore.getState().mode).toBe("ENDED");
    useStore.getState().fire("EXIT_END");
    expect(useStore.getState().mode).toBe("BROWSE");
  });
  it("an illegal event is a no-op, not a bogus mode (late impacts race QUIT)", () => {
    useStore.getState().resetSession();
    useStore.getState().fire("IMPACT");
    expect(useStore.getState().mode).toBe("BROWSE");
    useStore.getState().fire("TAKE_CONTROLS");
    useStore.getState().fire("COUNTDOWN_DONE");
    useStore.getState().fire("QUIT");
    useStore.getState().fire("IMPACT"); // arrives one frame too late
    expect(useStore.getState().mode).toBe("BROWSE");
  });
  it("resetSession clears mode, origin and stats together (QUIT leaves no residue)", () => {
    useStore.getState().fire("TAKE_CONTROLS");
    useStore.getState().fire("COUNTDOWN_DONE");
    useStore.getState().setOrigin({ hex: "abc123", snapshot: contact("abc123") });
    useStore.getState().setEndStats({
      airtimeS: 1, distanceM: 2, maxIasMs: 3, maxAltitudeM: 4, maxG: 5,
      impactSinkFpm: 6, impactIasMs: 7, classification: "CRASHED",
    });
    useStore.getState().resetSession();
    const s = useStore.getState();
    expect(s.mode).toBe("BROWSE");
    expect(s.origin).toBeNull();
    expect(s.endStats).toBeNull();
  });
  it("does not hold any sim state (60 Hz set() would re-render React)", () => {
    const keys = Object.keys(useStore.getState());
    expect(keys).not.toContain("simState");
    expect(keys).not.toContain("position");
    expect(keys).not.toContain("attitude");
  });
});
```

- [ ] **Step 14: Run to see it fail** — `cd frontend && npm run test -- src/state/store.test.ts`. Expected: `useStore.getState().resetSession is not a function`.

- [ ] **Step 15: Add the three session fields to the store** — edit `frontend/src/state/store.ts`. Extend the `State` type (currently lines 6–20) and add the actions after `select` (currently line 55):

```ts
// add to the imports at the top
import { nextMode } from "../game/machine";
import type { GameEvent, Mode } from "../game/machine";
import type { FlightStats } from "../game/stats";

// add to the State type
  /**
   * Session mode. The ONLY session state zustand holds, along with origin and endStats:
   * sim state lives in a mutable ref because a 60 Hz set() would re-render React.
   */
  mode: Mode;
  /**
   * The frozen snapshot the flight was built from. Deliberately separate from selectedHex,
   * which applyFetch nulls the moment the contact leaves the feed — the origin must survive
   * that, and must never be dead-reckoned forward.
   */
  origin: { hex: string; snapshot: Contact } | null;
  endStats: FlightStats | null;
  /**
   * The ONLY thing that changes `mode`. Every transition goes through game/machine.ts's
   * table, so an illegal event (a terrain impact resolving a frame after QUIT) is a no-op
   * instead of a bogus state. There is no setMode by design — it would let callers bypass
   * the machine and the table would quietly become documentation.
   */
  fire(event: GameEvent): void;
  setOrigin(o: { hex: string; snapshot: Contact } | null): void;
  setEndStats(s: FlightStats | null): void;
  /** Clears the session payload without touching the mode. */
  clearSession(): void;
  resetSession(): void;

// add to the initial state
  mode: "BROWSE",
  origin: null,
  endStats: null,

// add the actions after select()
  fire(event) {
    set({ mode: nextMode(get().mode, event) });
  },

  setOrigin(o) {
    set({ origin: o });
  },

  setEndStats(s) {
    set({ endStats: s });
  },

  clearSession() {
    set({ origin: null, endStats: null });
  },

  /** Hard reset: back to BROWSE with no residue (spec §6). */
  resetSession() {
    set({ mode: "BROWSE", origin: null, endStats: null });
  },
```

- [ ] **Step 16: Run to see it pass** — `cd frontend && npm run test -- src/state/store.test.ts`. Expected: 9 passed (3 Phase A + 6 new). Confirm the Phase A three still pass unchanged.

- [ ] **Step 17: Log the classification thresholds** — append to `docs/decisions.md`:

```markdown
## 2026-08-05 — B-010 · What "near-level attitude" means at touchdown

Parent spec §5 fixes two landing gates numerically (sink under 600 fpm, speed under
1.3 Vs) and leaves "near-level attitude" to implementation. `game/classify.ts` makes it:
bank within ±10°, pitch within −5°…+15°. The pitch window is deliberately asymmetric — a
nose-up flare is how a light single arrives, a nose-down arrival is a crash regardless of
how slowly it was going. Both bounds are inclusive; the sink and speed gates are strictly
less-than, so exactly 600 fpm and exactly 1.3 Vs read CRASHED. Every one of those
boundaries is pinned by a test in `game/classify.test.ts`, and Vs is taken for the flap
setting actually selected, so a full-flap touchdown is judged against 40 kt, not 48.
```

- [ ] **Step 18: Full suite + typecheck + commit** — `cd frontend && npm run test && npm run typecheck`. Expected: 261 tests passed (205 + machine 20 + classify 18 + stats 7 + simRate 5 + store 6), typecheck clean. Then:

```bash
git add frontend/src/game frontend/src/state docs/decisions.md && git commit -m "feat(game): session state machine, landing classification, flight stats, sim-rate meter"
```

---

### Task 7: World — terrain height service and its Cesium adapter

**Files:**
- Create: `frontend/src/world/terrain.ts`, `frontend/src/globe/terrainProvider.ts`
- Test: `frontend/src/world/terrain.test.ts`
- Modify: `.env.example` (document the optional `VITE_CESIUM_ION_TOKEN` fallback), `docs/decisions.md` (append B-011)

`world/terrain.ts` has **zero Cesium imports** — it takes an injected sampler, which is what makes the three mandatory defenses from parent spec §6 unit-testable. `globe/terrainProvider.ts` is the Cesium half: attaching Re:Earth at app start and wrapping `scene.globe.getHeight`.

**Interfaces:**
- Consumes: nothing from earlier tasks (`world/` is standalone by design); `globe/terrainProvider.ts` consumes `HeightSampler` from `world/terrain.ts`.
- Produces:
  - `world/terrain.ts`: `type HeightSampler = (latRad: number, lonRad: number) => number | undefined`, `type TerrainSample = { heightM: number | null; verified: boolean; collisionArmed: boolean }`, `type TerrainService = { sample(latRad: number, lonRad: number, simTimeS: number): TerrainSample; disarm(): void; readonly unverified: boolean; readonly lastKnownGoodM: number | null }`, `DEFAULT_SPAWN_GRACE_S = 3`, `createTerrainService(sampler: HeightSampler, opts?: { spawnGraceS?: number }): TerrainService`.
  - `globe/terrainProvider.ts`: `type TerrainSource = "reearth" | "ion" | "ellipsoid"`, `REEARTH_TERRAIN_URL: string`, `attachTerrain(viewer: Viewer): Promise<{ source: TerrainSource; note: string }>`, `createSceneHeightSampler(scene: Scene): HeightSampler`.

- [ ] **Step 1: Write failing terrain-service tests**

```ts
// frontend/src/world/terrain.test.ts
import { describe, it, expect } from "vitest";
import { createTerrainService, DEFAULT_SPAWN_GRACE_S } from "./terrain";
import type { HeightSampler } from "./terrain";

/** A sampler driven by a script of values, so each defense can be exercised in isolation. */
function scripted(values: Array<number | undefined>): { sampler: HeightSampler; calls: number } {
  const box = { calls: 0 } as { calls: number; sampler: HeightSampler };
  box.sampler = () => {
    const v = values[Math.min(box.calls, values.length - 1)];
    box.calls++;
    return v;
  };
  return box as { sampler: HeightSampler; calls: number };
}

describe("terrain service — defense 1: last known good", () => {
  it("returns the sampled height when tiles are resident", () => {
    const t = createTerrainService(scripted([120]).sampler);
    const s = t.sample(0.5, -1.5, 10);
    expect(s.heightM).toBe(120);
    expect(s.verified).toBe(true);
    expect(s.collisionArmed).toBe(true);
  });
  it("undefined reuses the last known good height — never reads as 'no ground'", () => {
    const t = createTerrainService(scripted([120, undefined]).sampler);
    t.sample(0.5, -1.5, 10);
    const s = t.sample(0.5, -1.5, 10.02);
    expect(s.heightM).toBe(120);
    expect(s.verified).toBe(false);
    expect(s.collisionArmed).toBe(true); // armed against the last verified floor
  });
  it("exposes the last known good height for the caller to inspect", () => {
    const t = createTerrainService(scripted([300, undefined, undefined]).sampler);
    t.sample(0.5, -1.5, 10);
    t.sample(0.5, -1.5, 10.02);
    expect(t.lastKnownGoodM).toBe(300);
  });
  it("a later defined sample replaces the cached one", () => {
    const t = createTerrainService(scripted([100, undefined, 250]).sampler);
    t.sample(0, 0, 1);
    t.sample(0, 0, 2);
    expect(t.sample(0, 0, 3).heightM).toBe(250);
    expect(t.lastKnownGoodM).toBe(250);
  });
  it("ignores a NaN or infinite sample the way it ignores undefined", () => {
    const t = createTerrainService(scripted([100, Number.NaN, Number.POSITIVE_INFINITY]).sampler);
    t.sample(0, 0, 1);
    expect(t.sample(0, 0, 2).heightM).toBe(100);
    expect(t.sample(0, 0, 3).heightM).toBe(100);
  });
});

describe("terrain service — defense 3: spawn grace", () => {
  it("collision is disarmed while no sample has ever come back", () => {
    const t = createTerrainService(scripted([undefined]).sampler);
    const s = t.sample(0.5, -1.5, 0.5);
    expect(s.heightM).toBeNull();
    expect(s.collisionArmed).toBe(false);
    expect(s.verified).toBe(false);
  });
  it("stays disarmed past the grace period but flags the ground as unverified", () => {
    const t = createTerrainService(scripted([undefined]).sampler);
    t.sample(0.5, -1.5, 0.5);
    const s = t.sample(0.5, -1.5, DEFAULT_SPAWN_GRACE_S + 1);
    expect(s.collisionArmed).toBe(false);
    expect(t.unverified).toBe(true);
  });
  it("arms once a real sample has arrived AND the grace has expired", () => {
    const t = createTerrainService(scripted([undefined, undefined, 80]).sampler);
    t.sample(0, 0, 0.2);
    t.sample(0, 0, 0.4);
    const s = t.sample(0, 0, DEFAULT_SPAWN_GRACE_S + 1);
    expect(s.collisionArmed).toBe(true);
    expect(t.unverified).toBe(false);
  });
  it("a confident sample INSIDE the grace window still does not arm — takeover is a teleport", () => {
    // The tiles resident right after takeover may still be the browse camera's, so an
    // early defined height can be a confident number for the wrong place.
    const t = createTerrainService(scripted([80]).sampler);
    const early = t.sample(0, 0, DEFAULT_SPAWN_GRACE_S - 0.5);
    expect(early.heightM).toBe(80);
    expect(early.verified).toBe(true);
    expect(early.collisionArmed).toBe(false);
  });
  it("honors a custom grace period on both sides of it", () => {
    const t = createTerrainService(scripted([500]).sampler, { spawnGraceS: 10 });
    expect(t.sample(0, 0, 9).collisionArmed).toBe(false);
    expect(t.sample(0, 0, 11).collisionArmed).toBe(true);
  });
});

describe("terrain service — disarm", () => {
  it("disarm() keeps collision off for the rest of the session even with good samples", () => {
    const t = createTerrainService(scripted([150, 150, 150]).sampler);
    t.sample(0, 0, 1);
    t.disarm();
    const s = t.sample(0, 0, 2);
    expect(s.collisionArmed).toBe(false);
    expect(s.heightM).toBe(150); // still reports the height — the HUD wants it
    expect(t.unverified).toBe(true);
  });
  it("is what the countdown timeout uses: TERRAIN UNVERIFIED without a false crash", () => {
    const t = createTerrainService(scripted([undefined]).sampler);
    t.disarm();
    expect(t.unverified).toBe(true);
    expect(t.sample(0, 0, 30).collisionArmed).toBe(false);
  });
});

describe("terrain service — no Cesium", () => {
  it("works with a sampler that knows nothing about a globe", () => {
    let asked: Array<[number, number]> = [];
    const t = createTerrainService((lat, lon) => { asked.push([lat, lon]); return 42; });
    expect(t.sample(0.1, 0.2, 1).heightM).toBe(42);
    expect(asked).toEqual([[0.1, 0.2]]);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `cd frontend && npm run test -- src/world/terrain.test.ts`. Expected: "Failed to load url ./terrain".

- [ ] **Step 3: Implement the terrain service**

```ts
// frontend/src/world/terrain.ts
/*
 * Ground height for collision, with the three defenses parent spec §6 makes mandatory
 * (they come from cesium#5999 and the community threads in docs/research/cesium-fpv-notes):
 *
 *  1. LAST KNOWN GOOD — `scene.globe.getHeight()` returns undefined when the tile is not
 *     resident. That is "we don't know", not "there is no ground". We reuse the previous
 *     sample rather than letting the aircraft fly through a mountain that hasn't loaded.
 *  2. ASYNC BACKFILL — the caller (game/flightLoop.ts) fires sampleTerrainMostDetailed for
 *     the current and predicted position; this module just accepts whatever it is given.
 *  3. SPAWN GRACE — until the first defined sample arrives for the area, there is nothing
 *     to collide against, so collision stays disarmed. No fall-through, no false crash.
 *
 * The sampler is injected, which is why this file has zero Cesium imports and the defenses
 * are testable. `globe/terrainProvider.ts` supplies the real one.
 */
export type HeightSampler = (latRad: number, lonRad: number) => number | undefined;

export type TerrainSample = {
  /** Best available ground height, or null when nothing has ever been sampled. */
  heightM: number | null;
  /** True when this tick's sample came back defined (not a reused cache entry). */
  verified: boolean;
  /** False means: do not test for impact this tick. */
  collisionArmed: boolean;
};

export type TerrainService = {
  sample(latRad: number, lonRad: number, simTimeS: number): TerrainSample;
  /** Permanently disarm collision for this session (countdown preload timed out). */
  disarm(): void;
  readonly unverified: boolean;
  readonly lastKnownGoodM: number | null;
};

export const DEFAULT_SPAWN_GRACE_S = 3;

export function createTerrainService(
  sampler: HeightSampler,
  opts: { spawnGraceS?: number } = {},
): TerrainService {
  const spawnGraceS = opts.spawnGraceS ?? DEFAULT_SPAWN_GRACE_S;
  let lastKnownGoodM: number | null = null;
  let lastSampleVerified = false;
  let permanentlyDisarmed = false;

  const service: TerrainService = {
    sample(latRad, lonRad, simTimeS) {
      const raw = sampler(latRad, lonRad);
      const usable = typeof raw === "number" && Number.isFinite(raw);
      if (usable) lastKnownGoodM = raw as number;
      lastSampleVerified = usable;

      // Collision needs THREE things, and the grace window is a real one, not a formality.
      // Taking controls is a teleport: for the first seconds the resident tiles are still
      // the ones the browse camera was looking at, so `getHeight` can return a confident
      // number for the wrong place. Refusing to arm until the grace has expired is what
      // stops that becoming an instant, invented crash (research notes §2).
      const collisionArmed =
        !permanentlyDisarmed && lastKnownGoodM !== null && simTimeS >= spawnGraceS;
      return { heightM: lastKnownGoodM, verified: usable, collisionArmed };
    },
    disarm() {
      permanentlyDisarmed = true;
    },
    get unverified() {
      return permanentlyDisarmed || !lastSampleVerified;
    },
    get lastKnownGoodM() {
      return lastKnownGoodM;
    },
  };
  return service;
}
```

- [ ] **Step 4: Run to see it pass** — `cd frontend && npm run test -- src/world/terrain.test.ts`. Expected: 13 passed.

- [ ] **Step 5: Implement the Cesium adapter** (no unit test — it is thin Cesium wiring with no logic of its own; it is exercised by the Task 12 acceptance walkthrough)

```ts
// frontend/src/globe/terrainProvider.ts
/*
 * The Cesium half of the terrain story. Attached once at APP START, never at takeover:
 * swapping a terrain provider mid-session forces a full tile reload and jumps the camera
 * (spec §3).
 *
 * Datum matters here (decisions.md G-003): Re:Earth serves ELLIPSOIDAL heights, the same
 * datum as ADS-B `alt_geom`, so spawn altitude and ground height compare like with like
 * without a geoid fudge.
 *
 * Fallback chain, in order, each one honestly reported to the status bar:
 *   1. Re:Earth quantized mesh — keyless, best-effort, no SLA
 *   2. Cesium ion world terrain — ONLY if the operator supplied VITE_CESIUM_ION_TOKEN
 *      (non-commercial terms, their account, their choice)
 *   3. the ellipsoid — flat earth, honestly labelled, collision still works against h=0
 */
import {
  Cartographic,
  CesiumTerrainProvider,
  EllipsoidTerrainProvider,
  Ion,
  createWorldTerrainAsync,
  type Scene,
  type Viewer,
} from "cesium";
import type { HeightSampler } from "../world/terrain";

export const REEARTH_TERRAIN_URL = "https://terrain.reearth.land/cesium-mesh/ellipsoid";

export type TerrainSource = "reearth" | "ion" | "ellipsoid";

export async function attachTerrain(viewer: Viewer): Promise<{ source: TerrainSource; note: string }> {
  try {
    viewer.terrainProvider = await CesiumTerrainProvider.fromUrl(REEARTH_TERRAIN_URL);
    return { source: "reearth", note: "RE:EARTH TERRAIN · MAPTERHORN CC BY 4.0" };
  } catch {
    // Re:Earth is documented as best-effort with no SLA — losing it is expected, not a bug.
  }

  const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
  if (typeof ionToken === "string" && ionToken.length > 0) {
    try {
      Ion.defaultAccessToken = ionToken;
      viewer.terrainProvider = await createWorldTerrainAsync();
      return { source: "ion", note: "TERRAIN: CESIUM ION (FALLBACK)" };
    } catch {
      Ion.defaultAccessToken = null as unknown as string; // back to keyless
    }
  }

  viewer.terrainProvider = new EllipsoidTerrainProvider();
  return { source: "ellipsoid", note: "TERRAIN UNAVAILABLE — FLAT ELLIPSOID" };
}

/**
 * `scene.globe.getHeight` is synchronous and returns `number | undefined` — undefined when
 * the tile is not resident. Handing that undefined straight through is deliberate:
 * world/terrain.ts is the module that knows undefined means "unknown", not "no ground".
 */
export function createSceneHeightSampler(scene: Scene): HeightSampler {
  const scratch = new Cartographic();
  return (latRad, lonRad) => {
    scratch.longitude = lonRad;
    scratch.latitude = latRad;
    scratch.height = 0;
    return scene.globe.getHeight(scratch);
  };
}
```

- [ ] **Step 6: Document the optional ion token** — append to `.env.example`:

```bash
# Optional. Terrain falls back to Cesium ion world terrain if Re:Earth is unreachable AND
# this token is set. Leave it empty to stay fully keyless — the fallback is then a flat
# ellipsoid, honestly labelled in the status bar. Cesium ion's free tier is non-commercial.
VITE_CESIUM_ION_TOKEN=
```

- [ ] **Step 7: Typecheck** — `cd frontend && npm run typecheck`. Expected: clean. If `createWorldTerrainAsync` is not exported by the installed Cesium version, check the actual export name in `frontend/node_modules/cesium/index.d.ts` and use that — do not add a dependency or pin a version.

- [ ] **Step 8: Log the fallback chain** — append to `docs/decisions.md`:

```markdown
## 2026-08-05 — B-011 · Terrain fallback is Re:Earth → optional ion → labelled flat earth

G-003 named Cesium ion's free tier as the Re:Earth fallback, but ion needs a token and this
project is keyless by rule. `globe/terrainProvider.ts` resolves that: Re:Earth first; ion
only if the operator has put their own token in `VITE_CESIUM_ION_TOKEN` (their account,
their non-commercial terms); otherwise an `EllipsoidTerrainProvider` — a flat earth, said
out loud in the status bar as "TERRAIN UNAVAILABLE — FLAT ELLIPSOID" rather than quietly
letting the player fly over an invisible plain and wonder why Colorado is missing. Terrain
attaches at app start, never at takeover, because swapping providers mid-session forces a
full tile reload and jumps the camera.
```

- [ ] **Step 9: Full suite + typecheck + commit** — `cd frontend && npm run test && npm run typecheck`. Expected: 274 tests passed (261 + terrain 13), typecheck clean. Then:

```bash
git add frontend/src/world frontend/src/globe/terrainProvider.ts .env.example docs/decisions.md && git commit -m "feat(world): terrain height service with last-known-good + spawn grace, Re:Earth adapter"
```

---

### Task 8: Hoist the Viewer and polling out of `BrowseGlobe`

BROWSE, COUNTDOWN, FLYING, PAUSED and ENDED are **modes on one Cesium Viewer** (spec §3). Today `BrowseGlobe.tsx` owns the Viewer, the billboards, the picking and the poller, and unmounting it to fly would destroy the globe and stop the feed — which the ghost and the live traffic both depend on. This task moves that ownership up to an App-level host and leaves browse behavior byte-for-byte identical.

**This is a pure refactor: no behavior change, no new tests, and the 26 Phase A tests must stay green.** Its verification is the existing suite plus a manual browse check.

**Files:**
- Create: `frontend/src/globe/viewerContext.ts`, `frontend/src/globe/ViewerHost.tsx`, `frontend/src/globe/ContactLayer.tsx`
- Delete: `frontend/src/globe/BrowseGlobe.tsx` (its contents split across the two new files)
- Modify: `frontend/src/App.tsx` (all 19 lines — it becomes the mode switchboard)

**Interfaces:**
- Consumes: `startPolling`, `useStore` from `state/store.ts`; `syncBillboards` from `globe/contactBillboards.ts`; `attachTerrain`, `createSceneHeightSampler` from `globe/terrainProvider.ts`.
- Produces:
  - `globe/viewerContext.ts`: `type ViewerBundle = { viewer: Viewer; billboards: BillboardCollection; labels: LabelCollection; byHex: Map<string, Billboard>; heightSampler: HeightSampler; terrainNote: string }`, `ViewerContext: React.Context<ViewerBundle | null>`, `useViewer(): ViewerBundle | null`.
  - `globe/ViewerHost.tsx`: default export `ViewerHost({ children }: { children?: React.ReactNode })` — creates the Viewer, owns polling, attaches terrain, provides the bundle, renders `children` as an overlay above the canvas.
  - `globe/ContactLayer.tsx`: default export `ContactLayer()` — syncs contacts to billboards in **every** mode (live traffic is scenery while flying) and flies the camera home **only** in BROWSE.

- [ ] **Step 1: Confirm the baseline is green before touching anything** — `cd frontend && npm run test`. Expected: 274 passed. Note the number; it must be identical at the end of this task.

- [ ] **Step 2: Create the context**

```ts
// frontend/src/globe/viewerContext.ts
/*
 * One Cesium Viewer for the whole app. BROWSE / COUNTDOWN / FLYING / PAUSED / ENDED are
 * modes on it, not separate screens — destroying and rebuilding the globe to fly would
 * drop every loaded tile, stop the feed, and lose the ghost (spec §3).
 */
import { createContext, useContext } from "react";
import type { Billboard, BillboardCollection, LabelCollection, Viewer } from "cesium";
import type { HeightSampler } from "../world/terrain";

export type ViewerBundle = {
  viewer: Viewer;
  billboards: BillboardCollection;
  labels: LabelCollection;
  /** Billboard per ICAO hex, mutated in place — the LORAN primitive-churn lesson. */
  byHex: Map<string, Billboard>;
  heightSampler: HeightSampler;
  /** Which terrain source actually attached, for the status bar. */
  terrainNote: string;
};

export const ViewerContext = createContext<ViewerBundle | null>(null);

export function useViewer(): ViewerBundle | null {
  return useContext(ViewerContext);
}
```

- [ ] **Step 3: Create `ViewerHost`** — this is `BrowseGlobe`'s mount effect, moved wholesale and given terrain

```tsx
// frontend/src/globe/ViewerHost.tsx
/*
 * Owns the Cesium Viewer, the primitive collections, click picking, the ADS-B poller and
 * the terrain provider — everything that must outlive a mode change. Children render as an
 * overlay above the canvas (HUD, cards, panels).
 *
 * Cesium ~1.143 API notes carried over from BrowseGlobe: ArcGisMapServerImageryProvider's
 * constructor is not callable directly (use the async `fromUrl` factory), and Viewer's
 * options have `baseLayer`, not `imageryProvider`. `ImageryLayer.fromProviderAsync` accepts
 * the provider promise and returns the layer synchronously, so no extra async effect.
 *
 * StrictMode: React 18 double-invokes this effect in development. The cleanup destroys
 * everything it created, so the second mount starts from nothing and exactly one Viewer is
 * ever live.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArcGisMapServerImageryProvider,
  Billboard,
  BillboardCollection,
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  LabelCollection,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from "cesium";
import { startPolling, useStore } from "../state/store";
import { attachTerrain, createSceneHeightSampler } from "./terrainProvider";
import { ViewerContext, type ViewerBundle } from "./viewerContext";

// Keyless: no Cesium ion account. Must be set before any Viewer is constructed.
// Cast needed: the installed Cesium's .d.ts types this as `string`, not nullable.
Ion.defaultAccessToken = null as unknown as string;

const ESRI_WORLD_IMAGERY_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";

export default function ViewerHost({ children }: { children?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bundle, setBundle] = useState<ViewerBundle | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    const baseLayer = ImageryLayer.fromProviderAsync(
      ArcGisMapServerImageryProvider.fromUrl(ESRI_WORLD_IMAGERY_URL),
    );
    const viewer = new Viewer(containerRef.current, {
      baseLayer,
      terrainProvider: new EllipsoidTerrainProvider(),
      baseLayerPicker: false,
      timeline: false,
      animation: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      fullscreenButton: false,
      // A sim is the documented anti-case for requestRenderMode (research notes §5).
      requestRenderMode: false,
    });
    const billboards = viewer.scene.primitives.add(new BillboardCollection());
    const labels = viewer.scene.primitives.add(new LabelCollection());
    const byHex = new Map<string, Billboard>();

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: ScreenSpaceEventHandler.PositionedEvent) => {
      // Picking only means anything in BROWSE; while flying the canvas click resumes.
      if (useStore.getState().mode !== "BROWSE") return;
      const picked = viewer.scene.pick(click.position);
      const hex = picked?.id;
      useStore.getState().select(typeof hex === "string" && byHex.has(hex) ? hex : null);
    }, ScreenSpaceEventType.LEFT_CLICK);

    const stopPolling = startPolling();

    setBundle({
      viewer,
      billboards,
      labels,
      byHex,
      heightSampler: createSceneHeightSampler(viewer.scene),
      terrainNote: "TERRAIN LOADING…",
    });

    // Terrain attaches at APP START, not at takeover: a mid-session provider swap forces a
    // full tile reload and jumps the camera (spec §3).
    void attachTerrain(viewer).then(({ note }) => {
      if (cancelled || viewer.isDestroyed()) return;
      setBundle((b) => (b === null ? b : { ...b, terrainNote: note }));
    });

    return () => {
      cancelled = true;
      stopPolling();
      handler.destroy();
      viewer.destroy();
      setBundle(null);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <ViewerContext.Provider value={bundle}>{children}</ViewerContext.Provider>
    </div>
  );
}
```

- [ ] **Step 4: Create `ContactLayer`** — the rest of `BrowseGlobe`, consuming the hoisted Viewer

```tsx
// frontend/src/globe/ContactLayer.tsx
/*
 * Store -> billboards, in every mode. Live traffic keeps rendering while you fly (it is
 * scenery, parent spec §5); only the home-camera move is BROWSE-only, because setView in
 * FLYING would fight the FPV camera.
 */
import { useEffect } from "react";
import { Cartesian3, Math as CesiumMath } from "cesium";
import { useStore } from "../state/store";
import { syncBillboards } from "./contactBillboards";
import { useViewer } from "./viewerContext";

const BROWSE_HEIGHT_M = 250_000;

export default function ContactLayer() {
  const bundle = useViewer();
  const contacts = useStore((s) => s.contacts);
  const selectedHex = useStore((s) => s.selectedHex);
  const home = useStore((s) => s.home);
  const mode = useStore((s) => s.mode);

  // Camera waits for the real home from /api/config — never flies to an invented default.
  useEffect(() => {
    if (!home || !bundle || mode !== "BROWSE") return;
    bundle.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(home.lon, home.lat, BROWSE_HEIGHT_M),
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
    });
  }, [home, bundle, mode]);

  useEffect(() => {
    if (!bundle) return;
    syncBillboards(bundle.billboards, bundle.byHex, contacts, selectedHex);
  }, [bundle, contacts, selectedHex]);

  return null;
}
```

- [ ] **Step 5: Rewrite `App.tsx` as the mode switchboard** (replace all 19 lines)

```tsx
// frontend/src/App.tsx
import ViewerHost from "./globe/ViewerHost";
import ContactLayer from "./globe/ContactLayer";
import ContactList from "./panels/ContactList";
import StatusBar from "./panels/StatusBar";
import { useStore } from "./state/store";

export default function App() {
  const mode = useStore((s) => s.mode);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1">
          <ViewerHost>
            <ContactLayer />
          </ViewerHost>
        </div>
        {mode === "BROWSE" && (
          <div className="w-80 flex-none">
            <ContactList />
          </div>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 6: Delete the old file** — `git rm frontend/src/globe/BrowseGlobe.tsx`. Confirm nothing still imports it: `grep -rn "BrowseGlobe" frontend/src` returns nothing.

- [ ] **Step 7: Run the suite and typecheck** — `cd frontend && npm run test && npm run typecheck`. Expected: **274 passed — the same number as Step 1** (this task adds no tests and must break none), typecheck clean.

- [ ] **Step 8: Verify browse still behaves, by hand** — `bash scripts/dev.sh`, open http://localhost:5173. Check all five: (a) the globe loads over Esri imagery and now shows real terrain relief when you tilt in; (b) contacts appear and move; (c) clicking a contact selects it in both the globe and the list; (d) the status bar reads LIVE with a source; (e) no duplicated globe or doubled contacts (the StrictMode double-mount check). Stop the server.

- [ ] **Step 9: Commit**

```bash
git add -A frontend/src && git commit -m "refactor(globe): hoist Viewer, polling and terrain to an App-level ViewerHost"
```

---

### Task 9: The flight loop — fixed-step sim on one frame callback, FPV camera, collision

**Files:**
- Create: `frontend/src/hud/snapshot.ts`, `frontend/src/game/flightLoop.ts`, `frontend/src/globe/fpvCamera.ts`, `frontend/src/globe/cesiumFlightHost.ts`, `frontend/src/globe/terrainPreload.ts`
- Test: `frontend/src/game/flightLoop.test.ts`, `frontend/src/globe/fpvCamera.test.ts`
- Modify: `docs/decisions.md` (append B-012)

The loop is written against an injected **`FlightHost`** rather than a Cesium `Viewer`, so the whole of it — accumulator, collision, pause, sim rate, end classification — is unit-testable by driving frames by hand, with the Cesium implementation isolated in one thin file. Same seam as `world/terrain.ts`'s injected sampler, and the same reason.

**Interfaces:**
- Consumes: `stepAircraft` from `sim/aircraft.ts`; `runFixedSteps`, `createAccumulator`, `FIXED_DT` from `sim/integrator.ts`; `ecefToGeodetic` from `sim/geo.ts`; `hprFromQuat` from `sim/quat.ts`; `createControlSampler` from `input/controls.ts`; `createTerrainService`/`TerrainService` from `world/terrain.ts`; `createStatsAccumulator` from `game/stats.ts`; `classifyEnd`, `readImpact` from `game/classify.ts`; `createRateMeter` from `game/simRate.ts`; `SpawnResult` from `takeover/spawn.ts`.
- Produces:
  - `hud/snapshot.ts`: `type HudSnapshot = { iasMs, tasMs, altitudeM, verticalSpeedMs, headingRad, aoaRad, loadFactor, throttle, flapLabel: string, gear: "fixed"|"retractable", stalled: boolean, overspeed: boolean, gLimited: boolean, terrainClearanceM: number | null, terrainUnverified: boolean, simRate: number, airtimeS: number, classLabel: string, callsign: string, modelNote: string }`, `createSnapshotStore(): { set(s: HudSnapshot | null): void; get(): HudSnapshot | null; subscribe(fn: () => void): () => void }`, `hudSnapshot` (the app-wide instance).
  - `game/flightLoop.ts`: `type FlightHost = { onFrame(cb: (wallMs: number) => void): () => void; setCamera(state: SimState, dtS: number): void; enterFlightView(): void; exitFlightView(): void }`, `type FlightLoopDeps = { host: FlightHost; params: ClassParams; terrain: TerrainService; spawn: SpawnResult; heldKeys: ReadonlySet<string>; callsign: string; onSnapshot(s: HudSnapshot): void; onEnd(stats: FlightStats): void }`, `SNAPSHOT_INTERVAL_S = 0.1`, `createFlightLoop(deps: FlightLoopDeps): { start(): void; pause(): void; resume(): void; stop(): void; isPaused(): boolean; getState(): SimState }`.
  - `globe/fpvCamera.ts`: `lowPassCoefficient(cutoffHz: number, dtS: number): number`, `lowPassAngleRad(prev: number, target: number, coef: number): number`, `EYE_OFFSET_BODY_M: Vec3`, `createFpvCamera(viewer: Viewer, cutoffHz?: number): { update(state: SimState, dtS: number): void; enter(): void; exit(): void }`.
  - `globe/cesiumFlightHost.ts`: `createCesiumFlightHost(viewer: Viewer): FlightHost`.
  - `globe/terrainPreload.ts`: `lookAheadPointRad(latRad, lonRad, headingRad, speedMs, seconds): { latRad: number; lonRad: number }`, `preloadTerrain(viewer: Viewer, latRad: number, lonRad: number, headingRad: number, speedMs: number, timeoutMs?: number): Promise<{ verified: boolean; terrainHeightM: number | null }>`.

- [ ] **Step 1: Write failing FPV-camera maths tests** (the pure half — the `setView` half is Cesium wiring)

```ts
// frontend/src/globe/fpvCamera.test.ts
import { describe, it, expect } from "vitest";
import { lowPassCoefficient, lowPassAngleRad, EYE_OFFSET_BODY_M } from "./fpvCamera";
import { degToRad, radToDeg } from "../sim/units";

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
```

- [ ] **Step 2: Run to see it fail** — `cd frontend && npm run test -- src/globe/fpvCamera.test.ts`. Expected: "Failed to load url ./fpvCamera".

- [ ] **Step 3: Implement the FPV camera**

```ts
// frontend/src/globe/fpvCamera.ts
/*
 * Cockpit camera (parent spec §7, research notes §1): camera.setView every frame from a
 * LOW-PASSED copy of the sim attitude, with the eye point offset forward and up from the
 * CG. The physics stays raw — only the camera's copy is filtered, which is the difference
 * between "cockpit" and "camera bolted to the airframe".
 *
 * Three settings are not optional here:
 *   screenSpaceCameraController.enableInputs = false  — the default controller fights
 *     setView and produces the roll drift the community threads describe;
 *   frustum.near ~ 1 m  — otherwise the nose of the aircraft clips through the near plane
 *     on the deck;
 *   globe.depthTestAgainstTerrain = true  — so terrain occludes traffic billboards instead
 *     of aircraft showing through mountains.
 * All three are restored on exit() so BROWSE gets its normal globe back (spec §6, "no
 * residue").
 */
import { Cartesian3, PerspectiveFrustum, type Viewer } from "cesium";
import type { SimState, Vec3 } from "../sim/types";
import { hprFromQuat, qRotate } from "../sim/quat";
import { vAdd } from "../sim/vec3";

/** Eye point relative to the CG in body axes: 0.8 m forward, 0.6 m up (z is down). */
export const EYE_OFFSET_BODY_M: Vec3 = { x: 0.8, y: 0, z: -0.6 };

/**
 * First-order low-pass coefficient for a given cutoff and frame time. Derived from the
 * exponential step response, so the filter behaves the same at 30 fps as at 60.
 */
export function lowPassCoefficient(cutoffHz: number, dtS: number): number {
  return Math.min(1, 1 - Math.exp(-2 * Math.PI * cutoffHz * dtS));
}

/** Filter an angle along the SHORT arc, so heading does not spin the long way at 359->001. */
export function lowPassAngleRad(prev: number, target: number, coef: number): number {
  let delta = target - prev;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return prev + delta * coef;
}

export function createFpvCamera(viewer: Viewer, cutoffHz = 8) {
  let heading = 0;
  let pitch = 0;
  let roll = 0;
  let primed = false;

  let savedInputs = true;
  let savedNear = 1;
  let savedDepthTest = false;

  return {
    enter() {
      const controller = viewer.scene.screenSpaceCameraController;
      savedInputs = controller.enableInputs;
      savedDepthTest = viewer.scene.globe.depthTestAgainstTerrain;
      controller.enableInputs = false;
      viewer.scene.globe.depthTestAgainstTerrain = true;
      const frustum = viewer.camera.frustum;
      if (frustum instanceof PerspectiveFrustum) {
        savedNear = frustum.near;
        frustum.near = 1.0;
      }
      primed = false;
    },
    update(state: SimState, dtS: number) {
      const target = hprFromQuat(state.attitude, state.position);
      if (!primed) {
        heading = target.headingRad;
        pitch = target.pitchRad;
        roll = target.rollRad;
        primed = true;
      } else {
        const c = lowPassCoefficient(cutoffHz, dtS);
        heading = lowPassAngleRad(heading, target.headingRad, c);
        pitch = lowPassAngleRad(pitch, target.pitchRad, c);
        roll = lowPassAngleRad(roll, target.rollRad, c);
      }
      // Eye point uses the RAW attitude so the offset stays attached to the airframe;
      // only the look direction is filtered.
      const eye = vAdd(state.position, qRotate(state.attitude, EYE_OFFSET_BODY_M));
      viewer.camera.setView({
        destination: new Cartesian3(eye.x, eye.y, eye.z),
        orientation: { heading, pitch, roll },
      });
    },
    exit() {
      const controller = viewer.scene.screenSpaceCameraController;
      controller.enableInputs = savedInputs;
      viewer.scene.globe.depthTestAgainstTerrain = savedDepthTest;
      const frustum = viewer.camera.frustum;
      if (frustum instanceof PerspectiveFrustum) frustum.near = savedNear;
    },
  };
}
```

- [ ] **Step 4: Run to see it pass** — `cd frontend && npm run test -- src/globe/fpvCamera.test.ts`. Expected: 11 passed.

- [ ] **Step 5: Write `hud/snapshot.ts`** (the type the loop publishes; the HUD that reads it is Task 10)

```ts
// frontend/src/hud/snapshot.ts
/*
 * The ~10 Hz bridge between the 60 Hz sim and React. Sim state lives in a mutable ref
 * inside the flight loop; pushing it through zustand at 60 Hz would re-render the tree 60
 * times a second (spec §3). This is a plain observable snapshot instead, shaped for
 * useSyncExternalStore: `get()` returns a stable reference until `set()` replaces it.
 */
export type HudSnapshot = {
  iasMs: number;
  tasMs: number;
  altitudeM: number;
  verticalSpeedMs: number;
  headingRad: number;
  aoaRad: number;
  loadFactor: number;
  throttle: number;
  flapLabel: string;
  gear: "fixed" | "retractable";
  stalled: boolean;
  overspeed: boolean;
  gLimited: boolean;
  /** Height above the sampled ground, or null when the ground has never been sampled. */
  terrainClearanceM: number | null;
  terrainUnverified: boolean;
  /** Sim seconds per wall second; below ~0.95 the HUD says so out loud. */
  simRate: number;
  airtimeS: number;
  /** Aircraft class shown beside the callsign (parent spec §9), e.g. "C172S". */
  classLabel: string;
  callsign: string;
  modelNote: string;
};

export function createSnapshotStore() {
  let current: HudSnapshot | null = null;
  const listeners = new Set<() => void>();
  return {
    set(s: HudSnapshot | null) {
      current = s;
      for (const fn of listeners) fn();
    },
    get(): HudSnapshot | null {
      return current;
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const hudSnapshot = createSnapshotStore();
```

- [ ] **Step 6: Write failing flight-loop tests** — driven through a fake `FlightHost`, no Cesium

```ts
// frontend/src/game/flightLoop.test.ts
import { describe, it, expect, vi } from "vitest";
import { createFlightLoop, SNAPSHOT_INTERVAL_S } from "./flightLoop";
import type { FlightHost } from "./flightLoop";
import { loadC172 } from "../sim/params";
import { buildSpawnState } from "../takeover/spawn";
import { createTerrainService } from "../world/terrain";
import { FIXED_DT } from "../sim/integrator";
import { ecefToGeodetic } from "../sim/geo";
import { msToKt } from "../sim/units";
import type { FlightStats } from "./stats";
import type { HudSnapshot } from "../hud/snapshot";
import type { Contact } from "../data/types";

const P = loadC172();

const ga = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.6944, lon: -88.0399,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});

/** A host the test drives frame by frame. */
function fakeHost() {
  let cb: ((wallMs: number) => void) | null = null;
  const calls = { enter: 0, exit: 0, camera: 0 };
  const host: FlightHost = {
    onFrame(fn) {
      cb = fn;
      return () => { cb = null; };
    },
    setCamera() { calls.camera++; },
    enterFlightView() { calls.enter++; },
    exitFlightView() { calls.exit++; },
  };
  return {
    host,
    calls,
    frame(wallMs: number) { cb?.(wallMs); },
    get subscribed() { return cb !== null; },
  };
}

function makeLoop(overrides: {
  groundHeight?: number | undefined;
  held?: Set<string>;
  contact?: Contact;
} = {}) {
  const spawn = buildSpawnState(overrides.contact ?? ga(), P, { terrainHeightM: 100 });
  const terrain = createTerrainService(() =>
    "groundHeight" in overrides ? overrides.groundHeight : 100);
  const ends: FlightStats[] = [];
  const snaps: HudSnapshot[] = [];
  const h = fakeHost();
  const loop = createFlightLoop({
    host: h.host,
    params: P,
    terrain,
    spawn,
    heldKeys: overrides.held ?? new Set<string>(),
    callsign: "SIM-A1B2C3",
    onSnapshot: (s) => snaps.push(s),
    onEnd: (s) => ends.push(s),
  });
  return { loop, host: h, ends, snaps, terrain, spawn };
}

describe("flight loop lifecycle", () => {
  it("start subscribes to frames and enters the flight view", () => {
    const { loop, host } = makeLoop();
    loop.start();
    expect(host.subscribed).toBe(true);
    expect(host.calls.enter).toBe(1);
    loop.stop();
  });
  it("stop unsubscribes and restores the view (no residue)", () => {
    const { loop, host } = makeLoop();
    loop.start();
    loop.stop();
    expect(host.subscribed).toBe(false);
    expect(host.calls.exit).toBe(1);
  });
  it("stop is idempotent", () => {
    const { loop, host } = makeLoop();
    loop.start();
    loop.stop();
    loop.stop();
    expect(host.calls.exit).toBe(1);
  });
  it("the first frame establishes the clock without simulating a huge jump", () => {
    const { loop, spawn } = makeLoop();
    loop.start();
    loop.getState();
    expect(loop.getState().timeS).toBe(0);
    expect(loop.getState().altitudeM).toBeCloseTo(spawn.state.altitudeM, 6);
    loop.stop();
  });
});

describe("flight loop stepping", () => {
  it("advances sim time in 1/60 s increments driven by the host clock", () => {
    const { loop, host } = makeLoop();
    loop.start();
    host.frame(1000);
    host.frame(1000 + 100); // 100 ms -> 6 steps
    expect(loop.getState().timeS).toBeCloseTo(6 * FIXED_DT, 9);
    loop.stop();
  });
  it("caps a 30 s gap at 15 steps and reports a low sim rate", () => {
    const { loop, host, snaps } = makeLoop();
    loop.start();
    host.frame(1000);
    host.frame(31000);
    expect(loop.getState().timeS).toBeCloseTo(15 * FIXED_DT, 9);
    const last = snaps[snaps.length - 1];
    expect(last.simRate).toBeLessThan(0.5);
    loop.stop();
  });
  it("moves the camera every frame", () => {
    const { loop, host } = makeLoop();
    loop.start();
    host.frame(1000);
    host.frame(1016);
    host.frame(1032);
    expect(host.calls.camera).toBeGreaterThanOrEqual(2);
    loop.stop();
  });
});

describe("flight loop pause", () => {
  it("a paused loop does not advance sim time", () => {
    const { loop, host } = makeLoop();
    loop.start();
    host.frame(1000);
    host.frame(1100);
    const t = loop.getState().timeS;
    loop.pause();
    host.frame(5000);
    host.frame(9000);
    expect(loop.getState().timeS).toBeCloseTo(t, 9);
    expect(loop.isPaused()).toBe(true);
    loop.stop();
  });
  it("resuming does not simulate the paused wall time", () => {
    const { loop, host } = makeLoop();
    loop.start();
    host.frame(1000);
    loop.pause();
    host.frame(60000);
    loop.resume();
    host.frame(60100); // 100 ms after resume -> 6 steps, not 59 s worth
    expect(loop.getState().timeS).toBeCloseTo(6 * FIXED_DT, 9);
    loop.stop();
  });
});

describe("flight loop snapshots", () => {
  it("publishes about 10 snapshots per simulated second, not 60", () => {
    const { loop, host, snaps } = makeLoop();
    loop.start();
    let t = 1000;
    for (let i = 0; i < 60; i++) { t += 1000 / 60; host.frame(t); }
    expect(snaps.length).toBeGreaterThanOrEqual(8);
    expect(snaps.length).toBeLessThanOrEqual(14);
    expect(SNAPSHOT_INTERVAL_S).toBeCloseTo(0.1, 9);
    loop.stop();
  });
  it("the snapshot carries the callsign, the flap label and the honest model note", () => {
    const { loop, host, snaps } = makeLoop();
    loop.start();
    host.frame(1000);
    host.frame(1200);
    const s = snaps[snaps.length - 1];
    expect(s.callsign).toBe("SIM-A1B2C3");
    expect(s.classLabel).toBe(P.label); // "C172S" — spec §9 wants class beside the callsign
    expect(s.flapLabel).toBe("0");
    expect(s.modelNote).toBe(P.modelNote);
    expect(s.gear).toBe("fixed");
    loop.stop();
  });
  it("reports overspeed against Vne and terrain clearance against the sampled ground", () => {
    const { loop, host, snaps } = makeLoop({ groundHeight: 500 });
    loop.start();
    host.frame(1000);
    host.frame(1200);
    const s = snaps[snaps.length - 1];
    expect(s.overspeed).toBe(false);
    expect(s.terrainClearanceM).toBeCloseTo(s.altitudeM - 500, 3);
    loop.stop();
  });
  it("reports terrainUnverified when the sampler never returns a height", () => {
    const { loop, host, snaps } = makeLoop({ groundHeight: undefined });
    loop.start();
    host.frame(1000);
    host.frame(1200);
    const s = snaps[snaps.length - 1];
    expect(s.terrainUnverified).toBe(true);
    expect(s.terrainClearanceM).toBeNull();
    loop.stop();
  });
});

describe("flight loop collision", () => {
  /*
   * The spawn hands over a TRIMMED, POWERED aircraft, so it holds altitude if left alone —
   * these tests must therefore fly it down on purpose. `KeyS` walks the throttle to idle
   * (about 2 s) and the trimmed 172 settles into a ~750 fpm glide, which covers 60 m in
   * roughly fifteen seconds. They also have to outlast the 3 s spawn grace before
   * collision can arm at all, which is why none of them is a short run.
   */
  const IDLE = () => new Set(["KeyS"]);
  const spawnAltitudeM = () => buildSpawnState(ga(), P, { terrainHeightM: 100 }).state.altitudeM;

  function fly(loopBits: ReturnType<typeof makeLoop>, frames: number) {
    let t = 1000;
    for (let i = 0; i < frames && loopBits.ends.length === 0; i++) {
      t += 1000 / 60;
      loopBits.host.frame(t);
    }
    return t;
  }

  it("ends the session when the aircraft glides down onto the sampled terrain", () => {
    const bits = makeLoop({ groundHeight: spawnAltitudeM() - 60, held: IDLE() });
    bits.loop.start();
    fly(bits, 2400); // 40 s of sim, well past both the glide time and the spawn grace
    expect(bits.ends).toHaveLength(1);
    expect(["LANDED", "CRASHED"]).toContain(bits.ends[0].classification);
    expect(bits.ends[0].airtimeS).toBeGreaterThan(3); // it flew, it did not spawn into the dirt
    bits.loop.stop();
  });
  it("a dive into terrain reads CRASHED with a real impact sink rate and speed", () => {
    // ArrowUp is stick FORWARD (Task 4 KEYMAP: "pitch down"), KeyS is throttle down —
    // nose down at idle, which arrives fast and steep.
    const held = new Set(["ArrowUp", "KeyS"]);
    const bits = makeLoop({ groundHeight: spawnAltitudeM() - 200, held });
    bits.loop.start();
    fly(bits, 3600);
    expect(bits.ends).toHaveLength(1);
    expect(bits.ends[0].classification).toBe("CRASHED");
    expect(bits.ends[0].impactSinkFpm).toBeGreaterThan(600);
    expect(msToKt(bits.ends[0].impactIasMs)).toBeGreaterThan(40);
    bits.loop.stop();
  });
  it("does not collide while the ground has never been sampled", () => {
    const bits = makeLoop({ groundHeight: undefined, held: IDLE() });
    bits.loop.start();
    fly(bits, 1800);
    expect(bits.ends).toHaveLength(0);
    bits.loop.stop();
  });
  it("does not collide inside the spawn grace, even with the ground above the aircraft", () => {
    // Ground 500 m ABOVE the spawn: armed, this collides on the very first armed tick.
    // Inside the grace it must not — that window is what stops a teleport reading as a crash.
    const bits = makeLoop({ groundHeight: spawnAltitudeM() + 500, held: IDLE() });
    bits.loop.start();
    fly(bits, 120); // 2 s of sim, inside the 3 s grace
    expect(bits.ends).toHaveLength(0);
    fly(bits, 300); // past the grace — now it must fire
    expect(bits.ends).toHaveLength(1);
    bits.loop.stop();
  });
  it("does not collide after terrain.disarm() — and WOULD have without it", () => {
    const ground = spawnAltitudeM() + 500;
    // Control arm first: prove the setup really does collide when collision is armed.
    const armed = makeLoop({ groundHeight: ground, held: IDLE() });
    armed.loop.start();
    fly(armed, 600);
    expect(armed.ends).toHaveLength(1);
    armed.loop.stop();

    const disarmed = makeLoop({ groundHeight: ground, held: IDLE() });
    disarmed.terrain.disarm();
    disarmed.loop.start();
    fly(disarmed, 600);
    expect(disarmed.ends).toHaveLength(0);
    disarmed.loop.stop();
  });
  it("stops stepping once the session has ended (no physics past the impact)", () => {
    const bits = makeLoop({ groundHeight: spawnAltitudeM() - 60, held: IDLE() });
    bits.loop.start();
    let t = fly(bits, 2400);
    expect(bits.ends).toHaveLength(1);
    const frozen = bits.loop.getState().timeS;
    for (let i = 0; i < 60; i++) { t += 1000 / 60; bits.host.frame(t); }
    expect(bits.loop.getState().timeS).toBeCloseTo(frozen, 9);
    bits.loop.stop();
  });
  it("the position at the end is at or below the ground it hit", () => {
    const ground = spawnAltitudeM() - 60;
    const bits = makeLoop({ groundHeight: ground, held: IDLE() });
    bits.loop.start();
    fly(bits, 2400);
    expect(bits.ends).toHaveLength(1);
    expect(ecefToGeodetic(bits.loop.getState().position).heightM).toBeLessThanOrEqual(ground);
    bits.loop.stop();
  });
});
```

- [ ] **Step 7: Run to see it fail** — `cd frontend && npm run test -- src/game/flightLoop.test.ts`. Expected: "Failed to load url ./flightLoop".

- [ ] **Step 8: Implement the flight loop**

```ts
// frontend/src/game/flightLoop.ts
/*
 * The one loop. Driven by a single host frame callback (Cesium's scene.preRender in the
 * app, a fake in the tests) with performance.now() timing, it:
 *   - samples the held keys into a control vector once per PHYSICS tick, not per frame;
 *   - runs the fixed 60 Hz accumulator with the 0.25 s / 15 step clamp;
 *   - tests terrain collision every tick through the injected terrain service;
 *   - drives the camera once per FRAME (rendering cadence, not physics cadence);
 *   - publishes a HUD snapshot at ~10 Hz;
 *   - reports a falling sim rate honestly instead of quietly running in slow motion.
 *
 * It talks to a FlightHost, not to a Viewer, which is what makes all of the above testable
 * without Cesium. globe/cesiumFlightHost.ts is the ten-line real implementation.
 */
import type { ClassParams, SimState } from "../sim/types";
import type { TerrainService } from "../world/terrain";
import type { SpawnResult } from "../takeover/spawn";
import type { HudSnapshot } from "../hud/snapshot";
import type { FlightStats } from "./stats";
import { stepAircraft } from "../sim/aircraft";
import { createAccumulator, runFixedSteps, FIXED_DT } from "../sim/integrator";
import { ecefToGeodetic } from "../sim/geo";
import { hprFromQuat } from "../sim/quat";
import { createControlSampler } from "../input/controls";
import { createStatsAccumulator } from "./stats";
import { classifyEnd, readImpact } from "./classify";
import { createRateMeter } from "./simRate";

export const SNAPSHOT_INTERVAL_S = 0.1;

export type FlightHost = {
  /** Subscribe to render frames; returns the unsubscribe. */
  onFrame(cb: (wallMs: number) => void): () => void;
  setCamera(state: SimState, dtS: number): void;
  enterFlightView(): void;
  exitFlightView(): void;
};

export type FlightLoopDeps = {
  host: FlightHost;
  params: ClassParams;
  terrain: TerrainService;
  spawn: SpawnResult;
  /** Live view of the held keys — the loop samples it, it does not own it. */
  heldKeys: ReadonlySet<string>;
  callsign: string;
  onSnapshot(s: HudSnapshot): void;
  onEnd(stats: FlightStats): void;
};

export function createFlightLoop(deps: FlightLoopDeps) {
  const { host, params, terrain, spawn, heldKeys, callsign, onSnapshot, onEnd } = deps;

  // The spawn's trimmed throttle and trim ARE the sampler's starting position — otherwise
  // the player inherits an idle, untrimmed aeroplane a second after the handoff card
  // promised otherwise.
  const sampler = createControlSampler(params, spawn.controls);
  const accumulator = createAccumulator();
  const rateMeter = createRateMeter(2);
  const stats = createStatsAccumulator(spawn.state);

  // Sim state lives HERE, in a closure variable — not in zustand (spec §3).
  let state: SimState = spawn.state;
  let controls = spawn.controls;

  let unsubscribe: (() => void) | null = null;
  let lastWallMs: number | null = null;
  let paused = false;
  let ended = false;
  let sinceSnapshotS = SNAPSHOT_INTERVAL_S; // publish immediately on the first frame
  let terrainClearanceM: number | null = null;

  function publish() {
    const hpr = hprFromQuat(state.attitude, state.position);
    onSnapshot({
      iasMs: state.iasMs,
      tasMs: state.tasMs,
      altitudeM: state.altitudeM,
      verticalSpeedMs: state.verticalSpeedMs,
      headingRad: hpr.headingRad,
      aoaRad: state.aoaRad,
      loadFactor: state.loadFactor,
      throttle: controls.throttle,
      flapLabel: params.flaps[controls.flapDetent].label,
      gear: params.gear,
      stalled: state.stalled,
      overspeed: state.iasMs > params.limits.vneIasMs,
      gLimited: state.gLimited,
      terrainClearanceM,
      terrainUnverified: terrain.unverified,
      simRate: rateMeter.rate(),
      airtimeS: state.timeS,
      classLabel: params.label,
      callsign,
      modelNote: params.modelNote,
    });
  }

  function endSession() {
    ended = true;
    const finished = stats.finish(state, classifyEnd(readImpact(state, params, controls.flapDetent)));
    publish();
    onEnd(finished);
  }

  function stepOnce() {
    if (ended) return;
    controls = sampler.sample(heldKeys, FIXED_DT);
    state = stepAircraft(state, controls, params);
    stats.update(state);

    const geo = ecefToGeodetic(state.position);
    const ground = terrain.sample(geo.latRad, geo.lonRad, state.timeS);
    terrainClearanceM = ground.heightM === null ? null : state.altitudeM - ground.heightM;
    if (ground.collisionArmed && ground.heightM !== null && state.altitudeM <= ground.heightM) {
      endSession();
    }
  }

  function onFrame(wallMs: number) {
    if (lastWallMs === null) {
      lastWallMs = wallMs; // first frame only establishes the clock
      publish();
      return;
    }
    const elapsedS = (wallMs - lastWallMs) / 1000;
    lastWallMs = wallMs;

    if (paused || ended) {
      host.setCamera(state, elapsedS);
      return;
    }

    const { steps } = runFixedSteps(accumulator, elapsedS, stepOnce);
    rateMeter.record(steps * FIXED_DT, elapsedS);
    host.setCamera(state, elapsedS);

    sinceSnapshotS += elapsedS;
    if (sinceSnapshotS >= SNAPSHOT_INTERVAL_S) {
      sinceSnapshotS = 0;
      publish();
    }
  }

  return {
    start() {
      if (unsubscribe) return;
      host.enterFlightView();
      unsubscribe = host.onFrame(onFrame);
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      // Forget the paused wall time so resuming does not simulate it (nor clamp-and-drop it).
      lastWallMs = null;
    },
    stop() {
      if (!unsubscribe) return;
      unsubscribe();
      unsubscribe = null;
      host.exitFlightView();
    },
    isPaused() {
      return paused;
    },
    getState(): SimState {
      return state;
    },
  };
}
```

- [ ] **Step 9: Run to see it pass** — `cd frontend && npm run test -- src/game/flightLoop.test.ts`. Expected: 20 passed. The dive-to-CRASHED case is the slow one (up to 3600 frames); if it needs more time give that `it()` a `15000` timeout rather than shortening the flight.

- [ ] **Step 10: Implement the Cesium host, the visibility auto-pause and the terrain preload** (thin wiring, verified by the Task 12 walkthrough)

```ts
// frontend/src/globe/cesiumFlightHost.ts
/*
 * The Cesium implementation of FlightHost. Frames come from scene.preRender (one callback
 * per rendered frame, already inside Cesium's loop — no second rAF competing with it) and
 * carry performance.now() rather than a Cesium JulianDate, so the sim clock is wall time.
 */
import type { Viewer } from "cesium";
import type { FlightHost } from "../game/flightLoop";
import { createFpvCamera } from "./fpvCamera";

export function createCesiumFlightHost(viewer: Viewer): FlightHost {
  const camera = createFpvCamera(viewer);
  return {
    onFrame(cb) {
      const listener = () => cb(performance.now());
      viewer.scene.preRender.addEventListener(listener);
      return () => viewer.scene.preRender.removeEventListener(listener);
    },
    setCamera(state, dtS) {
      camera.update(state, dtS);
    },
    enterFlightView() {
      camera.enter();
    },
    exitFlightView() {
      camera.exit();
    },
  };
}
```

```ts
// frontend/src/globe/terrainPreload.ts
/*
 * The countdown is load-bearing (spec §4): it exists to get real terrain resident before
 * the aircraft is anywhere near it. `sampleTerrainMostDetailed` walks to the maximum
 * available LOD and needs network round-trips, which is exactly why it happens here during
 * the 3-2-1 and never inside a 60 Hz tick.
 *
 * Two points are requested: the spawn, and where the aircraft will be ten seconds later.
 * Dead reckoning is legitimate for TILE WARMING — it never becomes aircraft state (the
 * "never dead-reckon a stale position" rule in spec §4 is about the spawn snapshot).
 */
import { Cartographic, sampleTerrainMostDetailed, type Viewer } from "cesium";

const EARTH_RADIUS_M = 6371008.8;

export function lookAheadPointRad(
  latRad: number, lonRad: number, headingRad: number, speedMs: number, seconds: number,
): { latRad: number; lonRad: number } {
  const distance = (speedMs * seconds) / EARTH_RADIUS_M; // angular distance
  const lat = Math.asin(
    Math.sin(latRad) * Math.cos(distance) +
      Math.cos(latRad) * Math.sin(distance) * Math.cos(headingRad),
  );
  const lon =
    lonRad +
    Math.atan2(
      Math.sin(headingRad) * Math.sin(distance) * Math.cos(latRad),
      Math.cos(distance) - Math.sin(latRad) * Math.sin(lat),
    );
  return { latRad: lat, lonRad: lon };
}

export async function preloadTerrain(
  viewer: Viewer,
  latRad: number,
  lonRad: number,
  headingRad: number,
  speedMs: number,
  timeoutMs = 3000,
): Promise<{ verified: boolean; terrainHeightM: number | null }> {
  const ahead = lookAheadPointRad(latRad, lonRad, headingRad, speedMs, 10);
  const positions = [
    Cartographic.fromRadians(lonRad, latRad),
    Cartographic.fromRadians(ahead.lonRad, ahead.latRad),
  ];
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const sampled = await Promise.race([
    sampleTerrainMostDetailed(viewer.terrainProvider, positions).catch(() => null),
    timeout,
  ]);
  const height = sampled?.[0]?.height;
  if (typeof height !== "number" || !Number.isFinite(height)) {
    // Timed out or came back undefined: the caller enters FLYING with collision DISARMED
    // and a TERRAIN UNVERIFIED flag. It never enters pretending the ground is known.
    return { verified: false, terrainHeightM: null };
  }
  return { verified: true, terrainHeightM: height };
}
```

- [ ] **Step 11: Add a look-ahead test** — append to `frontend/src/globe/fpvCamera.test.ts`? No: create `frontend/src/globe/terrainPreload.test.ts` (importing only `lookAheadPointRad`, which pulls no Cesium runtime code path in a node test — if the module-level `cesium` import breaks the node run, move `lookAheadPointRad` into `sim/geo.ts` and import it from there in `terrainPreload.ts`).

```ts
// frontend/src/globe/terrainPreload.test.ts
import { describe, it, expect } from "vitest";
import { lookAheadPointRad } from "./terrainPreload";
import { degToRad, radToDeg, ktToMs } from "../sim/units";

describe("lookAheadPointRad", () => {
  it("heading 000 moves north", () => {
    const p = lookAheadPointRad(degToRad(30), degToRad(-88), 0, ktToMs(100), 10);
    expect(radToDeg(p.latRad)).toBeGreaterThan(30);
    expect(radToDeg(p.lonRad)).toBeCloseTo(-88, 6);
  });
  it("heading 090 moves east", () => {
    const p = lookAheadPointRad(degToRad(30), degToRad(-88), degToRad(90), ktToMs(100), 10);
    expect(radToDeg(p.lonRad)).toBeGreaterThan(-88);
    expect(radToDeg(p.latRad)).toBeCloseTo(30, 4);
  });
  it("ten seconds at 100 kt is about half a kilometre", () => {
    const p = lookAheadPointRad(degToRad(30), degToRad(-88), 0, ktToMs(100), 10);
    const metres = (radToDeg(p.latRad) - 30) * 111_195;
    expect(metres).toBeGreaterThan(400);
    expect(metres).toBeLessThan(650);
  });
  it("zero speed does not move", () => {
    const p = lookAheadPointRad(degToRad(30), degToRad(-88), degToRad(45), 0, 10);
    expect(radToDeg(p.latRad)).toBeCloseTo(30, 9);
    expect(radToDeg(p.lonRad)).toBeCloseTo(-88, 9);
  });
});
```

- [ ] **Step 12: Run the new file** — `cd frontend && npm run test -- src/globe/terrainPreload.test.ts`. Expected: 4 passed.

- [ ] **Step 13: Log the loop decisions** — append to `docs/decisions.md`:

```markdown
## 2026-08-05 — B-012 · The flight loop talks to a FlightHost, not to a Viewer

`game/flightLoop.ts` — accumulator, collision test, pause, sim-rate metering, end
classification — is written against a three-method `FlightHost` interface (frame callback,
camera, enter/exit view). `globe/cesiumFlightHost.ts` is the ten-line Cesium implementation.
Same seam, same reason, as `world/terrain.ts`'s injected height sampler: the parts with
decisions in them get unit tests driven by a fake, and the parts that are just Cesium API
calls stay small enough to verify by flying the thing. Twenty flight-loop tests exist
because of this seam; none of them load Cesium.

Two behaviours that came out of writing those tests and are worth stating: RESUME clears
the frame clock rather than carrying it, so a five-minute pause does not arrive as a
clamped-and-dropped 300-second frame; and controls are sampled once per PHYSICS tick while
the camera is driven once per FRAME, so control response does not change with frame rate.
```

- [ ] **Step 14: Full suite + typecheck + commit** — `cd frontend && npm run test && npm run typecheck`. Expected: 309 passed (274 + fpvCamera 11 + flightLoop 20 + terrainPreload 4), typecheck clean. Then:

```bash
git add frontend/src/game frontend/src/globe frontend/src/hud docs/decisions.md && git commit -m "feat(game): fixed-step flight loop on an injectable host, FPV camera, terrain preload"
```

---

### Task 10: HUD — pure formatters plus a dumb overlay

**Files:**
- Create: `frontend/src/hud/format.ts`, `frontend/src/hud/Hud.tsx`
- Test: `frontend/src/hud/format.test.ts`, `frontend/src/hud/Hud.test.tsx`
- Modify: `frontend/src/styles/tokens.css` (append the HUD block)

Every decision lives in `format.ts` and is tested; `Hud.tsx` only arranges strings. It is tested by **calling the component as a function and walking the returned element tree** — React elements are plain objects, so this needs no jsdom and no testing-library (spec §8: "HUD tested as pure formatters + dumb JSX").

**Interfaces:**
- Consumes: `HudSnapshot` from `hud/snapshot.ts`; `msToKt`, `mToFt`, `msToFpm`, `radToDeg` from `sim/units.ts`.
- Produces:
  - `hud/format.ts`: `EM_DASH = "—"`, `TERRAIN_WARNING_FT = 500`, `SIM_RATE_WARNING = 0.95`, and `formatIasKt`, `formatTasKt`, `formatAltFt`, `formatVsiFpm`, `formatHeadingDeg`, `formatAoaDeg`, `formatG`, `formatThrottlePct`, `formatFlaps`, `formatGear`, `formatClearanceFt`, `formatAirtime`, `formatSimRate`, `formatCallsign`, `formatClass`, `warningsFor` — signatures in the code block below.
  - `hud/Hud.tsx`: default export `Hud({ snapshot, terrainNote }: { snapshot: HudSnapshot | null; terrainNote: string })`.

- [ ] **Step 1: Write failing formatter tests**

```ts
// frontend/src/hud/format.test.ts
import { describe, it, expect } from "vitest";
import {
  EM_DASH, TERRAIN_WARNING_FT, SIM_RATE_WARNING,
  formatIasKt, formatTasKt, formatAltFt, formatVsiFpm, formatHeadingDeg, formatAoaDeg,
  formatG, formatThrottlePct, formatFlaps, formatGear, formatClearanceFt, formatAirtime,
  formatSimRate, formatCallsign, formatClass, warningsFor,
} from "./format";
import { ktToMs, ftToM, fpmToMs, degToRad } from "../sim/units";
import type { HudSnapshot } from "./snapshot";

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500),
  verticalSpeedMs: 0, headingRad: 0, aoaRad: degToRad(3), loadFactor: 1,
  throttle: 0.6, flapLabel: "0", gear: "fixed", stalled: false, overspeed: false,
  gLimited: false, terrainClearanceM: ftToM(2000), terrainUnverified: false,
  simRate: 1, airtimeS: 0, classLabel: "C172S", callsign: "SIM-A1B2C3",
  modelNote: "C172 MODEL THIS BUILD",
  ...o,
});

describe("speeds and altitude", () => {
  it("renders whole knots", () => {
    expect(formatIasKt(ktToMs(122.4))).toBe("122");
    expect(formatTasKt(ktToMs(139.6))).toBe("140");
  });
  it("renders whole feet", () => {
    expect(formatAltFt(ftToM(3499.6))).toBe("3500");
  });
  it("renders an em-dash for unknown values rather than a zero", () => {
    expect(formatIasKt(null)).toBe(EM_DASH);
    expect(formatTasKt(null)).toBe(EM_DASH);
    expect(formatAltFt(null)).toBe(EM_DASH);
  });
  it("keeps a legitimate negative altitude (Dead Sea, Schiphol) instead of clamping it", () => {
    expect(formatAltFt(ftToM(-40))).toBe("-40");
  });
});

describe("vertical speed", () => {
  it("signs a climb and a descent", () => {
    expect(formatVsiFpm(fpmToMs(700))).toBe("+700");
    expect(formatVsiFpm(fpmToMs(-1200))).toBe("-1200");
  });
  it("renders level flight as a bare 0, not +0", () => {
    expect(formatVsiFpm(0)).toBe("0");
  });
  it("rounds to the nearest 10 fpm — a needle does not resolve single feet per minute", () => {
    expect(formatVsiFpm(fpmToMs(703))).toBe("+700");
    expect(formatVsiFpm(fpmToMs(-706))).toBe("-710");
  });
  it("em-dashes an unknown vertical speed", () => {
    expect(formatVsiFpm(null)).toBe(EM_DASH);
  });
});

describe("heading", () => {
  it("is always three digits", () => {
    expect(formatHeadingDeg(degToRad(7))).toBe("007");
    expect(formatHeadingDeg(degToRad(90))).toBe("090");
    expect(formatHeadingDeg(degToRad(359))).toBe("359");
  });
  it("wraps 359.6 to 000 rather than printing 360", () => {
    expect(formatHeadingDeg(degToRad(359.6))).toBe("000");
    expect(formatHeadingDeg(degToRad(360))).toBe("000");
  });
  it("normalizes a negative heading", () => {
    expect(formatHeadingDeg(degToRad(-90))).toBe("270");
  });
  it("em-dashes an unknown heading", () => {
    expect(formatHeadingDeg(null)).toBe(EM_DASH);
  });
});

describe("the rest of the readouts", () => {
  it("AoA is one decimal degree, signed", () => {
    expect(formatAoaDeg(degToRad(4.23))).toBe("4.2");
    expect(formatAoaDeg(degToRad(-2.0))).toBe("-2.0");
    expect(formatAoaDeg(null)).toBe(EM_DASH);
  });
  it("g is one decimal, always signed", () => {
    expect(formatG(1)).toBe("+1.0");
    expect(formatG(-0.5)).toBe("-0.5");
    expect(formatG(3.84)).toBe("+3.8");
    expect(formatG(null)).toBe(EM_DASH);
  });
  it("throttle is a whole percent", () => {
    expect(formatThrottlePct(0.755)).toBe("76%");
    expect(formatThrottlePct(0)).toBe("0%");
    expect(formatThrottlePct(null)).toBe(EM_DASH);
  });
  it("flaps and gear read as the panel would", () => {
    expect(formatFlaps("20")).toBe("FLAPS 20");
    expect(formatFlaps(null)).toBe(`FLAPS ${EM_DASH}`);
    expect(formatGear("fixed")).toBe("GEAR FIXED");
    expect(formatGear("retractable")).toBe("GEAR DOWN");
  });
  it("terrain clearance is whole feet, em-dashed when the ground is unknown", () => {
    expect(formatClearanceFt(ftToM(1240))).toBe("1240");
    expect(formatClearanceFt(null)).toBe(EM_DASH);
  });
  it("airtime is mm:ss", () => {
    expect(formatAirtime(0)).toBe("00:00");
    expect(formatAirtime(65)).toBe("01:05");
    expect(formatAirtime(3599)).toBe("59:59");
  });
  it("the callsign is synthetic and uppercase", () => {
    expect(formatCallsign("a1b2c3")).toBe("SIM-A1B2C3");
  });
  it("the aircraft class is uppercase, em-dashed when unknown", () => {
    expect(formatClass("C172S")).toBe("C172S");
    expect(formatClass("c172s")).toBe("C172S");
    expect(formatClass(null)).toBe(EM_DASH);
    expect(formatClass("")).toBe(EM_DASH);
  });
});

describe("formatSimRate", () => {
  it("says nothing while the sim keeps up", () => {
    expect(formatSimRate(1)).toBeNull();
    expect(formatSimRate(SIM_RATE_WARNING)).toBeNull();
  });
  it("says so out loud when it falls behind", () => {
    expect(formatSimRate(0.7)).toBe("SIM RATE 0.7×");
    expect(formatSimRate(0.34)).toBe("SIM RATE 0.3×");
  });
});

describe("warningsFor", () => {
  it("is empty in normal flight", () => {
    expect(warningsFor(snap())).toEqual([]);
  });
  it("reports a stall", () => {
    expect(warningsFor(snap({ stalled: true }))).toContain("STALL");
  });
  it("reports an overspeed", () => {
    expect(warningsFor(snap({ overspeed: true }))).toContain("OVERSPEED");
  });
  it("reports the g limit being reached", () => {
    expect(warningsFor(snap({ gLimited: true }))).toContain("G LIMIT");
  });
  it("reports terrain proximity below 500 ft of clearance", () => {
    expect(warningsFor(snap({ terrainClearanceM: ftToM(TERRAIN_WARNING_FT - 1) }))).toContain("TERRAIN");
    expect(warningsFor(snap({ terrainClearanceM: ftToM(TERRAIN_WARNING_FT + 1) }))).not.toContain("TERRAIN");
  });
  it("reports unverified terrain, which is a different thing from being close to it", () => {
    const w = warningsFor(snap({ terrainUnverified: true }));
    expect(w).toContain("TERRAIN UNVERIFIED");
    expect(w).not.toContain("TERRAIN");
  });
  it("never claims terrain proximity when the ground has never been sampled", () => {
    expect(warningsFor(snap({ terrainClearanceM: null, terrainUnverified: true })))
      .not.toContain("TERRAIN");
  });
  it("reports several at once, stall first", () => {
    const w = warningsFor(snap({ stalled: true, gLimited: true, terrainClearanceM: 10 }));
    expect(w[0]).toBe("STALL");
    expect(w).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `cd frontend && npm run test -- src/hud/format.test.ts`. Expected: "Failed to load url ./format".

- [ ] **Step 3: Implement the formatters**

```ts
// frontend/src/hud/format.ts
/*
 * The display edge. SI comes in, aviation units go out, and this is the ONLY place that
 * conversion happens for the HUD. Unknown is an em-dash, never a zero — the honest-data
 * rule applies to the player's own instruments too.
 */
import type { HudSnapshot } from "./snapshot";
import { msToKt, mToFt, msToFpm, radToDeg } from "../sim/units";

export const EM_DASH = "—";
/** Terrain-proximity warning threshold, feet of clearance. */
export const TERRAIN_WARNING_FT = 500;
/** At or above this sim rate the loop is keeping up and says nothing. */
export const SIM_RATE_WARNING = 0.95;

const dash = (v: number | null | undefined): v is null | undefined =>
  v === null || v === undefined || !Number.isFinite(v as number);

export function formatIasKt(ms: number | null): string {
  return dash(ms) ? EM_DASH : String(Math.round(msToKt(ms)));
}
export function formatTasKt(ms: number | null): string {
  return dash(ms) ? EM_DASH : String(Math.round(msToKt(ms)));
}
export function formatAltFt(m: number | null): string {
  return dash(m) ? EM_DASH : String(Math.round(mToFt(m)));
}

/** Signed, rounded to 10 fpm; level flight reads a bare "0". */
export function formatVsiFpm(ms: number | null): string {
  if (dash(ms)) return EM_DASH;
  const fpm = Math.round(msToFpm(ms) / 10) * 10;
  if (fpm === 0) return "0";
  return fpm > 0 ? `+${fpm}` : String(fpm);
}

/** Three digits, 000-359. 359.6 rounds to 360, which is 000, not "360". */
export function formatHeadingDeg(rad: number | null): string {
  if (dash(rad)) return EM_DASH;
  const deg = Math.round(((radToDeg(rad) % 360) + 360) % 360) % 360;
  return String(deg).padStart(3, "0");
}

export function formatAoaDeg(rad: number | null): string {
  return dash(rad) ? EM_DASH : radToDeg(rad).toFixed(1);
}

export function formatG(n: number | null): string {
  if (dash(n)) return EM_DASH;
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

export function formatThrottlePct(t: number | null): string {
  return dash(t) ? EM_DASH : `${Math.round(t * 100)}%`;
}

export function formatFlaps(label: string | null): string {
  return `FLAPS ${label ?? EM_DASH}`;
}

/** The 172's gear is fixed; the HUD says so rather than offering a control that does nothing. */
export function formatGear(gear: "fixed" | "retractable" | null): string {
  if (gear === "fixed") return "GEAR FIXED";
  if (gear === "retractable") return "GEAR DOWN";
  return `GEAR ${EM_DASH}`;
}

export function formatClearanceFt(m: number | null): string {
  return dash(m) ? EM_DASH : String(Math.round(mToFt(m)));
}

export function formatAirtime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Null when the sim is keeping up; otherwise the honest multiplier. */
export function formatSimRate(rate: number): string | null {
  if (rate >= SIM_RATE_WARNING) return null;
  return `SIM RATE ${rate.toFixed(1)}×`;
}

export function formatCallsign(hex: string): string {
  return `SIM-${hex.toUpperCase()}`;
}

/** Aircraft class beside the callsign (parent spec §9). Em-dash when it is not known. */
export function formatClass(label: string | null): string {
  return label === null || label.length === 0 ? EM_DASH : label.toUpperCase();
}

/**
 * Warnings, most urgent first. TERRAIN (you are close to the ground) and TERRAIN UNVERIFIED
 * (we do not know where the ground is) are deliberately different messages — and proximity
 * is never claimed when clearance is unknown.
 */
export function warningsFor(s: HudSnapshot): string[] {
  const out: string[] = [];
  if (s.stalled) out.push("STALL");
  if (s.overspeed) out.push("OVERSPEED");
  if (s.gLimited) out.push("G LIMIT");
  if (s.terrainUnverified) out.push("TERRAIN UNVERIFIED");
  else if (s.terrainClearanceM !== null && mToFt(s.terrainClearanceM) < TERRAIN_WARNING_FT) {
    out.push("TERRAIN");
  }
  return out;
}
```

- [ ] **Step 4: Run to see it pass** — `cd frontend && npm run test -- src/hud/format.test.ts`. Expected: 30 passed.

- [ ] **Step 5: Write failing HUD-tree tests**

```tsx
// frontend/src/hud/Hud.test.tsx
import { describe, it, expect } from "vitest";
import Hud from "./Hud";
import type { HudSnapshot } from "./snapshot";
import { ktToMs, ftToM, degToRad } from "../sim/units";

/**
 * No jsdom, no testing-library (spec §8) — a React element is a plain object, so we call
 * the component and walk what it returns. This checks the HUD's CONTENT; how it looks is
 * a screenshot question, answered in the Task 12 walkthrough.
 */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  // A local function component (Readout, Row) carries the function itself on `.type` and
  // has no `children` — without invoking it, everything it renders is invisible to this
  // walk and every assertion about those values would pass vacuously.
  if (typeof type === "function") {
    return collectText((type as (p: unknown) => unknown)(props), out);
  }
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(105), tasMs: ktToMs(118), altitudeM: ftToM(3500),
  verticalSpeedMs: 0, headingRad: degToRad(270), aoaRad: degToRad(3), loadFactor: 1,
  throttle: 0.6, flapLabel: "10", gear: "fixed", stalled: false, overspeed: false,
  gLimited: false, terrainClearanceM: ftToM(2000), terrainUnverified: false,
  simRate: 1, airtimeS: 65, classLabel: "C172S", callsign: "SIM-A1B2C3",
  modelNote: "C172 MODEL THIS BUILD",
  ...o,
});

describe("Hud", () => {
  it("shows the SIM banner and the synthetic callsign at all times", () => {
    const text = collectText(Hud({ snapshot: snap(), terrainNote: "RE:EARTH TERRAIN" }));
    expect(text).toContain("SIM");
    expect(text).toContain("SIM-A1B2C3");
  });
  it("shows the aircraft class beside the callsign (spec §9 asks for class AND callsign)", () => {
    const text = collectText(Hud({ snapshot: snap({ classLabel: "C172S" }), terrainNote: "" }));
    expect(text).toContain("C172S");
  });
  it("discloses which flight model is actually flying", () => {
    const text = collectText(Hud({ snapshot: snap(), terrainNote: "" }));
    expect(text).toContain("C172 MODEL THIS BUILD");
  });
  it("shows every §9 readout", () => {
    const text = collectText(Hud({ snapshot: snap(), terrainNote: "" })).join(" ");
    expect(text).toContain("105"); // IAS
    expect(text).toContain("118"); // TAS
    expect(text).toContain("3500"); // altitude
    expect(text).toContain("270"); // heading
    expect(text).toContain("3.0"); // AoA
    expect(text).toContain("+1.0"); // g
    expect(text).toContain("60%"); // throttle
    expect(text).toContain("FLAPS 10");
    expect(text).toContain("GEAR FIXED");
    expect(text).toContain("01:05"); // airtime
  });
  it("shows the required attribution line", () => {
    const text = collectText(Hud({ snapshot: snap(), terrainNote: "RE:EARTH TERRAIN · MAPTERHORN CC BY 4.0" })).join(" ");
    expect(text).toContain("ESRI");
    expect(text).toContain("MAPTERHORN");
  });
  it("shows warnings when they fire", () => {
    const text = collectText(Hud({ snapshot: snap({ stalled: true, overspeed: true }), terrainNote: "" }));
    expect(text).toContain("STALL");
    expect(text).toContain("OVERSPEED");
  });
  it("shows the SIM RATE indicator only when the sim is behind", () => {
    expect(collectText(Hud({ snapshot: snap({ simRate: 1 }), terrainNote: "" })).join(" "))
      .not.toContain("SIM RATE");
    expect(collectText(Hud({ snapshot: snap({ simRate: 0.6 }), terrainNote: "" })).join(" "))
      .toContain("SIM RATE 0.6×");
  });
  it("renders nothing at all without a snapshot", () => {
    expect(Hud({ snapshot: null, terrainNote: "" })).toBeNull();
  });
  it("em-dashes terrain clearance rather than inventing a number", () => {
    const text = collectText(
      Hud({ snapshot: snap({ terrainClearanceM: null, terrainUnverified: true }), terrainNote: "" }),
    ).join(" ");
    expect(text).toContain("—");
    expect(text).toContain("TERRAIN UNVERIFIED");
  });
});
```

- [ ] **Step 6: Run to see it fail** — `cd frontend && npm run test -- src/hud/Hud.test.tsx`. Expected: "Failed to load url ./Hud".

- [ ] **Step 7: Implement the HUD overlay** — dumb JSX only; every string comes from `format.ts`

```tsx
// frontend/src/hud/Hud.tsx
/*
 * The instrument overlay (parent spec §9). No logic beyond arranging strings — every
 * decision about what a number reads is in format.ts, where it is tested.
 *
 * LORAN visual language: monospace, 1px borders, bracket corners, translucent, no radius,
 * no shadows. Amber is the SIM accent and warnings; cyan is nominal data.
 */
import type { HudSnapshot } from "./snapshot";
import {
  formatAirtime, formatAltFt, formatAoaDeg, formatClass, formatClearanceFt, formatFlaps,
  formatG, formatGear, formatHeadingDeg, formatIasKt, formatSimRate, formatTasKt,
  formatThrottlePct, formatVsiFpm, warningsFor,
} from "./format";

function Readout({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="hud-readout">
      <span className="hud-readout-label">{label}</span>
      <span className="hud-readout-value">{value}</span>
      {unit ? <span className="hud-readout-unit">{unit}</span> : null}
    </div>
  );
}

export default function Hud({
  snapshot,
  terrainNote,
}: {
  snapshot: HudSnapshot | null;
  terrainNote: string;
}) {
  if (snapshot === null) return null;
  const warnings = warningsFor(snapshot);
  const simRate = formatSimRate(snapshot.simRate);

  return (
    <div className="hud-root">
      <div className="hud-banner">
        <span className="hud-sim-badge">SIM</span>
        <span>{formatClass(snapshot.classLabel)}</span>
        <span>{snapshot.callsign}</span>
        <span className="hud-model-note">{snapshot.modelNote}</span>
        {simRate ? <span className="hud-warning">{simRate}</span> : null}
      </div>

      <div className="hud-left">
        <Readout label="IAS" value={formatIasKt(snapshot.iasMs)} unit="KT" />
        <Readout label="TAS" value={formatTasKt(snapshot.tasMs)} unit="KT" />
        <Readout label="AOA" value={formatAoaDeg(snapshot.aoaRad)} unit="°" />
        <Readout label="G" value={formatG(snapshot.loadFactor)} />
      </div>

      <div className="hud-right">
        <Readout label="ALT" value={formatAltFt(snapshot.altitudeM)} unit="FT" />
        <Readout label="VSI" value={formatVsiFpm(snapshot.verticalSpeedMs)} unit="FPM" />
        <Readout label="AGL" value={formatClearanceFt(snapshot.terrainClearanceM)} unit="FT" />
        <Readout label="T" value={formatAirtime(snapshot.airtimeS)} />
      </div>

      <div className="hud-heading">
        <span className="hud-readout-label">HDG</span>
        <span className="hud-heading-value">{formatHeadingDeg(snapshot.headingRad)}</span>
      </div>

      <div className="hud-bottom">
        <span>THR {formatThrottlePct(snapshot.throttle)}</span>
        <span>{formatFlaps(snapshot.flapLabel)}</span>
        <span>{formatGear(snapshot.gear)}</span>
      </div>

      {warnings.length > 0 && (
        <div className="hud-warnings">
          {warnings.map((w) => (
            <span key={w} className="hud-warning">{w}</span>
          ))}
        </div>
      )}

      <div className="hud-attribution">
        IMAGERY © ESRI · {terrainNote} · TRAFFIC: AIRPLANES.LIVE / ADSB.LOL / ADSB.FI
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Add the HUD styles** — append to `frontend/src/styles/tokens.css`:

```css
/* ---- HUD: instrumentation over the globe. Amber is the SIM accent, cyan is nominal. ---- */
.hud-root {
  position: absolute;
  inset: 0;
  pointer-events: none; /* the globe stays clickable underneath */
  font-family: var(--mono);
  font-size: 12px;
  color: var(--cyan);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.hud-banner {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 10px;
  border: 1px solid var(--amber);
  background: rgba(5, 7, 10, 0.72);
  color: var(--amber);
}
.hud-sim-badge {
  font-weight: 700;
  letter-spacing: 0.24em;
}
.hud-model-note {
  color: var(--text);
  opacity: 0.75;
  font-size: 10px;
}
.hud-left { position: absolute; top: 25%; left: 16px; }
.hud-right { position: absolute; top: 25%; right: 16px; text-align: right; }
.hud-bottom {
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 20px;
}
.hud-heading {
  position: absolute;
  top: 44px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.hud-heading-value { font-size: 20px; }
.hud-readout {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 0;
}
.hud-right .hud-readout { justify-content: flex-end; }
.hud-readout-label { font-size: 10px; opacity: 0.7; min-width: 28px; }
.hud-readout-value { font-size: 18px; }
.hud-readout-unit { font-size: 10px; opacity: 0.7; }
.hud-warnings {
  position: absolute;
  top: 46%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
}
.hud-warning {
  color: var(--amber);
  border: 1px solid var(--amber);
  padding: 2px 8px;
  background: rgba(5, 7, 10, 0.72);
}
.hud-attribution {
  position: absolute;
  bottom: 6px;
  left: 12px;
  font-size: 9px;
  color: var(--text);
  opacity: 0.65;
  letter-spacing: 0.04em;
}
```

- [ ] **Step 9: Run to see it pass** — `cd frontend && npm run test -- src/hud/Hud.test.tsx`. Expected: 9 passed.

- [ ] **Step 10: Log the heading-tape simplification** — the HUD ships a three-digit numeric heading, not a sliding tape. Append to `docs/decisions.md`:

```markdown
## 2026-08-05 — B-013 · The heading readout is numeric this phase; the tape is backlogged

Parent spec §9 asks for a heading TAPE (and a VSI tape). Phase B ships three-digit numeric
readouts instead: `HDG 270`, `VSI +700`. The information content is identical and every
honesty rule still applies (000–359 with the 359.6→000 wrap, em-dash when unknown, all
pinned in `hud/format.test.ts`); what is missing is the moving-scale presentation, which is
a drawing job with no new data behind it and no bearing on whether the aeroplane flies.
Deferred to Phase E polish alongside the chase cam. Recorded here rather than left as a
silent gap between the spec and the build.

Aircraft class, the other half of spec §9's "class + synthetic callsign", **is** present:
`HudSnapshot.classLabel` carries `params.label` and the HUD renders it in the SIM banner
next to `SIM-<HEX>`.
```

- [ ] **Step 11: Full suite + typecheck + commit** — `cd frontend && npm run test && npm run typecheck`. Expected: 348 passed (309 + format 30 + Hud 9), typecheck clean. Then:

```bash
git add frontend/src/hud frontend/src/styles docs/decisions.md && git commit -m "feat(hud): pure display-edge formatters and the SIM instrument overlay"
```

---

### Task 11: Takeover UI, ghost, pause and quit — the session wired end to end

This is the integration task: after it, the game is flyable.

**Files:**
- Create: `frontend/src/game/FlightSession.tsx`, `frontend/src/panels/HandoffCard.tsx`, `frontend/src/panels/PauseOverlay.tsx`, `frontend/src/globe/ghost.ts`
- Test: `frontend/src/globe/ghost.test.ts`, `frontend/src/panels/HandoffCard.test.tsx`, `frontend/src/panels/PauseOverlay.test.tsx`, `frontend/src/globe/contactBillboards.test.ts` (add cases for the new pure helper)
- Modify: `frontend/src/globe/contactBillboards.ts` (contacts render at `alt_geom`, ghost dimming), `frontend/src/globe/ContactLayer.tsx` (pass the ghost hex and sync the ghost label), `frontend/src/panels/ContactList.tsx` (lines 67–73 — the TAKE CONTROLS button becomes real), `frontend/src/App.tsx` (mount `FlightSession`), `frontend/src/styles/tokens.css` (cards and overlays), `docs/decisions.md` (append B-014)

**Interfaces:**
- Consumes: `checkEligibility` from `takeover/eligibility.ts`; `buildSpawnState`, `SpawnResult`, `SpawnAdjustment` from `takeover/spawn.ts`; `preloadTerrain` from `globe/terrainPreload.ts`; `createTerrainService` from `world/terrain.ts`; `createFlightLoop` from `game/flightLoop.ts`; `createCesiumFlightHost` from `globe/cesiumFlightHost.ts`; `createKeyboard` from `input/keyboard.ts`; `loadC172` from `sim/params.ts`; `hudSnapshot` from `hud/snapshot.ts`; `useViewer` from `globe/viewerContext.ts`; `formatCallsign` from `hud/format.ts`; `useStore` from `state/store.ts`; `Contact` and `FeedStatus` from `data/types.ts`; `hprFromQuat` from `sim/quat.ts` (the handoff card's heading readout); `contactHeightM` from `globe/contactBillboards.ts` (the ghost label's position); `GameEvent` from `game/machine.ts`.
- Produces:
  - `globe/ghost.ts`: `ghostLabelText(contact: Contact | undefined, feedStatus: FeedStatus): string`, `syncGhostLabel(labels: LabelCollection, ref: { label: Label | null }, contact: Contact | undefined, feedStatus: FeedStatus): void`, plus a re-export of `GHOST_ALPHA`.
  - `globe/contactBillboards.ts` additions: `GHOST_ALPHA = 0.35`, `contactHeightM(c: Contact): number | null`, `renderableContacts(contacts: Map<string, Contact>): Map<string, Contact>`; `syncBillboards` gains an optional fifth parameter `opts?: { ghostHex?: string | null }`.
  - `panels/HandoffCard.tsx`: default export `HandoffCard({ contact, spawn, countdown, note }: { contact: Contact; spawn: SpawnResult | null; countdown: number | null; note: string })`.
  - `panels/PauseOverlay.tsx`: default export `PauseOverlay({ armed, onArmResume, onQuit }: { armed: boolean; onArmResume(): void; onQuit(): void })` — RESUME only *arms* the resume; the canvas click is what continues the flight (spec §6).
  - `game/FlightSession.tsx`: default export `FlightSession()` — the orchestrator; renders the HUD, handoff card, pause overlay and (Task 12) the end card.

- [ ] **Step 1: Write failing tests for contact heights and the ghost label**

```ts
// append to frontend/src/globe/contactBillboards.test.ts
import { contactHeightM, renderableContacts } from "./contactBillboards";
import { ftToM } from "../sim/units";

describe("contactHeightM", () => {
  it("converts alt_geom feet to metres — Phase A drew everything at height 0, under real terrain", () => {
    expect(contactHeightM(contact("a"))).toBeCloseTo(ftToM(3500), 6);
  });
  it("is null when alt_geom is missing (alt_baro is the wrong datum for a 3D position)", () => {
    expect(contactHeightM({ ...contact("a"), alt_geom: null })).toBeNull();
  });
  it("is null for a contact on the ground", () => {
    expect(contactHeightM({ ...contact("a"), alt_geom: null, alt_baro: "ground" })).toBeNull();
  });
  it("keeps a legitimate negative altitude", () => {
    expect(contactHeightM({ ...contact("a"), alt_geom: -50 })).toBeCloseTo(ftToM(-50), 6);
  });
});

describe("renderableContacts", () => {
  it("skips contacts with no usable height rather than burying them at zero", () => {
    const map = new Map([
      ["a", contact("a")],
      ["b", { ...contact("b"), alt_geom: null }],
    ]);
    expect([...renderableContacts(map).keys()]).toEqual(["a"]);
  });
  it("returns a new map and leaves the input alone", () => {
    const map = new Map([["a", contact("a")]]);
    expect(renderableContacts(map)).not.toBe(map);
    expect(map.size).toBe(1);
  });
});
```

```ts
// frontend/src/globe/ghost.test.ts
import { describe, it, expect } from "vitest";
import { ghostLabelText } from "./ghost";
import { GHOST_ALPHA } from "./contactBillboards";
import type { Contact } from "../data/types";

const contact = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30, lon: -88,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 4, ...o,
});

describe("ghostLabelText", () => {
  it("shows the age of the real contact's last position", () => {
    expect(ghostLabelText(contact({ seen_pos: 34 }), "live")).toBe("GHOST · AGE 34S");
  });
  it("rounds a fractional age to whole seconds", () => {
    expect(ghostLabelText(contact({ seen_pos: 3.7 }), "live")).toBe("GHOST · AGE 4S");
  });
  it("reads NO DATA when the contact has left the feed", () => {
    expect(ghostLabelText(undefined, "live")).toBe("GHOST · NO DATA");
  });
  it("reads NO DATA when the feed itself is stale or offline — an old age would be a lie", () => {
    expect(ghostLabelText(contact({ seen_pos: 2 }), "stale")).toBe("GHOST · NO DATA");
    expect(ghostLabelText(contact({ seen_pos: 2 }), "offline")).toBe("GHOST · NO DATA");
  });
  it("reads NO DATA when seen_pos itself is missing", () => {
    expect(ghostLabelText(contact({ seen_pos: null }), "live")).toBe("GHOST · NO DATA");
  });
});

describe("ghost styling", () => {
  it("is dimmed, not hidden — the real aircraft is still real", () => {
    expect(GHOST_ALPHA).toBeGreaterThan(0);
    expect(GHOST_ALPHA).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run to see them fail** — `cd frontend && npm run test -- src/globe/contactBillboards.test.ts src/globe/ghost.test.ts`. Expected: `contactHeightM` is not exported; `./ghost` does not resolve.

- [ ] **Step 3: Implement the contact-height helpers and ghost dimming** — edit `frontend/src/globe/contactBillboards.ts`

```ts
// add to the imports
import { ftToM } from "../sim/units";

/** Ghost billboards are dimmed, not hidden — the real aircraft is still real. */
export const GHOST_ALPHA = 0.35;

/**
 * Height for a contact's billboard, in metres above the ellipsoid. `alt_geom` only:
 * it is WGS84-ellipsoidal, the same datum as the terrain, so a contact placed with it sits
 * where it actually is. `alt_baro` is pressure altitude and would put aircraft at the wrong
 * height over real relief, so a contact without alt_geom is not drawn on the globe at all
 * (it still appears in the contact list, with its baro altitude, honestly labelled).
 */
export function contactHeightM(c: Contact): number | null {
  return c.alt_geom === null ? null : ftToM(c.alt_geom);
}

/** The subset of contacts that can be placed in 3D. */
export function renderableContacts(contacts: Map<string, Contact>): Map<string, Contact> {
  const out = new Map<string, Contact>();
  for (const [hex, c] of contacts) {
    if (contactHeightM(c) !== null) out.set(hex, c);
  }
  return out;
}
```

  and change `syncBillboards` to take the ghost option, filter, and use the real height:

```ts
export function syncBillboards(
  collection: BillboardCollection,
  byHex: Map<string, Billboard>,
  contacts: Map<string, Contact>,
  selectedHex: string | null,
  opts: { ghostHex?: string | null } = {},
): void {
  const drawable = renderableContacts(contacts);
  const { added, removed, kept } = diffContacts(new Set(byHex.keys()), drawable);
  const ghostHex = opts.ghostHex ?? null;

  for (const hex of removed) {
    const bb = byHex.get(hex);
    if (bb) collection.remove(bb);
    byHex.delete(hex);
  }

  for (const hex of added) {
    const c = drawable.get(hex)!;
    const bb = collection.add({
      id: hex,
      position: Cartesian3.fromDegrees(c.lon, c.lat, contactHeightM(c)!),
      rotation: contactRotationRad(c.track),
      color: hex === ghostHex ? Color.WHITE.withAlpha(GHOST_ALPHA) : Color.WHITE,
      scale: scaleFor(hex, selectedHex),
    });
    applyIcon(bb, c);
    byHex.set(hex, bb);
  }

  for (const hex of kept) {
    const c = drawable.get(hex)!;
    const bb = byHex.get(hex)!;
    bb.position = Cartesian3.fromDegrees(c.lon, c.lat, contactHeightM(c)!);
    bb.rotation = contactRotationRad(c.track);
    applyIcon(bb, c);
    bb.scale = scaleFor(hex, selectedHex);
    // The origin aircraft keeps flying on the live feed, dimmed — it is still real.
    bb.color = hex === ghostHex ? Color.WHITE.withAlpha(GHOST_ALPHA) : Color.WHITE;
  }
}
```

- [ ] **Step 4: Implement the ghost label**

```ts
// frontend/src/globe/ghost.ts
/*
 * The ghost (owner decision B-4, ground rule 2 taken literally): after takeover the REAL
 * aircraft keeps polling and keeps rendering, dimmed, with an honest staleness label — so
 * the player watches their synthetic flight diverge from the real one.
 *
 * The label never claims freshness it does not have: an age is shown only when the feed
 * itself is LIVE and the contact reported a position age. Otherwise it reads NO DATA.
 */
import { Cartesian2, Color, LabelStyle, VerticalOrigin, type Label, type LabelCollection } from "cesium";
import { Cartesian3 } from "cesium";
import type { Contact, FeedStatus } from "../data/types";
import { contactHeightM } from "./contactBillboards";

/**
 * Re-exported so callers have one import for everything ghost-shaped. It LIVES in
 * contactBillboards.ts — that is the module that applies it to a billboard — and importing
 * it in this direction keeps the dependency acyclic (ghost -> contactBillboards, never back).
 */
export { GHOST_ALPHA } from "./contactBillboards";

export function ghostLabelText(contact: Contact | undefined, feedStatus: FeedStatus): string {
  if (!contact || feedStatus !== "live" || contact.seen_pos === null) return "GHOST · NO DATA";
  return `GHOST · AGE ${Math.round(contact.seen_pos)}S`;
}

/** Create, move or remove the single ghost label. Mutated in place, never rebuilt. */
export function syncGhostLabel(
  labels: LabelCollection,
  ref: { label: Label | null },
  contact: Contact | undefined,
  feedStatus: FeedStatus,
): void {
  const height = contact ? contactHeightM(contact) : null;
  if (!contact || height === null) {
    if (ref.label) {
      labels.remove(ref.label);
      ref.label = null;
    }
    return;
  }
  const position = Cartesian3.fromDegrees(contact.lon, contact.lat, height);
  const text = ghostLabelText(contact, feedStatus);
  if (ref.label === null) {
    ref.label = labels.add({
      position,
      text,
      font: "11px monospace",
      fillColor: Color.fromCssColorString("#ffb000").withAlpha(0.8),
      style: LabelStyle.FILL,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -18),
    });
    return;
  }
  ref.label.position = position;
  ref.label.text = text;
}
```

- [ ] **Step 5: Run to see them pass** — `cd frontend && npm run test -- src/globe/contactBillboards.test.ts src/globe/ghost.test.ts`. Expected: contactBillboards 9 passed (3 Phase A + 6 new), ghost 6 passed.

- [ ] **Step 6: Wire the ghost into `ContactLayer`** — edit `frontend/src/globe/ContactLayer.tsx`

```tsx
// add to the imports
import { useRef } from "react";
import type { Label } from "cesium";
import { syncGhostLabel } from "./ghost";

// inside the component, alongside the existing store reads
  const origin = useStore((s) => s.origin);
  const feedStatus = useStore((s) => s.feedStatus);
  const ghostLabelRef = useRef<{ label: Label | null }>({ label: null });

// replace the billboard-sync effect
  useEffect(() => {
    if (!bundle) return;
    syncBillboards(bundle.billboards, bundle.byHex, contacts, selectedHex, {
      ghostHex: origin?.hex ?? null,
    });
    syncGhostLabel(
      bundle.labels,
      ghostLabelRef.current,
      origin ? contacts.get(origin.hex) : undefined,
      feedStatus,
    );
  }, [bundle, contacts, selectedHex, origin, feedStatus]);
```

- [ ] **Step 7: Write failing handoff-card tests** (same call-the-component technique as the HUD)

```tsx
// frontend/src/panels/HandoffCard.test.tsx
import { describe, it, expect } from "vitest";
import HandoffCard from "./HandoffCard";
import { buildSpawnState } from "../takeover/spawn";
import { loadC172 } from "../sim/params";
import type { Contact } from "../data/types";

const P = loadC172();
const ga = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "P28A", lat: 30.6944, lon: -88.0399,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  // Local function components (Row) must be invoked or their text is invisible here.
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

const render = (props: Parameters<typeof HandoffCard>[0]) => collectText(HandoffCard(props)).join(" ");

describe("HandoffCard", () => {
  const spawn = buildSpawnState(ga(), P, { terrainHeightM: 20 });

  it("shows the snapshot the flight was built from", () => {
    const text = render({ contact: ga(), spawn, countdown: 3, note: "" });
    expect(text).toContain("N12345");
    expect(text).toContain("3500");
    expect(text).toContain("105");
    expect(text).toContain("270");
  });
  it("shows the REAL type from the feed, not the model that will fly", () => {
    expect(render({ contact: ga({ t: "P28A" }), spawn, countdown: 3, note: "" })).toContain("P28A");
  });
  it("discloses the model actually flying", () => {
    expect(render({ contact: ga(), spawn, countdown: 3, note: "" })).toContain("C172 MODEL THIS BUILD");
  });
  it("shows the synthetic callsign", () => {
    expect(render({ contact: ga(), spawn, countdown: 3, note: "" })).toContain("SIM-A1B2C3");
  });
  it("prints every adjustment verbatim — from, to and reason", () => {
    const clamped = buildSpawnState(ga({ gs: 30 }), P, { terrainHeightM: 20 });
    const text = render({ contact: ga({ gs: 30 }), spawn: clamped, countdown: 3, note: "" });
    expect(clamped.adjustments.length).toBeGreaterThan(0);
    for (const a of clamped.adjustments) {
      expect(text).toContain(a.field);
      expect(text).toContain(a.from);
      expect(text).toContain(a.to);
      expect(text).toContain(a.reason);
    }
  });
  it("says so when nothing was adjusted, instead of leaving an ambiguous blank", () => {
    expect(render({ contact: ga(), spawn, countdown: 3, note: "" })).toContain("NO ADJUSTMENTS");
  });
  it("shows the countdown", () => {
    expect(render({ contact: ga(), spawn, countdown: 2, note: "" })).toContain("2");
  });
  it("shows a status note while the spawn is still being built", () => {
    expect(render({ contact: ga(), spawn: null, countdown: null, note: "ACQUIRING TERRAIN…" }))
      .toContain("ACQUIRING TERRAIN");
  });
  it("discloses that ground speed stands in for true airspeed", () => {
    expect(render({ contact: ga(), spawn, countdown: 3, note: "" })).toMatch(/GROUND SPEED/i);
  });
});
```

- [ ] **Step 8: Run to see it fail** — `cd frontend && npm run test -- src/panels/HandoffCard.test.tsx`. Expected: "Failed to load url ./HandoffCard".

- [ ] **Step 9: Implement the handoff card and the pause overlay**

```tsx
// frontend/src/panels/HandoffCard.tsx
/*
 * The handoff moment (spec §4). Everything on this card is either a value straight from
 * the feed or a disclosure about what the sim is about to do differently. The adjustments
 * list is printed verbatim from buildSpawnState — clamping is legal, silent clamping is not.
 */
import type { Contact } from "../data/types";
import type { SpawnResult } from "../takeover/spawn";
import { formatCallsign } from "../hud/format";
import { mToFt, msToKt, radToDeg } from "../sim/units";
import { hprFromQuat } from "../sim/quat";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="handoff-row">
      <span className="label">{label}</span>
      <span className="handoff-value">{value}</span>
    </div>
  );
}

export default function HandoffCard({
  contact,
  spawn,
  countdown,
  note,
}: {
  contact: Contact;
  spawn: SpawnResult | null;
  countdown: number | null;
  note: string;
}) {
  const heading =
    spawn === null
      ? "—"
      : String(
          Math.round(((radToDeg(hprFromQuat(spawn.state.attitude, spawn.state.position).headingRad) % 360) + 360) % 360),
        ).padStart(3, "0");

  return (
    <div className="handoff-card panel">
      <div className="label handoff-title">TAKE CONTROLS</div>

      <Row label="CONTACT" value={contact.flight ?? "—"} />
      <Row label="HEX" value={contact.hex.toUpperCase()} />
      <Row label="TYPE (FEED)" value={contact.t ?? "—"} />
      <Row label="ALTITUDE" value={spawn === null ? "—" : `${Math.round(mToFt(spawn.state.altitudeM))} FT`} />
      <Row label="SPEED" value={spawn === null ? "—" : `${Math.round(msToKt(spawn.state.tasMs))} KT`} />
      <Row label="HEADING" value={heading} />
      <Row label="CALLSIGN" value={formatCallsign(contact.hex)} />

      <div className="handoff-disclosure">
        FLYING THE {spawn === null ? "—" : "C172 MODEL THIS BUILD"} · GROUND SPEED IS USED AS
        TRUE AIRSPEED (STILL AIR) · ALTITUDE FROM{" "}
        {spawn === null ? "—" : spawn.altitudeSource === "alt_geom" ? "ALT_GEOM" : "ALT_BARO"}
      </div>

      <div className="label handoff-title">ADJUSTMENTS</div>
      {spawn === null || spawn.adjustments.length === 0 ? (
        <div className="handoff-adjustment">NO ADJUSTMENTS — SNAPSHOT FLOWN AS RECEIVED</div>
      ) : (
        spawn.adjustments.map((a, i) => (
          <div className="handoff-adjustment" key={`${a.field}-${i}`}>
            <span className="handoff-adjust-field">{a.field}</span>
            <span>
              {a.from} → {a.to}
            </span>
            <span className="handoff-adjust-reason">{a.reason}</span>
          </div>
        ))
      )}

      {note ? <div className="handoff-note">{note}</div> : null}
      {countdown !== null ? <div className="handoff-countdown">{countdown}</div> : null}
    </div>
  );
}
```

```tsx
// frontend/src/panels/PauseOverlay.tsx
/*
 * Esc pauses (spec §6). It cannot be made to mean "quit": Esc always exits pointer lock and
 * Chrome rate-limits re-locking, so pause is the only honest thing it can do.
 *
 * Resuming is deliberately TWO steps, because spec §6 requires the resume gesture to be a
 * canvas click: RESUME arms it and steps the overlay out of the way, and flight only
 * continues when the player actually clicks the globe. The armed state has to say so on
 * screen, or a dismissed overlay just looks like a frozen game.
 */
export default function PauseOverlay({
  armed,
  onArmResume,
  onQuit,
}: {
  /** True once RESUME has been pressed and we are waiting for the canvas click. */
  armed: boolean;
  onArmResume(): void;
  onQuit(): void;
}) {
  if (armed) {
    return (
      <div className="pause-overlay pause-overlay-armed">
        <div className="panel pause-card">
          <div className="label">CLICK THE GLOBE TO RESUME</div>
          <button className="control-button" onClick={onQuit}>
            QUIT TO BROWSE
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="pause-overlay">
      <div className="panel pause-card">
        <div className="label">PAUSED</div>
        <button className="control-button" onClick={onArmResume}>
          RESUME
        </button>
        <button className="control-button" onClick={onQuit}>
          QUIT TO BROWSE
        </button>
      </div>
    </div>
  );
}
```

  and its test — the two-step contract is exactly the sort of thing that silently collapses
  back into a one-click resume, so it gets pinned:

```tsx
// frontend/src/panels/PauseOverlay.test.tsx
import { describe, it, expect } from "vitest";
import PauseOverlay from "./PauseOverlay";

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

/** Walk the tree collecting every onClick handler, in render order. */
function collectHandlers(node: unknown, out: Array<() => void> = []): Array<() => void> {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) collectHandlers(c, out); return out; }
  const props = (node as { props?: { onClick?: () => void; children?: unknown } }).props;
  if (props?.onClick) out.push(props.onClick);
  if (props && "children" in props) collectHandlers(props.children, out);
  return out;
}

describe("PauseOverlay", () => {
  it("offers RESUME and QUIT while paused", () => {
    const text = collectText(PauseOverlay({ armed: false, onArmResume: () => {}, onQuit: () => {} }));
    expect(text).toContain("PAUSED");
    expect(text).toContain("RESUME");
    expect(text).toContain("QUIT TO BROWSE");
  });
  it("RESUME only ARMS the resume — it does not fly again on its own", () => {
    let armCalls = 0;
    const tree = PauseOverlay({ armed: false, onArmResume: () => { armCalls++; }, onQuit: () => {} });
    collectHandlers(tree)[0]();
    expect(armCalls).toBe(1);
  });
  it("once armed it asks for the canvas click, per spec §6", () => {
    const text = collectText(PauseOverlay({ armed: true, onArmResume: () => {}, onQuit: () => {} })).join(" ");
    expect(text).toContain("CLICK THE GLOBE TO RESUME");
    expect(text).not.toContain("PAUSED");
  });
  it("QUIT is still reachable from the armed state (never a dead end)", () => {
    const text = collectText(PauseOverlay({ armed: true, onArmResume: () => {}, onQuit: () => {} }));
    expect(text).toContain("QUIT TO BROWSE");
  });
});
```

- [ ] **Step 10: Run to see it pass** — `cd frontend && npm run test -- src/panels/HandoffCard.test.tsx src/panels/PauseOverlay.test.tsx`. Expected: HandoffCard 9 passed, PauseOverlay 4 passed.

- [ ] **Step 11: Make the TAKE CONTROLS button real** — edit `frontend/src/panels/ContactList.tsx`, replacing the disabled-button block (lines 67–73)

```tsx
// add to the imports
import { checkEligibility } from "../takeover/eligibility";

// inside the component, after the existing store reads
  const selected = selectedHex === null ? null : contacts.get(selectedHex) ?? null;
  const eligibility = checkEligibility(selected);

// replace the button block
      {selectedHex !== null && (
        <div className="p-2">
          <button
            disabled={!eligibility.eligible}
            title={eligibility.eligible ? "Take controls of this contact" : eligibility.reason}
            className={eligibility.eligible ? "control-button w-full" : "control-button-disabled w-full"}
            onClick={() => {
              // Freeze the snapshot NOW: applyFetch nulls selectedHex the moment the
              // contact leaves the feed, and the origin must survive that (spec §4).
              if (!eligibility.eligible || selected === null) return;
              useStore.getState().setOrigin({ hex: selected.hex, snapshot: { ...selected } });
              useStore.getState().fire("TAKE_CONTROLS");
            }}
          >
            TAKE CONTROLS
          </button>
          {!eligibility.eligible && <div className="label takeover-reason">{eligibility.reason}</div>}
        </div>
      )}
```

- [ ] **Step 12: Implement the session orchestrator**

```tsx
// frontend/src/game/FlightSession.tsx
/*
 * The one place the pieces meet. It owns the mutable, non-React things a flight needs —
 * keyboard, terrain service, flight loop — creates them on entering COUNTDOWN and tears
 * every one of them down on the way back to BROWSE, so QUIT leaves no residue (spec §6).
 *
 * The countdown is load-bearing: terrain is preloaded during it, and FLYING is entered
 * either on a defined terrain sample or with collision DISARMED and TERRAIN UNVERIFIED on
 * the HUD. It never enters pretending the ground is known.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "../state/store";
import type { GameEvent } from "./machine";
import { useViewer } from "../globe/viewerContext";
import { loadC172 } from "../sim/params";
import { buildSpawnState, type SpawnResult } from "../takeover/spawn";
import { createTerrainService, type TerrainService } from "../world/terrain";
import { createKeyboard } from "../input/keyboard";
import { createCesiumFlightHost } from "../globe/cesiumFlightHost";
import { createFlightLoop } from "./flightLoop";
import { preloadTerrain } from "../globe/terrainPreload";
import { hudSnapshot } from "../hud/snapshot";
import { formatCallsign } from "../hud/format";
import Hud from "../hud/Hud";
import HandoffCard from "../panels/HandoffCard";
import PauseOverlay from "../panels/PauseOverlay";
import { degToRad, ktToMs } from "../sim/units";

const COUNTDOWN_FROM = 3;
const PRELOAD_TIMEOUT_MS = 3000;

export default function FlightSession() {
  const bundle = useViewer();
  const mode = useStore((s) => s.mode);
  const origin = useStore((s) => s.origin);

  const [spawn, setSpawn] = useState<SpawnResult | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [note, setNote] = useState("");
  /** RESUME pressed, waiting for the canvas click that spec §6 requires. */
  const [resumeArmed, setResumeArmed] = useState(false);

  const loopRef = useRef<ReturnType<typeof createFlightLoop> | null>(null);
  const keyboardRef = useRef<ReturnType<typeof createKeyboard> | null>(null);
  const terrainRef = useRef<TerrainService | null>(null);

  const snapshot = useSyncExternalStore(hudSnapshot.subscribe, hudSnapshot.get, hudSnapshot.get);

  /** Tear down every mutable thing a flight owns. Safe to call more than once. */
  function teardown() {
    loopRef.current?.stop();
    loopRef.current = null;
    keyboardRef.current?.dispose();
    keyboardRef.current = null;
    terrainRef.current = null;
    hudSnapshot.set(null);
    setSpawn(null);
    setCountdown(null);
    setNote("");
    setResumeArmed(false);
  }

  /**
   * Leaving always goes through the machine, so an event that is illegal from the current
   * mode is refused rather than teleporting the app to BROWSE from somewhere it should not.
   */
  function leaveToBrowse(event: GameEvent) {
    useStore.getState().fire(event);
    teardown();
    useStore.getState().clearSession();
  }

  // ---- COUNTDOWN: preload terrain, build the spawn, tick 3-2-1, then fly ----
  useEffect(() => {
    if (mode !== "COUNTDOWN" || !bundle || !origin) return;
    let cancelled = false;
    const params = loadC172();
    const contact = origin.snapshot;
    setNote("ACQUIRING TERRAIN…");

    void (async () => {
      const preload = await preloadTerrain(
        bundle.viewer,
        degToRad(contact.lat),
        degToRad(contact.lon),
        degToRad(contact.track ?? 0),
        ktToMs(contact.gs ?? 0),
        PRELOAD_TIMEOUT_MS,
      );
      if (cancelled) return;

      const built = buildSpawnState(contact, params, { terrainHeightM: preload.terrainHeightM });
      setSpawn(built);
      setNote(preload.verified ? "" : "TERRAIN UNVERIFIED — COLLISION DISARMED");

      const terrain = createTerrainService(bundle.heightSampler);
      if (!preload.verified) terrain.disarm();
      terrainRef.current = terrain;

      const keyboard = createKeyboard(window);
      keyboardRef.current = keyboard;

      setCountdown(COUNTDOWN_FROM);
      let remaining = COUNTDOWN_FROM;
      const timer = setInterval(() => {
        remaining -= 1;
        if (cancelled) return;
        if (remaining > 0) {
          setCountdown(remaining);
          return;
        }
        clearInterval(timer);
        setCountdown(null);

        const loop = createFlightLoop({
          host: createCesiumFlightHost(bundle.viewer),
          params,
          terrain,
          spawn: built,
          heldKeys: keyboard.held,
          callsign: formatCallsign(contact.hex),
          onSnapshot: (s) => hudSnapshot.set(s),
          onEnd: (stats) => {
            loopRef.current?.stop();
            useStore.getState().setEndStats(stats);
            useStore.getState().fire("IMPACT");
          },
        });
        loopRef.current = loop;
        loop.start();
        useStore.getState().fire("COUNTDOWN_DONE");
      }, 1000);

      return () => clearInterval(timer);
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, bundle, origin]);

  // ---- Esc pauses; visibilitychange auto-pauses (spec §5, §6) ----
  useEffect(() => {
    if (mode !== "FLYING" && mode !== "PAUSED") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      if (useStore.getState().mode === "FLYING") {
        loopRef.current?.pause();
        setResumeArmed(false);
        useStore.getState().fire("PAUSE");
      }
    };
    const onVisibility = () => {
      if (document.hidden && useStore.getState().mode === "FLYING") {
        loopRef.current?.pause();
        setResumeArmed(false);
        useStore.getState().fire("PAUSE");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode]);

  // ---- the armed resume waits for a click on the globe itself (spec §6) ----
  useEffect(() => {
    if (mode !== "PAUSED" || !resumeArmed || !bundle) return;
    const canvas = bundle.viewer.scene.canvas;
    const onClick = () => {
      loopRef.current?.resume();
      setResumeArmed(false);
      useStore.getState().fire("RESUME");
    };
    canvas.addEventListener("click", onClick);
    return () => canvas.removeEventListener("click", onClick);
  }, [mode, resumeArmed, bundle]);

  // ---- returning to BROWSE from anywhere tears the flight down ----
  useEffect(() => {
    if (mode === "BROWSE") teardown();
    // teardown is intentionally not a dependency: it closes over refs, not state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  if (mode === "BROWSE") return null;

  return (
    <>
      {mode === "COUNTDOWN" && origin && (
        <HandoffCard contact={origin.snapshot} spawn={spawn} countdown={countdown} note={note} />
      )}
      {(mode === "FLYING" || mode === "PAUSED" || mode === "ENDED") && (
        <Hud snapshot={snapshot} terrainNote={bundle?.terrainNote ?? ""} />
      )}
      {mode === "PAUSED" && (
        <PauseOverlay
          armed={resumeArmed}
          onArmResume={() => setResumeArmed(true)}
          onQuit={() => leaveToBrowse("QUIT")}
        />
      )}
    </>
  );
}
```

- [ ] **Step 13: Mount it** — edit `frontend/src/App.tsx`, adding `FlightSession` inside `ViewerHost` next to `ContactLayer`:

```tsx
import FlightSession from "./game/FlightSession";
// ...
          <ViewerHost>
            <ContactLayer />
            <FlightSession />
          </ViewerHost>
```

- [ ] **Step 14: Add the card and overlay styles** — append to `frontend/src/styles/tokens.css`:

```css
/* ---- an enabled console control (the disabled twin is above) ---- */
.control-button {
  border: 1px solid var(--cyan);
  background: transparent;
  color: var(--cyan);
  padding: 6px 8px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 11px;
  font-family: var(--mono);
  cursor: pointer;
  border-radius: 0;
}
.control-button:hover { background: rgba(95, 215, 224, 0.12); }
.takeover-reason { color: var(--amber); padding-top: 4px; }

/* ---- handoff card ---- */
.handoff-card {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 460px;
  max-height: 80%;
  overflow-y: auto;
  padding: 12px 14px;
  font-size: 12px;
  pointer-events: auto;
}
.handoff-title { color: var(--amber); padding: 6px 0; }
.handoff-row { display: flex; justify-content: space-between; padding: 2px 0; }
.handoff-value { color: var(--cyan); }
.handoff-disclosure {
  border-top: 1px solid var(--grid);
  border-bottom: 1px solid var(--grid);
  margin: 8px 0;
  padding: 8px 0;
  font-size: 10px;
  color: var(--text);
  letter-spacing: 0.04em;
}
.handoff-adjustment {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-left: 2px solid var(--amber);
  padding: 4px 0 4px 8px;
  margin-bottom: 6px;
  font-size: 11px;
}
.handoff-adjust-field { color: var(--amber); }
.handoff-adjust-reason { color: var(--text); opacity: 0.75; font-size: 10px; }
.handoff-note { color: var(--amber); padding-top: 6px; font-size: 11px; }
.handoff-countdown {
  text-align: center;
  font-size: 44px;
  color: var(--amber);
  padding-top: 8px;
}

/* ---- pause / end overlays ---- */
.pause-overlay,
.end-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 7, 10, 0.55);
  pointer-events: auto;
}
/* Armed: the player has to reach the canvas underneath, so the backdrop stops intercepting
   clicks and moves out of the middle of the screen. Only its own buttons stay clickable. */
.pause-overlay-armed {
  align-items: flex-start;
  background: transparent;
  pointer-events: none;
}
.pause-overlay-armed .pause-card {
  margin-top: 96px;
  pointer-events: auto;
}
.pause-card,
.end-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 20px;
  min-width: 280px;
}
```

- [ ] **Step 15: Log the wiring decisions** — append to `docs/decisions.md`:

```markdown
## 2026-08-05 — B-014 · Contacts render at alt_geom only, and the ghost never fakes freshness

Two honesty calls in the takeover wiring:

**Globe contacts are placed at `alt_geom` (ellipsoidal), converted ft→m, and contacts
without `alt_geom` are not drawn on the globe at all.** Phase A drew every contact at
height 0, which was invisible under real terrain the moment Phase B attached Re:Earth.
`alt_baro` is pressure altitude — the wrong datum for a 3D position — so substituting it
would put aircraft at plausible-looking wrong heights. Those contacts still appear in the
contact list with their baro altitude, where the number is honest.

**The ghost label shows an age only when the feed is LIVE and the contact reported one.**
When the contact drops out of the feed, or the feed goes STALE/OFFLINE, it reads
`GHOST · NO DATA` rather than a frozen age that would keep looking fresh. The billboard is
dimmed to 35% alpha and stays on the globe — the real aircraft is still real.
```

- [ ] **Step 16: Full suite + typecheck + commit** — `cd frontend && npm run test && npm run typecheck`. Expected: 373 passed (348 + contactBillboards 6 + ghost 6 + HandoffCard 9 + PauseOverlay 4), typecheck clean. Then:

```bash
git add -A frontend/src docs/decisions.md && git commit -m "feat(takeover): handoff card, countdown, ghost, pause overlay and quit-to-browse"
```

---

### Task 12: End card, orbit, README, and the acceptance walkthrough

**Files:**
- Create: `frontend/src/panels/EndCard.tsx`
- Test: `frontend/src/panels/EndCard.test.tsx`
- Modify: `frontend/src/game/FlightSession.tsx` (render the end card, re-enable orbit), `frontend/src/panels/StatusBar.tsx` (show the terrain source), `README.md` (status, controls, what Phase B added)

**Interfaces:**
- Consumes: `FlightStats` from `game/stats.ts`; `formatAirtime`, `formatAltFt`, `formatIasKt`, `formatG` from `hud/format.ts`.
- Produces: `panels/EndCard.tsx`: default export `EndCard({ stats, onExit }: { stats: FlightStats; onExit(): void })`.

- [ ] **Step 1: Write failing end-card tests**

```tsx
// frontend/src/panels/EndCard.test.tsx
import { describe, it, expect } from "vitest";
import EndCard from "./EndCard";
import type { FlightStats } from "../game/stats";
import { ktToMs, ftToM } from "../sim/units";

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  // Local function components (Row) must be invoked or their text is invisible here.
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

const stats = (o: Partial<FlightStats> = {}): FlightStats => ({
  airtimeS: 185,
  distanceM: 12_500,
  maxIasMs: ktToMs(141),
  maxAltitudeM: ftToM(5200),
  maxG: 2.4,
  impactSinkFpm: 940,
  impactIasMs: ktToMs(72),
  classification: "CRASHED",
  ...o,
});

const render = (s: FlightStats) => collectText(EndCard({ stats: s, onExit: () => {} })).join(" ");

describe("EndCard", () => {
  it("leads with the classification", () => {
    expect(render(stats({ classification: "CRASHED" }))).toContain("CRASHED");
    expect(render(stats({ classification: "LANDED" }))).toContain("LANDED");
  });
  it("shows every stat the spec asks for", () => {
    const text = render(stats());
    expect(text).toContain("03:05"); // airtime
    expect(text).toContain("141"); // max IAS
    expect(text).toContain("5200"); // max altitude
    expect(text).toContain("+2.4"); // max g
    expect(text).toContain("940"); // impact sink
    expect(text).toContain("72"); // impact speed
  });
  it("shows distance flown in nautical miles", () => {
    const text = render(stats({ distanceM: 18_520 })); // exactly 10 nm
    expect(text).toContain("10.0");
    expect(text).toContain("NM");
  });
  it("offers the way back to BROWSE", () => {
    expect(render(stats())).toContain("EXIT TO BROWSE");
  });
  it("tells the player the site can be orbited", () => {
    expect(render(stats())).toMatch(/ORBIT|DRAG/i);
  });
  it("handles a zero-length flight without NaN", () => {
    const text = render(stats({ airtimeS: 0, distanceM: 0, maxG: 1, impactSinkFpm: 0 }));
    expect(text).not.toContain("NaN");
    expect(text).toContain("00:00");
  });
});
```

- [ ] **Step 2: Run to see it fail** — `cd frontend && npm run test -- src/panels/EndCard.test.tsx`. Expected: "Failed to load url ./EndCard".

- [ ] **Step 3: Implement the end card**

```tsx
// frontend/src/panels/EndCard.tsx
/*
 * End of session (parent spec §5, owner decision B-5). Not a freeze frame: the default
 * mouse controls are back on behind this card so the impact or landing site can be orbited.
 */
import type { FlightStats } from "../game/stats";
import { formatAirtime, formatAltFt, formatG, formatIasKt } from "../hud/format";

const M_PER_NM = 1852;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="handoff-row">
      <span className="label">{label}</span>
      <span className="handoff-value">{value}</span>
    </div>
  );
}

export default function EndCard({
  stats,
  onExit,
}: {
  stats: FlightStats;
  onExit(): void;
}) {
  return (
    <div className="end-overlay">
      <div className="panel end-card">
        <div className="label handoff-title">{stats.classification}</div>
        <Row label="AIRTIME" value={formatAirtime(stats.airtimeS)} />
        <Row label="DISTANCE" value={`${(stats.distanceM / M_PER_NM).toFixed(1)} NM`} />
        <Row label="MAX IAS" value={`${formatIasKt(stats.maxIasMs)} KT`} />
        <Row label="MAX ALT" value={`${formatAltFt(stats.maxAltitudeM)} FT`} />
        <Row label="MAX G" value={formatG(stats.maxG)} />
        <Row label="IMPACT SINK" value={`${Math.round(stats.impactSinkFpm)} FPM`} />
        <Row label="IMPACT SPEED" value={`${formatIasKt(stats.impactIasMs)} KT`} />
        <div className="handoff-disclosure">DRAG TO ORBIT THE SITE</div>
        <button className="control-button" onClick={onExit}>
          EXIT TO BROWSE
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render it and re-enable orbit** — edit `frontend/src/game/FlightSession.tsx`:

```tsx
// add to the imports
import EndCard from "../panels/EndCard";

// add to the store reads
  const endStats = useStore((s) => s.endStats);

// on entering ENDED, hand the mouse back so the site can be orbited (owner decision B-5).
// The FPV camera stops driving setView because the loop has already stopped.
  useEffect(() => {
    if (mode !== "ENDED" || !bundle) return;
    bundle.viewer.scene.screenSpaceCameraController.enableInputs = true;
  }, [mode, bundle]);

// add to the returned tree, after the PAUSED block
      {mode === "ENDED" && endStats && (
        <EndCard stats={endStats} onExit={() => leaveToBrowse("EXIT_END")} />
      )}
```

- [ ] **Step 5: Show the terrain source in the status bar** — edit `frontend/src/panels/StatusBar.tsx`, replacing the static Esri line so attribution names what actually attached:

```tsx
// add to the imports
import { useViewer } from "../globe/viewerContext";

// inside the component
  const bundle = useViewer();

// replace the last span
      <span>IMAGERY © ESRI · {bundle?.terrainNote ?? "TERRAIN LOADING…"}</span>
```

- [ ] **Step 6: Run the new tests** — `cd frontend && npm run test -- src/panels/EndCard.test.tsx`. Expected: 6 passed.

- [ ] **Step 7: Full suite + typecheck** — `cd frontend && npm run test && npm run typecheck`. Expected: 379 passed (373 + EndCard 6), typecheck clean. Also run the backend suite to confirm nothing drifted: `cd backend && .venv/bin/python -m pytest tests/ -q`.

- [ ] **Step 8: Update the README** — replace the "Status" line and add a controls section:

```markdown
**Status: Phase B (First Flyable) complete.** Pick a real GA-piston contact off the live
browse globe, TAKE CONTROLS, and fly a C172S first-person over real Esri imagery and real
Re:Earth terrain until you land, crash, or quit. The approved specs live at
[`docs/superpowers/specs/2026-07-27-adsb-game-design.md`](docs/superpowers/specs/2026-07-27-adsb-game-design.md)
and [`docs/superpowers/specs/2026-08-05-phase-b-first-flyable-design.md`](docs/superpowers/specs/2026-08-05-phase-b-first-flyable-design.md).

## Controls

Desktop keyboard only in this build.

| Key | Action |
|---|---|
| `↑` / `↓` | pitch down / pitch up |
| `←` / `→` | roll left / roll right |
| `A` / `D` | rudder left / right |
| `W` / `S` (or `+` / `-`) | throttle up / down |
| `F` / `V` | flaps down / up (0 · 10 · 20 · 30) |
| `,` / `.` | trim nose down / nose up |
| `G` | gear — the C172's gear is fixed, so this reads GEAR FIXED |
| `Esc` | pause (RESUME / QUIT TO BROWSE) |

Takeover is restricted to civil GA-piston contacts this build (see
`frontend/src/params/ga-types.json`); the disabled button says which gate a contact failed.
All of them fly the C172S parameter set, which the handoff card discloses. Every clamp the
sim applies to a snapshot is listed on that card before you fly.
```

- [ ] **Step 9: The acceptance walkthrough (spec §9)** — `bash scripts/dev.sh`, open http://localhost:5173, and walk every line of it. Screenshot each numbered checkpoint for sign-off.

  1. **Browse** — globe over Esri imagery with real terrain relief; contacts appear at their real altitudes (tilt the camera and confirm they sit above the ground, not buried in it); status bar reads `LIVE <source>` and names the terrain source.
  2. **Gate** — select a non-GA contact (an airliner). TAKE CONTROLS is disabled and states the gate: `TYPE B738 NOT GA PISTON`. Select a military contact if one is up: `MILITARY CONTACT`.
  3. **Handoff** — select a real GA contact (C172/P28A/SR22/…). TAKE CONTROLS enables. Click it. The card shows the callsign, hex, the **real** type from the feed, the snapshot altitude/speed/heading, `SIM-<HEX>`, `C172 MODEL THIS BUILD`, the ground-speed-as-TAS disclosure, and either `NO ADJUSTMENTS` or the clamps verbatim.
  4. **Countdown** — `ACQUIRING TERRAIN…` then 3 · 2 · 1. If terrain does not resolve in 3 s, the card says `TERRAIN UNVERIFIED — COLLISION DISARMED` and the HUD carries that warning throughout.
  5. **Handover fidelity** — at the instant control passes, the throttle is NOT at idle and the aircraft is not lurching: it holds roughly the snapshot speed and altitude hands-off for the first few seconds. That is `buildSpawnState`'s trimmed handover reaching the control sampler.
  6. **HUD content** — the SIM banner carries `SIM` + the class (`C172S`) + `SIM-<HEX>`; heading reads as three digits and wraps 359→000 rather than showing 360; IAS/TAS/ALT/VSI/AGL/AoA/G/THR/FLAPS/GEAR all read and move; `GEAR FIXED`; the attribution line names Esri and Re:Earth/Mapterhorn.
  7. **Flying** — the view is first-person from the cockpit. Fly a circuit: pitch, roll and rudder all respond; `W` spools the throttle; `F` steps the flaps and the stall speed drops; `,`/`.` trims and the aircraft settles at a new speed hands-off. **Check the roll sign**: `→` must put the right wing down and the horizon must tilt the same way. If it is mirrored, fix the sign in `hprFromQuat`/`quatFromHpr` — never by inverting the input.
  8. **Ghost** — the real aircraft is still on the globe, dimmed, labelled `GHOST · AGE nS`, and diverging from you. Other live traffic is still rendering.
  9. **Warnings** — pull to the stall and confirm `STALL` fires and the break is soft (mushy, recoverable) rather than a cliff. Dive toward terrain and confirm `TERRAIN` fires under 500 ft of clearance.
  10. **Pause and the two-step resume** — `Esc` shows the overlay and the sim stops (airtime stops advancing). Press RESUME: the overlay steps aside and reads `CLICK THE GLOBE TO RESUME`, and the sim is **still paused**. Click the globe: flight continues with no jump. Alt-tabbing away auto-pauses. (This is spec §6's canvas-click resume — a one-click RESUME would be the regression to watch for.)
  11. **End** — land it gently (under 600 fpm, wings level, near stall speed) or fly it into a hill. The stats card shows the classification, airtime, distance, max IAS/alt/g and the impact sink and speed. **Drag the mouse: the site orbits.**
  12. **Quit, twice** — EXIT TO BROWSE. The globe returns to the browse view, the contact list is back, the ghost dimming is gone, the HUD is gone, the mouse controls the globe again, and the feed is still LIVE. Then take controls of a **second** contact and fly it: nothing from the first session leaks in (no stale ghost, no stuck key, no carried-over stats, no doubled loop).

- [ ] **Step 10: Record what the walkthrough showed** — if any checkpoint failed, fix it and re-run the full suite before continuing. If a checkpoint revealed something real but out of scope, add it to `docs/decisions.md` as a documented Phase B limitation (the Phase A entry is the format to follow) rather than silently leaving it.

- [ ] **Step 11: Commit and stop** —

```bash
git add -A && git commit -m "feat(game): end card with orbit, terrain source in the status bar, Phase B README"
```

  Then **stop and wait for owner sign-off** (CLAUDE.md ground rule 5). Show: the full test run output, and the screenshots from Step 9.

---

## Definition of done

- [ ] `cd frontend && npm run test` → **379 passed** (26 Phase A + 353 Phase B), 0 failed.
- [ ] `cd frontend && npm run typecheck` → clean.
- [ ] `cd backend && .venv/bin/python -m pytest tests/ -q` → still green (unchanged this phase).
- [ ] `grep -rn "from \"cesium\"\|from 'cesium'" frontend/src/sim frontend/src/world frontend/src/input frontend/src/takeover frontend/src/game/machine.ts frontend/src/game/classify.ts frontend/src/game/stats.ts frontend/src/game/simRate.ts frontend/src/game/flightLoop.ts frontend/src/hud/format.ts` → **no matches**.
- [ ] `git diff --stat main -- frontend/package.json` → no dependency lines added.
- [ ] All twelve acceptance checkpoints walked (12.9), screenshots captured.
- [ ] `docs/decisions.md` carries B-006 … B-014.
- [ ] Stopped, waiting for sign-off.

## Spec coverage map

Every requirement in `2026-08-05-phase-b-first-flyable-design.md`, and where it lands.

| Spec | Requirement | Task.Step |
|---|---|---|
| §1 B-1 | merged sim core + FPV in one phase | the whole plan |
| §1 B-2 | C172S only | 1.14 (`c172.json`), 3.6 |
| §1 B-3 | GA-only takeover | 5.1 (`ga-types.json`), 5.4 |
| §1 B-4 | minimal ghost ships now | 11.4, 11.6 |
| §1 B-5 | end card allows orbiting | 12.3, 12.4 |
| §3 | `sim/` zero Cesium imports | 2.3 (`geo.ts` instead of `Ellipsoid.WGS84`), Done-list grep |
| §3 | `params/`, `input/`, `takeover/`, `world/`, `game/`, `hud/` layout | 1, 4, 5, 7, 6, 10 |
| §3 | sim state in a ref, zustand holds mode/origin/endStats | 6.15, 9.8 |
| §3 | StrictMode double-mount safe | 8.3 |
| §3 | Viewer + polling hoist; one Viewer for all modes | 8.3–8.5 |
| §3 | terrain attaches at app start | 8.3, 7.5 |
| §4 | eligibility gate, disabled button states the gate | 5.4, 11.11 |
| §4 | frozen origin snapshot independent of `selectedHex` | 6.13, 11.11 |
| §4 | `buildSpawnState` pure; alt_geom preferred | 5.8 |
| §4 | alt_baro → clamp to terrain + 300 m and label | 5.8 |
| §4 | ceiling and `[1.3 Vs, 0.9 Vne]` clamps in `adjustments[]` | 5.8 |
| §4 | handoff card: snapshot, real type, model note, adjustments verbatim | 11.9 |
| §4 | countdown preloads terrain; timeout → collision disarmed + flag | 9.10, 11.12 |
| §5 | lift, parabolic polar, soft post-stall rolloff | 2.11 |
| §5 | power-limited thrust, ISA, still air | 2.11, 1.12 |
| §5 | body→ECEF quaternion, renormalized, HPR only at the boundary | 2.7 |
| §5 | gravity from the geodetic surface normal; Coriolis ignored, documented | 2.3, 2.11, 2.21 |
| §5 | one rAF/preRender + `performance.now()`, dt clamp, 15 steps | 2.15, 9.8, 9.10 |
| §5 | `visibilitychange` auto-pause | 11.12 |
| §5 | honest `SIM RATE 0.7×` | 6.11, 10.3, 9.8 |
| §5 | elevator trim, 2 keys | 4.7, 2.11 |
| §5 | limits clamp + warn only | 2.11 (g clamp), 3.8 (Vne warn-only) |
| §6 | FPV `setView`, 5–15 Hz low pass, eye offset | 9.3 |
| §6 | `enableInputs = false`, `near ≈ 1 m`, `depthTestAgainstTerrain` | 9.3 |
| §6 | Esc = pause overlay, RESUME/QUIT | 11.9, 11.12 |
| §6 | resume requires a canvas click (two-step: RESUME arms, click resumes) | 11.9 (`PauseOverlay` + its test), 11.12 (canvas listener), 12.9 checkpoint 10 |
| §6 | QUIT → BROWSE with no residue | 11.12 (`teardown`), 12.9 step 10 |
| §6 | HUD per §9 + gear FIXED + flap detents + SIM RATE | 10.3, 10.7 |
| §6/§9 | class + synthetic callsign in the SIM banner | 10.3 (`formatClass`), 10.7, 9.8 (`classLabel`) |
| §9 (parent) | heading/VSI **tape** | **Not shipped** — numeric readouts instead, logged as a deliberate v1 simplification in 10.10 (decisions B-013); tape deferred to Phase E |
| §6 | contacts at `alt_geom`, skipped when null | 11.3 |
| §6 | ghost dimmed + `GHOST · AGE Ns` / `NO DATA` | 11.4 |
| §6 | other live traffic stays visible | 8.4, 11.6 |
| §7 | terrain contact ends the session | 9.8 |
| §7 | LANDED/CRASHED per §5 thresholds | 6.7 |
| §7 | ENDED stats card with orbit enabled | 12.3, 12.4 |
| §7 | stats: airtime, distance, max IAS/alt/g, impact sink + speed | 6.11, 12.3 |
| §7 | exit → BROWSE | 12.4 |
| §8 | envelope: cruise, Vs1, Vne, g clamp | 3.1 |
| §8 | `buildSpawnState`: units, clamps, adjustments, alt_baro path | 5.6 |
| §8 | eligibility predicate + failure reason | 5.2 |
| §8 | LANDED/CRASHED table incl. exact boundaries | 6.5 |
| §8 | key set → control vector: simultaneous, blur, ramp | 4.1, 4.5 |
| §8 | accumulator vs synthetic dt incl. 30 s gap | 2.13, 9.6 |
| §8 | quaternion: 360° roll, 60k drift, ±89° round-trip, 4 known attitudes | 2.5 |
| §8 | ISA vs table; terrain service with injected `getHeight` | 1.10, 7.1 |
| §8 | HUD formatters (fpm, 359→000, em-dash) | 10.1 |
| §8 | HUD as pure formatters + dumb JSX, no jsdom dep | 10.5 |
| §9 | acceptance walkthrough + screenshots, then stop | 12.9, 12.11 |





