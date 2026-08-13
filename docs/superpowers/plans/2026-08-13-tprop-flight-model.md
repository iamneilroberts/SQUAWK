# Turboprop Flight Model (`tprop`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `tprop` (Beechcraft King Air 350 / B300-class twin turboprop) flight model so light/mid turboprop ADS-B contacts — King Air, PC-12, Caravan, TBM — become takeover-eligible and fly a believable turboprop model instead of `UNSUPPORTED AIRCRAFT TYPE`.

**Architecture:** `tprop` is the second of three new archetypes from the multi-aircraft spec (after `biz`). It is **data, not code**: a new `ClassParams` JSON drives the same Cesium-free 6-DOF model as the existing classes. A turboprop is a **power-limited propeller** like the C172 — it uses the shared prop thrust formula `T = η·P/max(V, propPeakSpeedMs)` unchanged — but its engine is a **turbine**, which holds shaft power with altitude far better than the C172's piston (Gagg-Ferrar) lapse. **The one design decision (spec §4): the lapse model.** Task 1 first tries `lapseModel: "piston"` and measures the envelope; if the ~35,000 ft service ceiling can't be hit plausibly (the piston lapse retains only ~22% shaft power at FL350, giving the King Air a far-too-low ceiling), Task 1 **adds a new `turboprop` lapse variant** to `POWER_LAPSE_MODELS` — a flat-rated-to-a-corner-then-density-lapse shape (structurally identical to `turbofanPowerLapse` but applied to shaft power), reusing the per-class corner mechanism `biz` added. This is **additive** (a new lapse key + new module function): `piston`, `turbofan`, `none` stay byte-identical — much lower risk than `biz`'s shared-constant change. Build order otherwise mirrors `biz`: green data/physics first (string-keyed, no type change), then ONE compiler-guided task flips the `AircraftClassId` union and fills every consumer.

**Tech Stack:** Vite · React 18 + TypeScript · Zustand · Vitest. Physics in `frontend/src/sim/` (SI units, fixed 60 Hz, no Cesium imports). Params/profiles are hand-validated JSON (no schema library).

## Global Constraints

- **No new runtime dependency** (spec §14 gate). Validators are hand-written.
- **`sim/` stays Cesium-free and fully unit-tested.** A new class = new JSON + one envelope test, never a physics branch ("class differences are data, not branches"). The `turboprop` lapse is the ONE physics-code touch — additive, keyed by `propulsion.lapseModel` data, not a class `if`.
- **Non-GA performance numbers need source verification** (CLAUDE.md). Every `tprop.json` number carries a `sources` entry marked TUNING KNOB vs sourced (source verification pending where not yet cited against a King Air 350 POH / type certificate). A `docs/decisions.md` entry cites the representative airframe + figures + the lapse-model decision.
- **Live prod branch** (`mongols-rich-hud` → fly.voygent.app). Gate before every commit: `cd frontend && npm run typecheck && npm run test:unit && npm run lint` (lint ≤8 warnings; 5 pre-existing — add none).
- **`aero.speedbrakeCd0` is required** by `validateClassParams` (checked with `num()`, not `positive()`, so 0 is legal). The King Air 350 has **no airbrake/spoiler**, so `speedbrakeCd0` is honestly **0** and the KeyB speedbrake toggle is inert for this class — note this in `sources`.
- **Representative airframe:** Beechcraft King Air 350 / B300-class twin turboprop (~310 kt cruise TAS, 2× flat-rated PT6A-class turboprop, retractable gear, ~35,000 ft ceiling). Decided in the design spec.
- Class id string is exactly `tprop`. Display label `TURBOPROP · KING AIR-CLASS MODEL`.
- **Bucket scope (spec decision B):** `tprop` = light/mid turboprops ONLY (King Air, PC-12, Caravan, TBM). **Regional Q400/DH8D and ATR/AT72/AT76 STAY in the airliner (`b738`) bucket** — verified already present in `airliner-types.json`; do NOT move them. Saab 340 (SF34) / Saab 2000 (SB20) are regional turboprops → stay airliner-adjacent, EXCLUDE from `tprop`. PC-24 (PC24) and Cirrus Vision (SF50, already in `biz-types.json`) are jets → EXCLUDE from `tprop`.

---

### Task 1: Turboprop flight params + performance envelope + the lapse-model decision

**Files:**
- Create: `frontend/src/params/tprop.json`
- Modify: `frontend/src/sim/params.ts` (add `loadTprop()` + cache + `case "tprop"` in `loadClassById`; and — IF the lapse decision requires it — add `"turboprop"` to the `LAPSE_MODELS` validator array)
- Modify (IF the lapse decision requires it): `frontend/src/sim/types.ts` (`LapseModel` union), `frontend/src/sim/forces.ts` (`turbopropPowerLapse` + `POWER_LAPSE_MODELS.turboprop`)
- Test: `frontend/src/sim/tprop-envelope.test.ts`

**Interfaces:**
- Consumes: `validateClassParams` / `loadClassById` (params.ts); `dragCoefficient`, `thrustNewtons` (forces.ts); `stepAircraft`, `refreshDerived` (aircraft.ts); `isaDensity`, `machNumber`, `iasToTas` (isa.ts) — all already exist and are class-agnostic (parametrised on `ClassParams`).
- Produces: `loadTprop(): ClassParams`; `loadClassById("tprop")` returns the validated turboprop params. `id` field is `"tprop"`. Optionally a new `turboprop` `LapseModel` shared by any future turboprop class.

- [ ] **Step 1: Write the failing envelope test.** Mirror `b738-envelope.test.ts` — copy the parametrised helpers `levelFlightExcessThrustN`, `maxLevelSpeedMs`, `bestClimbRateMs`, `levelState`, `flyAndMeasure`, **and `trimForLevelFlight` verbatim** (they already take `params`). **KEEP the `trimForLevelFlight` helper and its trimmed-level-flight test** — unlike the `biz` plan (which dropped its trim helper as unused), `tprop` verifies trim authority end-to-end. The scan bands in `maxLevelSpeedMs`/`bestClimbRateMs` (10–400 / 30–380 m/s) already cover the turboprop's slower band. Assert plausibility, not exact values (spec §6):

```ts
import { describe, it, expect } from "vitest";
import { loadTprop } from "./params";
import { dragCoefficient, thrustNewtons } from "./forces";
import { isaDensity, machNumber, iasToTas } from "./isa";
import { stepAircraft, refreshDerived } from "./aircraft";
import { geodeticToEcef } from "./geo";
import { quatFromHpr, qRotate } from "./quat";
import { degToRad, ftToM, ktToMs, msToFpm } from "./units";
import type { ClassParams, ControlVector, SimState } from "./types";

const P = loadTprop();
const G0 = 9.80665;
const LAT = degToRad(30.6944);
const LON = degToRad(-88.0399);
// ...copy levelFlightExcessThrustN / maxLevelSpeedMs / bestClimbRateMs / levelState /
//    flyAndMeasure / trimForLevelFlight from b738-envelope.test.ts verbatim...

describe("TPROP envelope — cruise", () => {
  it("trims near ~310 kt cruise TAS at FL280", () => {
    const alt = ftToM(28000);
    const tas = maxLevelSpeedMs(P, alt, 0.9); // turboprop cruise is near full power
    const kt = tas / ktToMs(1);
    expect(kt).toBeGreaterThan(270);
    expect(kt).toBeLessThan(345);
  });
  it("the integrator agrees with the force balance: trimmed level flight holds cruise TAS", () => {
    const alt = ftToM(28000);
    const analytic = maxLevelSpeedMs(P, alt, 0.9);
    const trim = trimForLevelFlight(P, alt, 0.9, analytic);
    const controls: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle: 0.9, flapDetent: 0, trim, gearDown: false, afterburner: false };
    const flown = flyAndMeasure(P, levelState(P, alt, analytic, controls), controls, 180);
    expect(Math.abs(flown.dAltM)).toBeLessThan(300); // held altitude over 3 min
    const kt = flown.meanTasMs / ktToMs(1);
    expect(kt).toBeGreaterThan(260);
    expect(kt).toBeLessThan(345);
  });
});

describe("TPROP envelope — limits", () => {
  it("clean stall speed sits in the turboprop band (~75-90 kt) at sea level", () => {
    // Vstall = sqrt(2 W / (rho S CLmax)); CLmax = cl0 + clAlphaPerRad*stallAlphaRad (clean).
    const clMax = P.aero.cl0 + P.aero.clAlphaPerRad * P.aero.stallAlphaRad;
    const vStallMs = Math.sqrt((2 * P.massKg * G0) / (isaDensity(0) * P.wingAreaM2 * clMax));
    const vStallKt = vStallMs / ktToMs(1);
    expect(vStallKt).toBeGreaterThan(75);
    expect(vStallKt).toBeLessThan(90);
  });
  it("climbs strongly at sea level and barely at the service ceiling", () => {
    expect(msToFpm(bestClimbRateMs(P, 0, 1))).toBeGreaterThan(1800);
    const ceilFpm = msToFpm(bestClimbRateMs(P, P.limits.serviceCeilingM, 1));
    expect(ceilFpm).toBeGreaterThan(0);
    expect(ceilFpm).toBeLessThan(500);
  });
  it("Vne (263 KIAS) is above cruise IAS, so a trimmed cruise does not overspeed", () => {
    const alt = ftToM(28000);
    const cruiseTas = maxLevelSpeedMs(P, alt, 0.9);
    const cruiseIas = tasToIasKt(cruiseTas, alt); // = tasToIas then /ktToMs(1); or use iasToTas inverse
    expect(cruiseTas).toBeLessThan(iasToTas(P.limits.vneIasMs, alt)); // cruise TAS < Vne-as-TAS at altitude
  });
  it("g clamps at the class limit and reaches it from a fast entry", () => {
    const controls: ControlVector = { pitch: 1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: 1, gearDown: false, afterburner: false };
    let s = levelState(P, ftToM(15000), ktToMs(250), controls);
    let maxG = 0, sawLimit = false;
    for (let i = 0; i < 600; i++) { s = stepAircraft(s, controls, P); maxG = Math.max(maxG, s.loadFactor); if (s.gLimited) sawLimit = true; }
    expect(sawLimit).toBe(true);
    expect(maxG).toBeCloseTo(P.limits.gLimitPos, 6);
  });
  it("never produces NaN across a control sweep", () => {
    const controls: ControlVector = { pitch: 0.6, roll: 0.6, yaw: 0.6, throttle: 1, flapDetent: 2, trim: 1, gearDown: false, afterburner: false, speedbrake: false };
    let s = levelState(P, ftToM(20000), ktToMs(200), controls);
    for (let i = 0; i < 3600; i++) s = stepAircraft(s, controls, P);
    expect(Number.isFinite(s.tasMs)).toBe(true);
    expect(Number.isFinite(s.loadFactor)).toBe(true);
  });
});
```

> Note on the Vne test: the `tasToIasKt` line above is pseudocode — implement the Vne check with the `iasToTas` helper already imported (compare `maxLevelSpeedMs(...)` TAS against `iasToTas(P.limits.vneIasMs, alt)`), the same direction the b738 test uses `iasToTas`. Drop the pseudocode helper; keep only the `expect(cruiseTas).toBeLessThan(iasToTas(...))` assertion.

- [ ] **Step 2: Run it, verify it fails.** Run: `cd frontend && npx vitest run src/sim/tprop-envelope.test.ts`. Expected: FAIL — `loadTprop` is not exported.

- [ ] **Step 3: Create `frontend/src/params/tprop.json`** with these starting values (internally consistent; **initially `lapseModel: "piston"`** to run the lapse decision in Step 6). Numbers are King Air 350 / B300-class starting points — tune against the envelope test in Step 5/7, keep `sources` honest (TUNING KNOB vs sourced, "source verification pending" where not yet cited against a POH/type-cert):

```json
{
  "id": "tprop",
  "label": "TPROP",
  "modelNote": "KING AIR-CLASS MODEL",
  "massKg": 5700,
  "wingAreaM2": 28.8,
  "wingSpanM": 17.65,
  "aspectRatio": 10.8,
  "aero": {
    "cl0": 0.30, "clAlphaPerRad": 5.5, "stallAlphaRad": 0.28, "postStallDecayRad": 0.16,
    "cd0": 0.028, "gearDragCd0": 0.02, "speedbrakeCd0": 0.0, "oswaldE": 0.80, "cyBeta": -0.70
  },
  "control": {
    "rollRateMaxRadS": 0.7, "pitchRateMaxRadS": 0.30, "yawRateMaxRadS": 0.18,
    "rollDampingPerS": 3.0, "pitchDampingPerS": 2.5, "yawDampingPerS": 2.0,
    "pitchStiffnessPerS2": 3.0, "yawStiffnessPerS2": 2.2, "refDynamicPressurePa": 3500,
    "trimAlphaCenterRad": 0.03, "trimAlphaRangeRad": 0.14
  },
  "propulsion": {
    "maxPowerW": 1566000, "lapseModel": "piston", "propEfficiency": 0.85,
    "propPeakSpeedMs": 100, "afterburnerFactor": 1.0
  },
  "limits": {
    "vneIasMs": 135.3, "vnoIasMs": 126.0, "vfeIasMs": 80.8, "gLimitPos": 3.1,
    "gLimitNeg": -1.2, "serviceCeilingM": 10668, "mmo": 0.58, "vleIasMs": 94.7
  },
  "flaps": [
    { "label": "0", "dCL0": 0.0, "dStallAlphaRad": 0.0, "dCD0": 0.0 },
    { "label": "APPR", "dCL0": 0.4, "dStallAlphaRad": -0.03, "dCD0": 0.02 },
    { "label": "FULL", "dCL0": 0.8, "dStallAlphaRad": -0.07, "dCD0": 0.06 }
  ],
  "gear": "retractable",
  "display": { "asiMinKt": 40, "asiMaxKt": 300, "attitudeStyle": "sixpack" },
  "sources": {
    "massKg": "TUNING KNOB (cruise/climb) — 5.7 t mid-mission weight (King Air 350 MTOW 6.804 t / 15,000 lb). Pinned by the FL280 cruise trim + sea-level climb tests. Source verification pending (POH).",
    "wingAreaM2": "TUNING KNOB — 28.8 m^2 (~310 sq ft published King Air 350 wing area); wing loading ~198 kg/m^2 at 5.7 t. Source verification pending.",
    "wingSpanM": "17.65 m (57 ft 11 in published King Air 350 span). Source verification pending; consistent with aspectRatio: b^2/S = 17.65^2/28.8 = 10.8.",
    "aspectRatio": "10.8 — high-AR straight turboprop wing (efficient cruise, a King Air signature); b^2/S = 17.65^2/28.8 = 10.8.",
    "cl0": "TUNING KNOB (cruise trim + stall band) — 0.30 zero-AoA lift for a straight high-AR wing.",
    "clAlphaPerRad": "TUNING KNOB (stall band) — 5.5/rad, a straight high-AR wing lift slope (steeper than a swept jet's). Pinned by the sea-level clean-stall-speed band test (75-90 kt).",
    "stallAlphaRad": "TUNING KNOB (stall band) — 16.0 deg (0.28 rad) clean critical AoA; CLmax_clean = 0.30 + 5.5*0.28 = 1.84. Pinned alongside clAlphaPerRad by the stall-speed band test.",
    "postStallDecayRad": "TUNING KNOB — 0.16 rad fade width past the break, matching the c172/b738/f5e pattern.",
    "cd0": "TUNING KNOB (cruise TAS + SL climb + service ceiling) — 0.028, a realistic clean turboprop parasite-drag coefficient (props/exposed gear bays are draggier than a clean jet). Pinned with maxPowerW + the lapse corner by the FL280-cruise + SL-climb + 35,000 ft-ceiling triple. Source verification pending.",
    "gearDragCd0": "TUNING KNOB — 0.02 retractable main/nose gear increment.",
    "speedbrakeCd0": "0.0 — the King Air 350 has NO airbrake/spoiler, so this increment is honestly zero and the KeyB speedbrake toggle is inert for this class (validated with num(), not positive(), so 0 is legal).",
    "oswaldE": "TUNING KNOB — 0.80, typical for a straight high-AR wing.",
    "cyBeta": "TUNING KNOB — -0.70/rad twin-turboprop side-force slope.",
    "rollRateMaxRadS": "TUNING KNOB — ~40 deg/s, unhurried turboprop roll (faster than the 737, slower than the bizjet).",
    "pitchRateMaxRadS": "TUNING KNOB — ~17 deg/s.",
    "yawRateMaxRadS": "TUNING KNOB — ~10 deg/s.",
    "damping/stiffness": "TUNING KNOBS — pitch omega_n = sqrt(3.0) = 1.73 rad/s, zeta = 2.5/(2*1.73) = 0.72 (well damped).",
    "refDynamicPressurePa": "TUNING KNOB — 3500 Pa (below the jets' 6000-6500): a slower turboprop reaches full control authority at its own lower speed band.",
    "trimAlphaCenterRad": "TUNING KNOB — 1.7 deg, near cruise AoA so trim near centre is roughly hands-off cruise.",
    "trimAlphaRangeRad": "TUNING KNOB — +-8.0 deg trim authority, enough to trim from approach AoA to cruise AoA (verified by the trimmed-level-flight test).",
    "propulsion": "TUNING KNOBS — 2x flat-rated turboprop via the shared power-limited-PROP formula T=eta*P/max(V,propPeakSpeedMs) (SAME formula as the C172, NOT the flat-rated-turbofan constant-thrust form): propPeakSpeedMs 100 m/s sits BELOW cruise TAS (~160 m/s), so thrust falls with speed like a real prop, and ramps prop efficiency in the climb. maxPowerW 1.566 MW = 2x 1,050 shp flat-rated (PT6A-60A-class). eta*P/peak = 0.85*1.566e6/100 = 13.3 kN full-throttle static-band thrust; T/W ~0.24 at 5.7 t. afterburnerFactor 1.0 (none). lapseModel: see the lapse-model decision below — starts 'piston', changed to 'turboprop' in Step 6 if the ceiling test requires. Source verification pending (PT6A-60A flat-rated shp + critical altitude).",
    "propPeakSpeedMs": "TUNING KNOB (climb + cruise) — 100 m/s (194 kt): below cruise TAS so cruise thrust falls with speed (real prop), above best-climb TAS so the efficiency ramp caps SL climb to a plausible rate. One of the two least-certain numbers (with maxPowerW).",
    "propEfficiency": "0.85 — the eta in T = eta*P/max(V,peak), matching the other classes; kept near 1 so maxPowerW carries the tuning.",
    "lapseModel": "SEE DECISION (Step 6): a turbine holds shaft power with altitude far better than a piston. Starts 'piston' to MEASURE; if the 35,000 ft ceiling is unreachable with piston lapse, switched to a new additive 'turboprop' lapse (flat-rated to a corner, then density falloff). decisions.md TP-00x.",
    "afterburnerFactor": "1.0 — turboprop, no afterburner.",
    "limits.vneIasMs": "Vmo ~263 KIAS = 135.3 m/s (King Air 350). Source verification pending.",
    "limits.vnoIasMs": "~245 KIAS = 126.0 m/s display caution reference below Vmo. Source verification pending.",
    "limits.vfeIasMs": "~157 KIAS = 80.8 m/s full-flap placard (most-restrictive detent); display only. Source verification pending.",
    "mmo": "0.58 — King Air 350 Mmo. At FL280 cruise (~M0.51) it does not bind. Source verification pending.",
    "vleIasMs": "~184 KIAS = 94.7 m/s Vle/Vlo placard; display only. Source verification pending.",
    "gLimits": "+3.1 / -1.2 — commuter-category turboprop clean flight-envelope limits (King Air is FAR 23 commuter category, ~+3.17/-1.27 at MTOW). Pinned by the g-clamp envelope test. Source verification pending.",
    "serviceCeilingM": "10,668 m (35,000 ft) — King Air 350 certified service ceiling. Made honest in-model by the turboprop lapse (Step 6): full-throttle best climb there measures inside the 0-500 fpm band. Source verification pending.",
    "flaps": "0/APPR/FULL — simplified King Air schedule; dCL0/dStallAlpha/dCD0 are TUNING KNOBS giving monotonically falling stall speeds and rising drag.",
    "display": "ASI 40-300 kt spans the turboprop band; attitudeStyle sixpack (steam-gauge horizon, like the C172 — a King Air panel reads closer to the GA six-pack than an EFIS disc). Confirm 'sixpack' is a valid attitudeStyle in params.ts (ATTITUDE_STYLES = line|ball); if not, use 'line'.",
    "gear": "retractable — King Air 350 has retractable tricycle gear."
  }
}
```

> **`attitudeStyle` note:** `params.ts` accepts only `attitudeStyle` ∈ {`"line"`, `"ball"`} (ATTITUDE_STYLES). The JSON above uses `"sixpack"` for the `display.attitudeStyle` prose intent but that value would FAIL validation. Set `display.attitudeStyle` to **`"line"`** (the C172 steam-gauge style; check `c172.json`) so the validator passes; the dashboard PRIMARY (six-pack vs EFIS) is chosen separately in Task 2's `dashboard/profiles.ts`, not here.

- [ ] **Step 4: Add the loader to `frontend/src/sim/params.ts`.** After `loadBiz`, mirroring its cache pattern; add the switch case:

```ts
import tpropRaw from "../params/tprop.json";
// ...
let cachedTprop: ClassParams | null = null;
/** The King Air-class turboprop class (power-limited prop, turbine altitude lapse). */
export function loadTprop(): ClassParams {
  if (cachedTprop === null) cachedTprop = validateClassParams(tpropRaw);
  return cachedTprop;
}
// ...in loadClassById switch, before default:
    case "tprop": return loadTprop();
```

- [ ] **Step 5: Run the envelope test with `lapseModel: "piston"`; tune cruise/stall/climb-SL first.** Run: `cd frontend && npx vitest run src/sim/tprop-envelope.test.ts`. Tune `maxPowerW`/`propPeakSpeedMs`/`cd0` until the cruise-TAS band, stall band, and **sea-level** climb (>1800 fpm) pass. Expect the **service-ceiling test to still FAIL**: with piston (Gagg-Ferrar) lapse the King Air retains only `(σ−0.117)/0.883 ≈ 0.22` of shaft power at FL350, so best climb at 35,000 ft is deeply negative (no ceiling — the model can't even hold altitude there). This failure is the evidence for Step 6.

- [ ] **Step 6: THE LAPSE-MODEL DECISION (made here, by measurement).** The piston lapse is a light-single fact; applying it to a turbine bakes a wrong assumption into a supposedly class-agnostic core. Because Step 5 showed piston lapse cannot reach the 35,000 ft ceiling, **add a `turboprop` lapse variant** — additive, so `piston`/`turbofan`/`none` stay byte-identical:
  1. `frontend/src/sim/types.ts` — widen the union: `export type LapseModel = "piston" | "none" | "turbofan" | "turboprop";`
  2. `frontend/src/sim/params.ts` — add `"turboprop"` to the `LAPSE_MODELS` validator array: `["piston", "none", "turbofan", "turboprop"]` (keep it in step with `POWER_LAPSE_MODELS`, as its doc comment requires). Also add optional per-class overrides mirroring the turbofan ones (absent → module defaults):

```ts
      ...(propulsion.turbopropCornerM === undefined
        ? {}
        : { turbopropCornerM: positive(propulsion, "turbopropCornerM", "params.propulsion") }),
      ...(propulsion.turbopropLapseExp === undefined
        ? {}
        : { turbopropLapseExp: positive(propulsion, "turbopropLapseExp", "params.propulsion") }),
```
  3. `frontend/src/sim/types.ts` `propulsion` shape — add the two optional fields alongside `turbofanCornerM?` / `turbofanLapseExp?`: `turbopropCornerM?: number;` and `turbopropLapseExp?: number;`
  4. `frontend/src/sim/forces.ts` — add the function (structurally identical to `turbofanPowerLapse`, applied to SHAFT POWER) + the `POWER_LAPSE_MODELS` key + default constants:

```ts
/**
 * Flat-rated turboprop SHAFT-POWER lapse. A free-turbine turboprop holds close to its flat-rated
 * shaft power from sea level up to a critical (corner) altitude, then loses power with density in
 * the stratosphere — exactly turbofanPowerLapse's shape, but on P (shaft power) not T (thrust),
 * because a turboprop is a power-limited PROP (thrust still comes from T = eta*P/max(V,peak)). The
 * piston (Gagg-Ferrar) lapse would retain only ~22% of power at FL350, giving the King Air a
 * far-too-low ceiling; the turbine holds power much better, so its ceiling is real at ~FL350.
 * Corner altitude / exponent are per-class-overridable DATA (propulsion.turbopropCornerM /
 * turbopropLapseExp); the constants below are the defaults. decisions.md TP-00x.
 */
export const TURBOPROP_CORNER_M = 6096; // ~FL200, PT6A-class flat-rating critical altitude
export const TURBOPROP_LAPSE_EXP = 1.0;

export function turbopropPowerLapse(
  altitudeM: number,
  cornerM: number = TURBOPROP_CORNER_M,
  lapseExp: number = TURBOPROP_LAPSE_EXP,
): number {
  if (altitudeM <= cornerM) return 1;
  const sigma = isaDensity(altitudeM) / RHO_SL;
  const sigmaCorner = isaDensity(cornerM) / RHO_SL;
  return Math.pow(sigma / sigmaCorner, lapseExp);
}

// ...add to POWER_LAPSE_MODELS:
  turboprop: (h, p) => turbopropPowerLapse(h, p.propulsion.turbopropCornerM, p.propulsion.turbopropLapseExp),
```
  5. `frontend/src/params/tprop.json` — change `propulsion.lapseModel` to `"turboprop"`. Leave `turbopropCornerM`/`turbopropLapseExp` OMITTED (use the FL200 default) unless Step 7 shows the ceiling still off, in which case add a per-class override (parallel to how `biz` needed `turbofanCornerM` but `b738`/`f5e` did not). Update the `lapseModel` + `serviceCeilingM` `sources` notes to describe what was measured.

- [ ] **Step 7: Re-run the envelope test; tune until green.** Run: `cd frontend && npx vitest run src/sim/tprop-envelope.test.ts`. If the ceiling climb is still >500 fpm, lower `maxPowerW` slightly or add a lower `turbopropCornerM` (puts more of the climb in the lapsed regime); if <0, raise the corner or `maxPowerW`. Re-check cruise/stall/SL-climb didn't regress. Expected: PASS. Also run the existing sim suite to confirm the additive lapse changed nothing else: `cd frontend && npx vitest run src/sim/`. Expected: all still green (b738/f5e/c172 envelopes byte-identical).

- [ ] **Step 8: Commit.**

```bash
git add frontend/src/params/tprop.json frontend/src/sim/params.ts frontend/src/sim/types.ts frontend/src/sim/forces.ts frontend/src/sim/tprop-envelope.test.ts
git commit -m "feat(sim): King Air-class turboprop flight params + envelope test + turboprop lapse (tprop)"
```

---

### Task 2: Turboprop mission profile, dashboard profile, and model dimensions

**Files:**
- Create: `frontend/src/mission/profiles/tprop.json`
- Modify: `frontend/src/mission/profiles.ts` (add `"tprop"` to the `validateMissionProfile` class allowlist, line ~30 — the runtime string check, NOT the union yet)
- Modify: `frontend/src/globe/aircraftModelDims.ts` (add `MODEL_DIMS.tprop`)
- Modify: `frontend/src/dashboard/profiles.ts` (add `PROFILES.tprop` — `Record<string>`, throws at runtime otherwise)
- Test: `frontend/src/globe/aircraftModelDims.test.ts` (add a tprop dims case + update the exact-keys assertion at line 18); `frontend/src/dashboard/profiles.test.ts` (add a tprop profile case + update the PRIMARIES map at ~line 15-20)

**Interfaces:**
- Consumes: `validateMissionProfile` (profiles.ts); `modelDimsForClass` (aircraftModelDims.ts); `profileForClass` (dashboard/profiles.ts) — all string-keyed, no union dependency.
- Produces: `modelDimsForClass("tprop")` returns dims; `profileForClass("tprop")` returns a six-pack dashboard profile; a valid `tprop` mission profile JSON that `validateMissionProfile` accepts.

- [ ] **Step 1: Write the failing dims test.** In `aircraftModelDims.test.ts`, add a case AND update the exact-keys assertion (line 18 currently `["b738", "biz", "c172s", "f5e"]`):

```ts
it("resolves tprop model dimensions (straight high-AR low wing, twin wing-mounted turboprops)", () => {
  const d = modelDimsForClass("tprop");
  expect(d.wingSweepRad).toBe(0);         // straight wing (turboprop, not swept)
  expect(d.engine?.count).toBe(2);        // two wing-mounted turboprops
  expect(d.wingSpanM).toBeGreaterThan(d.lengthM); // high-AR: span exceeds length
  expect(d.lengthM).toBeGreaterThan(12);
  expect(d.lengthM).toBeLessThan(18);
});
```
And change line 18: `expect(Object.keys(MODEL_DIMS).sort()).toEqual(["b738", "biz", "c172s", "f5e", "tprop"]);`

- [ ] **Step 2: Run it, verify it fails.** Run: `cd frontend && npx vitest run src/globe/aircraftModelDims.test.ts`. Expected: FAIL — `modelDimsForClass("tprop")` throws `unknown class id: tprop` (and the keys assertion fails).

- [ ] **Step 3: Add `MODEL_DIMS.tprop`** to `aircraftModelDims.ts` (King Air 350 proportions — mid-size, **straight** high-AR low wing, **two wing-mounted turboprop nacelles** on the wing (unlike the 737's podded fans and the bizjet's aft-fuselage nacelles); T-tail. Dims are visual TUNING KNOBS to adjust by eye in the browser):

```ts
  tprop: {
    lengthM: 14.2,
    wingSpanM: 17.7,
    wingSweepRad: 0, // straight turboprop wing
    wingChordM: 1.9,
    wingXFrac: 0.38,
    wingZFrac: 0.6, // low wing
    wingTipChordFrac: 0.5,
    engine: { count: 2, spanFracs: [-0.28, 0.28], lengthM: 2.8, radiusM: 0.5 }, // two WING-mounted turboprops (nacelle + prop disc)
    tailSpanM: 5.2,
    tailChordM: 1.4,
    finHeightM: 3.9, // tall T-tail
    fuselageRadiusM: 0.85,
  },
```

> Note: the shared `buildAirframe` geometry draws a nacelle box per `engine.spanFracs` entry; there is no separate propeller/prop-disc primitive, so the wing-mounted turboprops read as nacelles on the wing. Recording "props" here is intent for a future geometry pass — do NOT add a prop-disc code branch now (data-not-branches). Flag in the decisions entry that the low-poly turboprop shows nacelles, not spinning discs (honest limitation).

- [ ] **Step 4: Run the dims test; adjust by eye later in the browser.** Run: `cd frontend && npx vitest run src/globe/aircraftModelDims.test.ts`. Expected: PASS.

- [ ] **Step 5: Write the failing dashboard-profile test.** In `dashboard/profiles.test.ts`: add the case below AND add `tprop: "sixpack"` to the PRIMARIES literal near the top of the file (the map that lists each class's expected primary, ~line 15-20):

```ts
it("gives the turboprop a six-pack dashboard profile (steam gauges, like the GA single)", () => {
  expect(profileForClass("tprop")).toEqual({ classId: "tprop", primary: "sixpack", background: "transparent" });
});
```

- [ ] **Step 6: Run it, verify it fails, then add `PROFILES.tprop`** to `dashboard/profiles.ts`:

```ts
  tprop: { classId: "tprop", primary: "sixpack", background: "transparent" },
```

Run: `cd frontend && npx vitest run src/dashboard/profiles.test.ts`. Expected: PASS. (Rationale: a King Air panel reads closer to the GA analog six-pack than the airliner/bizjet EFIS disc.)

- [ ] **Step 7: Create `frontend/src/mission/profiles/tprop.json`.** Copy `mission/profiles/b738.json` and adjust for a light/mid turboprop: slower planning speeds and shorter/narrower runway minimums than the 737 (turboprops use short fields), but faster/longer than the C172. Keep the SAME `profileVersion`/`assignmentVersion`/`scoringVersion` date-tag format. Key values:

```json
{
  "classId": "tprop",
  "profileVersion": "mission-tprop-2026-08-13-v1",
  "assignmentVersion": "assignment-2026-08-10-v1",
  "scoringVersion": "scoring-2026-08-10-v1",
  "reachability": { "maxMinutes": 30, "minDestinationNm": 15, "defaultPlanningSpeedKt": 300, "minPlanningSpeedKt": 130, "maxPlanningSpeedKt": 320 },
  "runway": { "airportSizes": ["small", "medium", "large"], "surfaces": ["HARD"], "minLengthFt": 3200, "minWidthFt": 60, "requireLighted": false, "requireBothEnds": true, "maxAirportElevationFt": 9000, "maxInitialHeadingDeltaDeg": 100 },
  "ranking": { "lengthMarginWeight": 36, "widthMarginWeight": 18, "lightedBonus": 8, "hardSurfaceBonus": 10, "minutePenalty": 0.2 },
  "guidance": { "approachLengthNm": 8, "corridorWidthFt": 1100, "gateSpacingNm": 1, "glideSlopeDeg": 3, "flareHeightFt": 30 },
  "landing": { "requireGearDown": true, "maxSinkRateFpm": 720, "maxAbsBankDeg": 8, "minPitchDeg": -3, "maxPitchDeg": 12, "minTouchdownSpeedKt": 85, "maxTouchdownSpeedKt": 130, "maxLoadFactor": 2.1, "maxRolloutCrossTrackFt": 50 },
  "scoreCurves": { "verticalSpeedFpm": [{"value":100,"score":1},{"value":360,"score":0.7},{"value":720,"score":0}], "centerlineErrorFt": [{"value":0,"score":1},{"value":18,"score":0.7},{"value":50,"score":0}], "touchdownZoneFt": [{"value":600,"score":1},{"value":1500,"score":0.6},{"value":2600,"score":0}], "headingErrorDeg": [{"value":0,"score":1},{"value":3,"score":0.7},{"value":10,"score":0}], "speedErrorKt": [{"value":0,"score":1},{"value":6,"score":0.6},{"value":16,"score":0}], "bankDeg": [{"value":0,"score":1},{"value":3,"score":0.6},{"value":8,"score":0}], "rolloutCrossTrackFt": [{"value":0,"score":1},{"value":18,"score":0.7},{"value":50,"score":0}] }
}
```

> Confirm the `runway.airportSizes` string values (`"small"`/`"medium"`/`"large"`) against `validateMissionProfile` — the turboprop is the first class to want `"small"` fields. If the validator's allowed-sizes set omits `"small"`, either use `["medium","large"]` (safe) or widen the validator set; do NOT invent a size string the validator rejects.

- [ ] **Step 8: Add `"tprop"` to the `validateMissionProfile` class allowlist** in `mission/profiles.ts` (~line 30): change `(["c172s", "b738", "f5e", "biz"] as const)` to `(["c172s", "b738", "f5e", "biz", "tprop"] as const)`. (Do NOT touch the `profiles` `Record<AircraftClassId>` object or `allMissionProfiles()` yet — those are wired in Task 3 with the union flip.) Run the existing profile tests: `cd frontend && npx vitest run src/mission/profiles.test.ts`. Expected: PASS (no regressions; the `allMissionProfiles` order test still asserts the current 4 until Task 3).

- [ ] **Step 9: Commit.**

```bash
git add frontend/src/mission/profiles/tprop.json frontend/src/mission/profiles.ts frontend/src/globe/aircraftModelDims.ts frontend/src/globe/aircraftModelDims.test.ts frontend/src/dashboard/profiles.ts frontend/src/dashboard/profiles.test.ts
git commit -m "feat(mission): turboprop mission profile, six-pack dashboard profile, model dims (tprop)"
```

---

### Task 3: Integrate `tprop` into the class system (union flip + all consumers + resolution)

This is the compiler-guided integration task. Flipping the `AircraftClassId` union breaks `tsc`; the task is done when `tsc` is green again AND a real turboprop designator resolves to `tprop`. **Use `npm run typecheck` output as the checklist** — every `Record<AircraftClassId>` consumer will be flagged. But note the non-compiler-forced consumers (string arrays, `.tsx` UI options, string-keyed maps, and the `FlightSession` tutorial guard) that `tsc` will NOT flag — they are listed explicitly below.

**Files:**
- Modify (compiler-forced `Record<AircraftClassId>` / exhaustive): `frontend/src/mission/types.ts:1` (union), `frontend/src/mission/profiles.ts` (`profiles` object + `allMissionProfiles`), `frontend/src/briefing/MissionTray.tsx:11` (`CLASS_LABELS`), `frontend/src/freeflight/freeFlight.ts:37` (`FREE_FLIGHT_CLASSES`) + `:45` (`MISSION_IDS`), `frontend/src/tutorial/definitions.ts:57` (`LESSONS`) + `:163` (`MISSION_IDS`)
- Modify (NOT compiler-forced — string-keyed / arrays / UI / guard): `frontend/src/dashboard/profiles.ts` (already done Task 2), `frontend/src/panels/ContactList.tsx:14` (`ContactClassFilter` union + `:177` `<option>`), `frontend/src/leaderboards/LeaderboardPanel.tsx:9` (`CLASS_IDS`), `frontend/src/freeflight/FreeFlightPanel.tsx:6` (`CLASS_ORDER`), `frontend/src/game/FlightSession.tsx:477` (the `classId !== "biz"` tutorial-complete guard → also exclude `"tprop"`)
- Modify (ALL THREE worker allowlists — biz's first pass missed leaderboards.ts CLASS_IDS; list all three): `frontend/worker/http/routes/missions.ts:121` (`classId === ...` chain), `frontend/worker/missions/authorization.ts:124` (`classId === ...` chain), `frontend/worker/http/routes/leaderboards.ts:19` (`CLASS_IDS` array)
- Create: `frontend/src/params/tprop-types.json` (designator list)
- Test: `frontend/src/takeover/eligibility.test.ts` (tprop bucket case)

**Interfaces:**
- Consumes: everything from Tasks 1-2 (`loadTprop`, tprop mission/dashboard profiles, `MODEL_DIMS.tprop`).
- Produces: `resolveClass(contact)` returns `{ supported: true, classId: "tprop", matched: true }` for a King Air / PC-12 / Caravan / TBM designator; `AircraftClassId` includes `"tprop"`; the full app typechecks; `tprop` appears in the leaderboard and contact-list class filters and the free-flight picker.

- [ ] **Step 1: Write the failing resolution test.** In `eligibility.test.ts` `describe("resolveClass")`, add:

```ts
it("maps a light/mid turboprop designator to tprop", () => {
  expect(resolveClass(contact({ t: "B350" }))).toEqual({ supported: true, classId: "tprop", matched: true });
  expect(resolveClass(contact({ t: "PC12" }))).toEqual({ supported: true, classId: "tprop", matched: true });
  expect(resolveClass(contact({ t: "C208" }))).toEqual({ supported: true, classId: "tprop", matched: true });
});
it("keeps regional turboprops in the airliner bucket (decision B)", () => {
  expect(resolveClass(contact({ t: "DH8D" }))).toEqual({ supported: true, classId: "b738", matched: true });
  expect(resolveClass(contact({ t: "AT72" }))).toEqual({ supported: true, classId: "b738", matched: true });
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `cd frontend && npx vitest run src/takeover/eligibility.test.ts`. Expected: FAIL — `B350` currently resolves to `UNSUPPORTED AIRCRAFT TYPE`. (The DH8D/AT72 assertions already pass — they guard against accidentally moving regionals.)

- [ ] **Step 3: Create `frontend/src/params/tprop-types.json`** with light/mid turboprop ICAO type designators. EXCLUDES regional turboprops (Q400/DH8D/AT7x/SF34/SB20 — stay `b738`) and jets (PC24/SF50 — stay `biz`). Starter set:

```json
{
  "designators": [
    "BE20", "B350", "BE30", "BE9L", "BE9T", "B190",
    "PC12",
    "C208", "C20B",
    "TBM7", "TBM8", "TBM9",
    "PAY1", "PAY2", "PAY3", "PAY4",
    "P180",
    "AC90", "AC95",
    "EPIC", "E110"
  ]
}
```

> Curation notes (verify during impl against a designator reference, keep to light/mid): `BE20`=King Air 200, `B350`=King Air 350, `BE30`=Super King Air 300, `BE9L`/`BE9T`=King Air 90 series; `B190`=Beech 1900 is a 19-seat commuter turboprop — borderline regional; INCLUDE only if kept clearly light/mid, otherwise drop it (owner call — flag in the decisions entry). `PC12`=Pilatus PC-12; `C208`/`C20B`=Cessna Caravan/Grand Caravan; `TBM7/8/9`=Daher/Socata TBM 700/850-900/930-940; `PAY1-4`=Piper Cheyenne; `P180`=Piaffe Avanti (pusher twin turboprop); `AC90/95`=Rockwell Turbo Commander; `E110`=Embraer Bandeirante (light twin). **Do NOT include:** `DH8D`/`DH8A-C`, `AT43/AT45/AT72/AT76`, `SF34`, `SB20`, `SW4` (Metroliner — borderline; leave UNSUPPORTED or airliner, owner call), `PC24`, `SF50`. Confirm none of the chosen designators already sit in `ga-types.json`/`airliner-types.json`/`fighter-types.json`/`biz-types.json` (the sets must stay disjoint — resolveClass checks fighter→airliner→biz→GA before the new bucket; a collision would silently win elsewhere).

- [ ] **Step 4: Add the tprop bucket to `resolveClass`** in `eligibility.ts`. Import the JSON, add a Set, and add a check BEFORE the `UNSUPPORTED` fallthrough (order among the supported buckets is not significant — the sets are disjoint; place it after the `BIZ` check to mirror the file's existing order):

```ts
import tpropTypes from "../params/tprop-types.json";
export const TPROP_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(tpropTypes.designators);
// ...inside resolveClass, after the BIZ check:
    if (TPROP_TYPE_DESIGNATORS.has(t)) return { supported: true, classId: "tprop", matched: true };
```

- [ ] **Step 5: Flip the union.** In `frontend/src/mission/types.ts:1`: `export type AircraftClassId = "c172s" | "b738" | "f5e" | "biz" | "tprop";`

- [ ] **Step 6: Run typecheck; fill every compiler-flagged consumer.** Run: `cd frontend && npm run typecheck`. Fix each error:
  - `mission/profiles.ts` `profiles` object → add `tprop: deepFreeze(validateMissionProfile(tpropRaw))` (import `tpropRaw from "./profiles/tprop.json"`); `allMissionProfiles()` → add `profiles.tprop` to the returned array (and update the order test `mission/profiles.test.ts:6` to append `"tprop"`).
  - `briefing/MissionTray.tsx` `CLASS_LABELS` → add `tprop: "TURBOPROP · KING AIR-CLASS MODEL"`.
  - `freeflight/freeFlight.ts` `FREE_FLIGHT_CLASSES` → add `tprop: { hex: "ff0b35", flight: "FREETRP", t: "B350", defaultAltitudeFt: 18_000, minAltitudeFt: 1_500, maxAltitudeFt: 34_000 }`; `MISSION_IDS` → add `tprop: "00000000-0000-4000-8000-000000000205"`.
  - `tutorial/definitions.ts` `LESSONS` Record → add a `tprop:` entry (copy the placeholder shape of the `biz:` entry — it is unreachable, kept only to satisfy `Record<AircraftClassId,...>`; tprop has no tutorial); `MISSION_IDS` Record → add `tprop: "00000000-0000-4000-8000-000000000105"`.
  - Any other `Record<AircraftClassId>` / exhaustive switch the compiler flags → handle `tprop` the same as `biz`.

- [ ] **Step 7: Fix the NOT-compiler-forced consumers** (tsc will NOT flag these — do them by the list):
  - `panels/ContactList.tsx:14` `ContactClassFilter` → `"all" | "c172s" | "b738" | "f5e" | "biz" | "tprop" | "unsupported"`; and add `<option value="tprop">TURBOPROP</option>` near line 177 (mirror the `biz` option).
  - `leaderboards/LeaderboardPanel.tsx:9` `CLASS_IDS` → append `"tprop"`.
  - `freeflight/FreeFlightPanel.tsx:6` `CLASS_ORDER` → add `{ id: "tprop", name: "TURBOPROP", model: "KING AIR-CLASS" }`.
  - `game/FlightSession.tsx:477` — the tutorial-complete guard `if (lockedMission.classId !== "biz")` must ALSO exclude tprop (tprop has no tutorial mission): `if (lockedMission.classId !== "biz" && lockedMission.classId !== "tprop")`. Update the adjacent comment to name both.

- [ ] **Step 8: Widen ALL THREE worker allowlists** (biz's first pass missed the leaderboards one — do all three now):
  - `worker/http/routes/missions.ts:121` → add `|| value.classId === "tprop"` to the chain.
  - `worker/missions/authorization.ts:124` → add `|| value.classId === "tprop"` to the chain.
  - `worker/http/routes/leaderboards.ts:19` `CLASS_IDS` → append `"tprop"`.
  Run the worker tests: `cd frontend && npx vitest run --config vitest.worker.config.ts` (or the project's worker test command) to confirm no regression.

- [ ] **Step 9: Run the resolution test + typecheck; both green.** Run: `cd frontend && npx vitest run src/takeover/eligibility.test.ts && npm run typecheck`. Expected: PASS + clean typecheck.

- [ ] **Step 10: Commit.**

```bash
git add frontend/src/mission/types.ts frontend/src/mission/profiles.ts frontend/src/mission/profiles.test.ts frontend/src/briefing/MissionTray.tsx frontend/src/freeflight/freeFlight.ts frontend/src/freeflight/FreeFlightPanel.tsx frontend/src/tutorial/definitions.ts frontend/src/panels/ContactList.tsx frontend/src/leaderboards/LeaderboardPanel.tsx frontend/src/game/FlightSession.tsx frontend/src/takeover/eligibility.ts frontend/src/takeover/eligibility.test.ts frontend/src/params/tprop-types.json frontend/worker/http/routes/missions.ts frontend/worker/missions/authorization.ts frontend/worker/http/routes/leaderboards.ts
git commit -m "feat: resolve turboprop designators to the tprop class + wire all consumers"
```

---

### Task 4: Full gate, decision log, deploy, device-verify

**Files:**
- Modify: `docs/decisions.md` (append the tprop archetype entry)
- Modify: `docs/summaries/CHECKLIST.md` (tick the turboprop item)

- [ ] **Step 1: Append a `docs/decisions.md` entry** dated 2026-08-13 covering: representative airframe (Beechcraft King Air 350 / B300-class); that `tprop` is data-only reusing the shared **power-limited-prop** thrust formula (like the C172, NOT the flat-rated-turbofan form); **the lapse-model decision** — piston lapse was tried first and MEASURED to give a far-too-low ceiling (only ~22% shaft power at FL350), so a new **additive `turboprop` lapse** (flat-rated to ~FL200, then density falloff) was added to `POWER_LAPSE_MODELS`, leaving `piston`/`turbofan`/`none` byte-identical (much lower risk than biz's shared-constant change); the tuning-knob vs sourced status of the key numbers, with King Air 350 POH / PT6A-60A figures still needing source verification (CLAUDE.md gate); the decision-B bucket split (regionals stay airliner; jets stay biz); that `speedbrakeCd0` is honestly 0 (no airbrake; KeyB inert); that the low-poly turboprop shows wing nacelles, not spinning prop discs (honest geometry limitation); and that the new leaderboard board starts empty (honest). Give it stable decision ids (e.g. TP-001 lapse model, TP-002 bucket split).

- [ ] **Step 2: Run the full gate.** Run: `cd frontend && npm run typecheck && npm run test:unit && npm run lint`. Expected: typecheck clean, all unit tests pass (suite grows by the tprop tests; existing sim envelopes unchanged), lint ≤8 warnings (no new ones). Fix anything red before proceeding.

- [ ] **Step 3: Commit the docs.**

```bash
git add docs/decisions.md docs/summaries/CHECKLIST.md
git commit -m "docs: log the turboprop archetype + lapse-model decision, tick checklist"
```

- [ ] **Step 4: Deploy to production and push.** Run: `cd frontend && npm run deploy:production` then `git push origin mongols-rich-hud`. Capture the deployed Worker Version id.

- [ ] **Step 5: Device-verify (owner).** On the live site, find a turboprop contact (King Air / PC-12 / Caravan / TBM — the contact-list class filter now has a TURBOPROP option; FREE FLIGHT also offers TURBOPROP if no live one is up). Confirm: it is takeover-eligible (was UNSUPPORTED), the briefing shows `TURBOPROP · KING AIR-CLASS MODEL`, TAKE CONTROLS starts a flight, the aircraft flies a believable turboprop (cruises ~300-310 kt, climbs strongly, has a real ~35,000 ft ceiling, doesn't rocket away or sink), the low-poly model reads as a straight-wing twin with wing nacelles, KeyB (speedbrake) does nothing (no airbrake — honest), and the debrief records a `tprop` mission. Also confirm a Q400/ATR contact still flies as the airliner (unchanged). Report back; tune `tprop.json`/dims if the feel or silhouette is off.

---

## Self-Review

**Spec coverage:** Spec §3 (tprop archetype: King Air 350, power-limited prop, retractable) → Task 1. §4 touchpoints (params, profile, dims, union, loadClassById, validateMissionProfile, worker validator, CLASS_LABELS, resolveClass buckets, envelope test) → Tasks 1–3, each item mapped; §4's explicit "confirm the prop lapse model fits a turboprop or add a `turboprop` lapse variant … documented in decisions.md" → Task 1 Steps 5–6 + Task 4 Step 1. §5 leaderboards (tprop board starts sparse; allowlist widened via `CLASS_IDS` + all three worker validators) → Task 3 Steps 7–8. §6 envelope acceptance (trimmed level flight — KEPT via `trimForLevelFlight`, stall 75-90 kt, positive SL climb, ceiling behavior, Vne respected, g clamp) → Task 1 Step 1 tests. §7 sequencing (TDD → gate → deploy → verify; order biz→tprop→heavy, tprop is #2) → Task 4. §8 success criteria → Task 4 Step 5. Decision B (regionals stay airliner, jets stay biz) → Global Constraints + Task 3 Steps 2–3 (explicit DH8D/AT72-stay-b738 test). Heavy is a separate future plan — correctly out of scope.

**Placeholder scan:** No TBD/TODO. Every JSON and test step has literal content. Deliberately-deferred items are named actions, not vague placeholders: source-verification citations (a CLAUDE.md gate, logged Task 4 Step 1), browser-eye tuning of dims (Task 4 Step 5), the `B190`/`SW4` borderline-designator owner calls (Task 3 Step 3), and the `attitudeStyle`/`airportSizes` validator confirmations (Task 1 Step 3 note / Task 2 Step 7 note). The one genuinely conditional branch — adding the `turboprop` lapse — is framed as a measured TDD decision with both outcomes specified (Step 5 measures, Step 6 acts), not an open question.

**Type consistency:** `loadTprop`/`loadClassById("tprop")`/`id: "tprop"` (Task 1) ↔ `AircraftClassId` union member `"tprop"` (Task 3 Step 5) ↔ `Record<AircraftClassId>` fills: `profiles`, `CLASS_LABELS`, `FREE_FLIGHT_CLASSES`, both `MISSION_IDS`, `LESSONS` (Task 3 Step 6) ↔ `resolveClass` returning `classId: "tprop"` (Task 3 Step 4) all agree. New `LapseModel` member `"turboprop"` (Task 1 Step 6) ↔ `LAPSE_MODELS` validator array ↔ `POWER_LAPSE_MODELS` key ↔ `propulsion.lapseModel` in tprop.json all kept in step (the existing doc comments mandate this). Optional `turbopropCornerM`/`turbopropLapseExp` in `types.ts` ↔ params.ts spread ↔ forces.ts function args mirror the turbofan trio exactly. Mission profile `classId: "tprop"` (Task 2) matches the validator allowlist string (Task 2 Step 8) and the union (Task 3). `PROFILES.tprop`/`MODEL_DIMS.tprop` are `Record<string>` (Task 2), consistent with their string-keyed lookups. Non-compiler-forced consumers (`ContactClassFilter`, `CLASS_IDS` ×2, `CLASS_ORDER`, `FlightSession` guard) are enumerated because `tsc` will not catch them — the single biggest integration risk, called out in Task 3 Step 7–8. No signature drift.
