# Bizjet Flight Model (`biz`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `biz` (Citation Latitude-class business jet) flight model so business-jet ADS-B contacts — Citation, Learjet, Gulfstream, Phenom, Challenger — become takeover-eligible and fly a believable mid-size-jet model instead of `UNSUPPORTED AIRCRAFT TYPE`.

**Architecture:** `biz` is the first of three new archetypes from the multi-aircraft spec. It is **data, not code**: a new `ClassParams` JSON drives the same Cesium-free 6-DOF model as the existing classes (flat-rated turbofan via the shared power-limited-prop formula `T = η·P/max(V, propPeakSpeedMs)` + the shared `turbofan` density lapse — identical mechanism to `b738`, just scaled down and with no afterburner). Build order: green data/physics first (string-keyed, no type change), then ONE compiler-guided task flips the `AircraftClassId` union and fills every consumer.

**Tech Stack:** Vite · React 18 + TypeScript · Zustand · Vitest. Physics in `frontend/src/sim/` (SI units, fixed 60 Hz, no Cesium imports). Params/profiles are hand-validated JSON (no schema library).

## Global Constraints

- **No new runtime dependency** (spec §14 gate). Validators are hand-written.
- **`sim/` stays Cesium-free and fully unit-tested.** New class = new JSON + one envelope test, never a physics branch ("class differences are data, not branches").
- **Non-GA performance numbers need source verification** (CLAUDE.md). Every `biz.json` number carries a `sources` entry; sourced-vs-tuning-knob is stated, and a `docs/decisions.md` entry cites the representative airframe + figures.
- **Live prod branch** (`mongols-rich-hud` → fly.voygent.app). Gate before every commit: `cd frontend && npm run typecheck && npm run test:unit && npm run lint` (lint ≤8 warnings; 5 pre-existing — add none).
- **Representative airframe:** Cessna Citation Latitude-class mid-size jet (~M0.80, 2× flat-rated turbofan, retractable gear). Decided in the design spec.
- Class id string is exactly `biz`. Display label `BUSINESS JET · CITATION-CLASS MODEL`.

---

### Task 1: Bizjet flight params + performance envelope

**Files:**
- Create: `frontend/src/params/biz.json`
- Modify: `frontend/src/sim/params.ts` (add `loadBiz()` + cache + `case "biz"` in `loadClassById`)
- Test: `frontend/src/sim/biz-envelope.test.ts`

**Interfaces:**
- Consumes: `validateClassParams` / `loadClassById` (params.ts); `dragCoefficient`, `thrustNewtons` (forces.ts); `stepAircraft`, `refreshDerived` (aircraft.ts); `isaDensity`, `machNumber`, `iasToTas` (isa.ts) — all already exist and are class-agnostic (parametrised on `ClassParams`).
- Produces: `loadBiz(): ClassParams`; `loadClassById("biz")` returns the validated bizjet params. `id` field is `"biz"`.

- [ ] **Step 1: Write the failing envelope test.** Mirror `b738-envelope.test.ts` (parametrised helpers `maxLevelSpeedMs`, `bestClimbRateMs`, `levelState`, `flyAndMeasure`, `trimForLevelFlight` — copy them verbatim, they already take `params`). Assert plausibility, not exact values:

```ts
import { describe, it, expect } from "vitest";
import { loadBiz } from "./params";
import { dragCoefficient, thrustNewtons } from "./forces";
import { isaDensity, machNumber } from "./isa";
import { stepAircraft, refreshDerived } from "./aircraft";
import { geodeticToEcef } from "./geo";
import { quatFromHpr, qRotate } from "./quat";
import { degToRad, ftToM, ktToMs, msToFpm } from "./units";
import type { ClassParams, ControlVector, SimState } from "./types";

const P = loadBiz();
const G0 = 9.80665;
// ...copy levelFlightExcessThrustN / maxLevelSpeedMs / bestClimbRateMs / levelState /
//    flyAndMeasure / trimForLevelFlight from b738-envelope.test.ts verbatim...

describe("BIZ envelope — cruise", () => {
  it("trims at cruise Mach ~0.78 at FL430", () => {
    const alt = ftToM(43000);
    const tas = maxLevelSpeedMs(P, alt, 0.85);
    const mach = machNumber(tas, alt);
    expect(mach).toBeGreaterThan(0.72);
    expect(mach).toBeLessThan(0.82);
  });
});

describe("BIZ envelope — limits", () => {
  it("clean stall speed sits in the mid-jet band (~110-130 kt) at sea level", () => {
    // Vstall = sqrt(2 W / (rho S CLmax)); CLmax = cl0 + clAlphaPerRad*stallAlphaRad (clean).
    const clMax = P.aero.cl0 + P.aero.clAlphaPerRad * P.aero.stallAlphaRad;
    const vStallMs = Math.sqrt((2 * P.massKg * G0) / (isaDensity(0) * P.wingAreaM2 * clMax));
    const vStallKt = vStallMs / ktToMs(1);
    expect(vStallKt).toBeGreaterThan(105);
    expect(vStallKt).toBeLessThan(135);
  });
  it("climbs strongly at sea level and barely at the service ceiling", () => {
    expect(msToFpm(bestClimbRateMs(P, 0, 1))).toBeGreaterThan(2500);
    const ceilFpm = msToFpm(bestClimbRateMs(P, P.limits.serviceCeilingM, 1));
    expect(ceilFpm).toBeGreaterThan(0);
    expect(ceilFpm).toBeLessThan(500);
  });
  it("g clamps at +3.0 and reaches it from a fast entry", () => {
    const controls: ControlVector = { pitch: 1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: 1, gearDown: false, afterburner: false };
    let s = levelState(P, ftToM(20000), ktToMs(320), controls);
    let maxG = 0, sawLimit = false;
    for (let i = 0; i < 600; i++) { s = stepAircraft(s, controls, P); maxG = Math.max(maxG, s.loadFactor); if (s.gLimited) sawLimit = true; }
    expect(sawLimit).toBe(true);
    expect(maxG).toBeCloseTo(P.limits.gLimitPos, 6);
  });
  it("never produces NaN across a control sweep", () => {
    const controls: ControlVector = { pitch: 0.6, roll: 0.6, yaw: 0.6, throttle: 1, flapDetent: 3, trim: 1, gearDown: false, afterburner: false };
    let s = levelState(P, ftToM(30000), ktToMs(260), controls);
    for (let i = 0; i < 3600; i++) s = stepAircraft(s, controls, P);
    expect(Number.isFinite(s.tasMs)).toBe(true);
    expect(Number.isFinite(s.loadFactor)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `cd frontend && npx vitest run src/sim/biz-envelope.test.ts`. Expected: FAIL — `loadBiz` is not exported.

- [ ] **Step 3: Create `frontend/src/params/biz.json`** with these starting values (internally consistent; turbofan like `b738`, no afterburner). Numbers are Citation Latitude-class starting points — tune against the envelope test in Step 5, keep `sources` honest (mark TUNING KNOB vs sourced, "source verification pending" where not yet cited):

```json
{
  "id": "biz",
  "label": "BIZ",
  "modelNote": "CITATION-CLASS MODEL",
  "massKg": 11500,
  "wingAreaM2": 30.0,
  "wingSpanM": 15.5,
  "aspectRatio": 8.0,
  "aero": {
    "cl0": 0.2, "clAlphaPerRad": 5.2, "stallAlphaRad": 0.30, "postStallDecayRad": 0.18,
    "cd0": 0.020, "gearDragCd0": 0.02, "oswaldE": 0.80, "cyBeta": -0.85
  },
  "control": {
    "rollRateMaxRadS": 0.9, "pitchRateMaxRadS": 0.35, "yawRateMaxRadS": 0.2,
    "rollDampingPerS": 3.0, "pitchDampingPerS": 2.5, "yawDampingPerS": 2.0,
    "pitchStiffnessPerS2": 3.0, "yawStiffnessPerS2": 2.2, "refDynamicPressurePa": 6500,
    "trimAlphaCenterRad": 0.03, "trimAlphaRangeRad": 0.13
  },
  "propulsion": {
    "maxPowerW": 11800000, "lapseModel": "turbofan", "propEfficiency": 0.85,
    "propPeakSpeedMs": 250, "afterburnerFactor": 1.0
  },
  "limits": {
    "vneIasMs": 156.9, "vnoIasMs": 148.0, "vfeIasMs": 105.0, "gLimitPos": 3.0,
    "gLimitNeg": -1.0, "serviceCeilingM": 13716, "mmo": 0.80, "vleIasMs": 113.0
  },
  "flaps": [
    { "label": "0", "dCL0": 0.0, "dStallAlphaRad": 0.0, "dCD0": 0.0 },
    { "label": "1", "dCL0": 0.3, "dStallAlphaRad": -0.02, "dCD0": 0.01 },
    { "label": "2", "dCL0": 0.6, "dStallAlphaRad": -0.05, "dCD0": 0.03 },
    { "label": "FULL", "dCL0": 0.9, "dStallAlphaRad": -0.09, "dCD0": 0.07 }
  ],
  "gear": "retractable",
  "display": { "asiMinKt": 60, "asiMaxKt": 400, "attitudeStyle": "ball" },
  "sources": {
    "massKg": "TUNING KNOB (cruise/climb) — 11.5 t mid-mission weight (Citation Latitude MTOW ~13.97 t / 30,800 lb). Pinned by the FL430 cruise trim + sea-level climb tests.",
    "wingAreaM2": "TUNING KNOB — 30.0 m^2, wing loading ~376 kg/m^2 at 11.5 t (mid-size-jet band). Citation Latitude published geometry pending source verification.",
    "wingSpanM": "derived-consistent with aspectRatio: sqrt(AR*S) = sqrt(8.0*30.0) = 15.49 m.",
    "aspectRatio": "TUNING KNOB — 8.0, typical mid-size-jet AR; b^2/S = 15.5^2/30.0 = 8.0.",
    "propulsion": "TUNING KNOBS — 2x flat-rated turbofan via shared T=eta*P/max(V,peak): peak 250 m/s > max cruise TAS so thrust is constant (flat-rated). maxPowerW 11.8 MW gives eta*P/250 = 0.85*11.8e6/250 = 40.1 kN rated thrust; T/W ~0.36 at 11.5 t. afterburnerFactor 1.0 (no afterburner). lapseModel turbofan (shared with b738). Citation Latitude 2x PW306D1 ~5,907 lbf static each — source verification pending.",
    "limits": "Vmo ~305 KIAS = 156.9 m/s; Mmo 0.80; ceiling 45,000 ft = 13,716 m; Vle ~220 KIAS = 113 m/s; g +3.0/-1.0 (bizjet clean envelope). Placards are display-only except Mmo/g which the sim enforces. Source verification pending.",
    "flaps": "0/1/2/FULL — simplified bizjet schedule; dCL0/dStall/dCD0 are TUNING KNOBS giving falling stall speed + rising drag.",
    "display": "ASI 60-400 kt; attitudeStyle ball (EFIS horizon disc)."
  }
}
```

- [ ] **Step 4: Add the loader to `frontend/src/sim/params.ts`.** After `loadF5e`, mirroring its cache pattern; add the switch case:

```ts
import bizRaw from "../params/biz.json";
// ...
let cachedBiz: ClassParams | null = null;
/** The Citation-class business-jet class (turbofan, no afterburner). */
export function loadBiz(): ClassParams {
  if (cachedBiz === null) cachedBiz = validateClassParams(bizRaw);
  return cachedBiz;
}
// ...in loadClassById switch, before default:
    case "biz": return loadBiz();
```

- [ ] **Step 5: Run the envelope test; tune `biz.json` until green.** Run: `cd frontend && npx vitest run src/sim/biz-envelope.test.ts`. If cruise Mach is off, adjust `maxPowerW`/`cd0`; if stall band is off, adjust `stallAlphaRad`/`cl0`/`clAlphaPerRad`; if the +3.0 g clamp isn't reached, raise the entry speed in the test (as the b738 test documents). Update the affected `sources` notes to describe what each tuned number now pins. Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/params/biz.json frontend/src/sim/params.ts frontend/src/sim/biz-envelope.test.ts
git commit -m "feat(sim): Citation-class bizjet flight params + envelope test (biz)"
```

---

### Task 2: Bizjet mission profile, dashboard profile, and model dimensions

**Files:**
- Create: `frontend/src/mission/profiles/biz.json`
- Modify: `frontend/src/mission/profiles.ts` (add `"biz"` to the `validateMissionProfile` class allowlist, line ~29 — the runtime string check, NOT the union yet)
- Modify: `frontend/src/globe/aircraftModelDims.ts` (add `MODEL_DIMS.biz`)
- Modify: `frontend/src/dashboard/profiles.ts` (add `PROFILES.biz` — `Record<string>`, throws at runtime otherwise)
- Test: `frontend/src/globe/aircraftModelDims.test.ts` (add a biz dims case); `frontend/src/dashboard/profiles.test.ts` (add a biz profile case)

**Interfaces:**
- Consumes: `validateMissionProfile` (profiles.ts); `modelDimsForClass` (aircraftModelDims.ts); `profileForClass` (dashboard/profiles.ts) — all string-keyed, no union dependency.
- Produces: `modelDimsForClass("biz")` returns dims; `profileForClass("biz")` returns an EFIS dashboard profile; a valid `biz` mission profile JSON that `validateMissionProfile` accepts.

- [ ] **Step 1: Write the failing dims test.** In `aircraftModelDims.test.ts`, add:

```ts
it("resolves biz model dimensions (swept low-wing twinjet with nacelles)", () => {
  const d = modelDimsForClass("biz");
  expect(d.wingSweepRad).toBeGreaterThan(0);
  expect(d.engine?.count).toBe(2);
  expect(d.lengthM).toBeGreaterThan(15);
  expect(d.lengthM).toBeLessThan(25);
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `cd frontend && npx vitest run src/globe/aircraftModelDims.test.ts`. Expected: FAIL — `modelDimsForClass("biz")` throws `unknown class id: biz`.

- [ ] **Step 3: Add `MODEL_DIMS.biz`** to `aircraftModelDims.ts` (Citation-class proportions — mid-size, swept low wing, aft fuselage-mounted nacelles, T-tail-ish high tailplane; dims are visual TUNING KNOBS):

```ts
  biz: {
    lengthM: 19.0,
    wingSpanM: 15.5,
    wingSweepRad: (20 * Math.PI) / 180,
    wingChordM: 2.6,
    wingXFrac: 0.40,
    wingZFrac: 0.7, // low wing
    wingTipChordFrac: 0.45,
    engine: { count: 2, spanFracs: [-0.18, 0.18], lengthM: 2.4, radiusM: 0.55 }, // aft-fuselage-mounted, tucked inboard
    tailSpanM: 6.4,
    tailChordM: 1.8,
    finHeightM: 3.2,
    fuselageRadiusM: 0.95,
  },
```

- [ ] **Step 4: Run the dims test; adjust by eye later in the browser.** Run: `cd frontend && npx vitest run src/globe/aircraftModelDims.test.ts`. Expected: PASS.

- [ ] **Step 5: Write the failing dashboard-profile test.** In `dashboard/profiles.test.ts`, add:

```ts
it("gives the bizjet an EFIS dashboard profile", () => {
  expect(profileForClass("biz")).toEqual({ classId: "biz", primary: "efis", background: "transparent" });
});
```

- [ ] **Step 6: Run it, verify it fails, then add `PROFILES.biz`** to `dashboard/profiles.ts`:

```ts
  biz: { classId: "biz", primary: "efis", background: "transparent" },
```

Run: `cd frontend && npx vitest run src/dashboard/profiles.test.ts`. Expected: PASS.

- [ ] **Step 7: Create `frontend/src/mission/profiles/biz.json`.** Copy `mission/profiles/b738.json` and adjust for a mid-size jet: slower planning speeds and shorter/narrower runway minimums than the 737, but faster/longer than the C172. Keep the SAME `profileVersion`/`assignmentVersion`/`scoringVersion` date-tag format. Key changes from b738:

```json
{
  "classId": "biz",
  "profileVersion": "mission-biz-2026-08-13-v1",
  "assignmentVersion": "assignment-2026-08-10-v1",
  "scoringVersion": "scoring-2026-08-10-v1",
  "reachability": { "maxMinutes": 30, "minDestinationNm": 20, "defaultPlanningSpeedKt": 380, "minPlanningSpeedKt": 180, "maxPlanningSpeedKt": 440 },
  "runway": { "airportSizes": ["medium", "large"], "surfaces": ["HARD"], "minLengthFt": 4500, "minWidthFt": 75, "requireLighted": false, "requireBothEnds": true, "maxAirportElevationFt": 9000, "maxInitialHeadingDeltaDeg": 100 },
  "ranking": { "lengthMarginWeight": 40, "widthMarginWeight": 20, "lightedBonus": 8, "hardSurfaceBonus": 10, "minutePenalty": 0.2 },
  "guidance": { "approachLengthNm": 9, "corridorWidthFt": 1200, "gateSpacingNm": 1, "glideSlopeDeg": 3, "flareHeightFt": 35 },
  "landing": { "requireGearDown": true, "maxSinkRateFpm": 720, "maxAbsBankDeg": 8, "minPitchDeg": -3, "maxPitchDeg": 12, "minTouchdownSpeedKt": 100, "maxTouchdownSpeedKt": 150, "maxLoadFactor": 2.1, "maxRolloutCrossTrackFt": 55 },
  "scoreCurves": { "verticalSpeedFpm": [{"value":100,"score":1},{"value":360,"score":0.7},{"value":720,"score":0}], "centerlineErrorFt": [{"value":0,"score":1},{"value":18,"score":0.7},{"value":55,"score":0}], "touchdownZoneFt": [{"value":700,"score":1},{"value":1600,"score":0.6},{"value":2800,"score":0}], "headingErrorDeg": [{"value":0,"score":1},{"value":3,"score":0.7},{"value":10,"score":0}], "speedErrorKt": [{"value":0,"score":1},{"value":7,"score":0.6},{"value":18,"score":0}], "bankDeg": [{"value":0,"score":1},{"value":3,"score":0.6},{"value":8,"score":0}], "rolloutCrossTrackFt": [{"value":0,"score":1},{"value":18,"score":0.7},{"value":55,"score":0}] }
}
```

- [ ] **Step 8: Add `"biz"` to the `validateMissionProfile` class allowlist** in `mission/profiles.ts` (~line 29): change `(["c172s", "b738", "f5e"] as const)` to `(["c172s", "b738", "f5e", "biz"] as const)`. (Do NOT touch the `profiles` `Record<AircraftClassId>` object or `allMissionProfiles()` yet — those are wired in Task 3 with the union flip.) Add a throwaway inline test call to confirm the JSON validates, or rely on Task 3's wiring test. Run the existing profile tests: `cd frontend && npx vitest run src/mission/profiles.test.ts`. Expected: PASS (no regressions).

- [ ] **Step 9: Commit.**

```bash
git add frontend/src/mission/profiles/biz.json frontend/src/mission/profiles.ts frontend/src/globe/aircraftModelDims.ts frontend/src/globe/aircraftModelDims.test.ts frontend/src/dashboard/profiles.ts frontend/src/dashboard/profiles.test.ts
git commit -m "feat(mission): bizjet mission profile, EFIS dashboard profile, model dims (biz)"
```

---

### Task 3: Integrate `biz` into the class system (union flip + all consumers + resolution)

This is the compiler-guided integration task. Flipping the `AircraftClassId` union breaks `tsc`; the task is done when `tsc` is green again AND a real bizjet designator resolves to `biz`. **Use `npm run typecheck` output as the checklist** — every `Record<AircraftClassId>` consumer will be flagged.

**Files:**
- Modify: `frontend/src/mission/types.ts:1` (union), `frontend/src/mission/profiles.ts` (`profiles` object + `allMissionProfiles`), `frontend/src/briefing/MissionTray.tsx` (`CLASS_LABELS`), `frontend/src/freeflight/freeFlight.ts` (`FREE_FLIGHT_CLASSES` + `MISSION_IDS`), `frontend/src/panels/ContactList.tsx:14` (`ContactClassFilter`), `frontend/src/leaderboards/LeaderboardPanel.tsx:9` (`CLASS_IDS`), `frontend/src/takeover/eligibility.ts` (`resolveClass` bucket), `worker/http/routes/missions.ts:121` (validator chain)
- Create: `frontend/src/params/biz-types.json` (designator list)
- Test: `frontend/src/takeover/eligibility.test.ts` (biz bucket case)

**Interfaces:**
- Consumes: everything from Tasks 1-2 (`loadBiz`, biz mission/dashboard profiles, `MODEL_DIMS.biz`).
- Produces: `resolveClass(contact)` returns `{ supported: true, classId: "biz", matched: true }` for a Citation/Learjet/Gulfstream/Phenom/Challenger designator; `AircraftClassId` includes `"biz"`; the full app typechecks; `biz` appears in the leaderboard class filter and contact-list class filter.

- [ ] **Step 1: Write the failing resolution test.** In `eligibility.test.ts` `describe("resolveClass")`, add:

```ts
it("maps a business-jet designator to biz", () => {
  expect(resolveClass(contact({ t: "C25A" }))).toEqual({ supported: true, classId: "biz", matched: true });
  expect(resolveClass(contact({ t: "GLF6" }))).toEqual({ supported: true, classId: "biz", matched: true });
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `cd frontend && npx vitest run src/takeover/eligibility.test.ts`. Expected: FAIL — `C25A` currently resolves to `UNSUPPORTED AIRCRAFT TYPE`.

- [ ] **Step 3: Create `frontend/src/params/biz-types.json`** with common business-jet ICAO type designators. Starter set (extend as needed):

```json
{
  "designators": [
    "C25A", "C25B", "C25C", "C25M", "C500", "C510", "C525", "C526", "C550", "C551", "C560", "C56X", "C650", "C680", "C68A", "C700", "C750",
    "LJ23", "LJ24", "LJ25", "LJ31", "LJ35", "LJ40", "LJ45", "LJ55", "LJ60", "LJ70", "LJ75",
    "GLF2", "GLF3", "GLF4", "GLF5", "GLF6", "GALX", "G150", "G280",
    "E50P", "E55P", "E545", "E550", "PRM1",
    "CL30", "CL35", "CL60", "GL5T", "GL7T", "GLEX", "CL600", "CL604",
    "H25B", "H25C", "HDJT", "BE40", "FA10", "FA20", "FA50", "FA7X", "FA8X", "F2TH", "F900",
    "SF50"
  ]
}
```

- [ ] **Step 4: Add the biz bucket to `resolveClass`** in `eligibility.ts`. Import the JSON and add a Set + a check BEFORE the `UNSUPPORTED` fallthrough:

```ts
import bizTypes from "../params/biz-types.json";
export const BIZ_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(bizTypes.designators);
// ...inside resolveClass, after the FIGHTER check (order is not significant — the sets are disjoint):
    if (BIZ_TYPE_DESIGNATORS.has(t)) return { supported: true, classId: "biz", matched: true };
```

- [ ] **Step 5: Flip the union.** In `frontend/src/mission/types.ts:1`: `export type AircraftClassId = "c172s" | "b738" | "f5e" | "biz";`

- [ ] **Step 6: Run typecheck; fill every flagged consumer.** Run: `cd frontend && npm run typecheck`. Fix each error:
  - `mission/profiles.ts` `profiles` object → add `biz: deepFreeze(validateMissionProfile(bizRaw))` (import `bizRaw from "./profiles/biz.json"`); `allMissionProfiles()` → add `profiles.biz` to the returned array.
  - `briefing/MissionTray.tsx` `CLASS_LABELS` → add `biz: "BUSINESS JET · CITATION-CLASS MODEL"`.
  - `freeflight/freeFlight.ts` `FREE_FLIGHT_CLASSES` → add `biz: { hex: "ff0b1z", flight: "FREEBIZ", t: "C680", defaultAltitudeFt: 24_000, minAltitudeFt: 2_000, maxAltitudeFt: 45_000 }`; `MISSION_IDS` → add `biz: "00000000-0000-4000-8000-000000000204"`.
  - Any other `Record<AircraftClassId>` / exhaustive switch the compiler flags (e.g. `tutorial/progress.ts` `CLASSES` is `AircraftClassId[]` but a plain array — leave it as the original 3; biz has no tutorial. If tsc flags an exhaustive switch elsewhere, handle biz the same as b738/f5e).

- [ ] **Step 7: Add `biz` to the enumeration lists** (not compiler-forced, needed for UI):
  - `panels/ContactList.tsx:14` `ContactClassFilter` → `"all" | "c172s" | "b738" | "f5e" | "biz" | "unsupported"`. Add a `biz` filter option wherever the filter buttons/options are rendered in that file (mirror the existing `f5e` option).
  - `leaderboards/LeaderboardPanel.tsx:9` `CLASS_IDS` → add `"biz"` so the leaderboard board filter offers it.

- [ ] **Step 8: Widen the worker mission validator.** `worker/http/routes/missions.ts:121`: change `(value.classId === "c172s" || value.classId === "b738" || value.classId === "f5e")` to also include `|| value.classId === "biz"`. Run the worker tests: `cd frontend && npx vitest run --config vitest.worker.config.ts` (or the project's worker test command) to confirm no regression.

- [ ] **Step 9: Run the resolution test + typecheck; both green.** Run: `cd frontend && npx vitest run src/takeover/eligibility.test.ts && npm run typecheck`. Expected: PASS + clean typecheck.

- [ ] **Step 10: Commit.**

```bash
git add frontend/src/mission/types.ts frontend/src/mission/profiles.ts frontend/src/briefing/MissionTray.tsx frontend/src/freeflight/freeFlight.ts frontend/src/panels/ContactList.tsx frontend/src/leaderboards/LeaderboardPanel.tsx frontend/src/takeover/eligibility.ts frontend/src/takeover/eligibility.test.ts frontend/src/params/biz-types.json worker/http/routes/missions.ts
git commit -m "feat: resolve business-jet designators to the biz class + wire all consumers"
```

---

### Task 4: Full gate, decision log, deploy, device-verify

**Files:**
- Modify: `docs/decisions.md` (append the biz archetype entry)
- Modify: `docs/summaries/CHECKLIST.md` (tick the bizjet item)

- [ ] **Step 1: Append a `docs/decisions.md` entry** dated 2026-08-13: representative airframe (Citation Latitude-class), that `biz` is data-only reusing the shared turbofan formula, the tuning-knob vs sourced status of the key numbers, and that Citation Latitude published performance figures still need source verification (CLAUDE.md gate). Note the new leaderboard board starts empty (honest).

- [ ] **Step 2: Run the full gate.** Run: `cd frontend && npm run typecheck && npm run test:unit && npm run lint`. Expected: typecheck clean, all unit tests pass (suite grows by the biz tests), lint ≤8 warnings (no new ones). Fix anything red before proceeding.

- [ ] **Step 3: Commit the docs.**

```bash
git add docs/decisions.md docs/summaries/CHECKLIST.md
git commit -m "docs: log the bizjet archetype decision + tick checklist"
```

- [ ] **Step 4: Deploy to production and push.** Run: `cd frontend && npm run deploy:production` then `git push origin mongols-rich-hud`. Capture the deployed Worker Version id.

- [ ] **Step 5: Device-verify (owner).** On the live site, find a business-jet contact (Citation/Gulfstream/Learjet — check the contact list; the class filter now has a BIZ option). Confirm: it is takeover-eligible (was UNSUPPORTED), the briefing shows `BUSINESS JET · CITATION-CLASS MODEL`, TAKE CONTROLS starts a flight, the aircraft flies a believable mid-jet (cruises ~M0.78, doesn't fall out of the sky or rocket away), the low-poly model reads as a twinjet, and the debrief records a `biz` mission. Report back; tune `biz.json`/dims if the feel or silhouette is off.

---

## Self-Review

**Spec coverage:** Spec §3 (biz archetype: Citation Latitude, turbofan, retractable) → Task 1. §4 touchpoints (params, profile, dims, union, loadClassById, validateMissionProfile, worker validator, CLASS_LABELS, resolveClass buckets, envelope test) → Tasks 1–3, each item mapped. §5 leaderboards (biz board starts sparse, allowlist widened via `CLASS_IDS` + worker validator) → Task 3 Steps 7–8. §6 envelope acceptance (trim, stall band, climb, Vne/g, roll authority) → Task 1 Step 1 tests. §7 sequencing (TDD → gate → deploy → verify) → Task 4. §8 success criteria → Task 4 Step 5. Turboprop/heavy are separate future plans (spec §7), correctly out of this plan.

**Placeholder scan:** No TBD/TODO. Every JSON and test step has literal content. The only deliberately-deferred items are the source-verification citations (explicitly a CLAUDE.md gate, logged in Task 4 Step 1) and browser-eye tuning of dims (Task 4 Step 5) — both are named actions, not vague placeholders.

**Type consistency:** `loadBiz`/`loadClassById("biz")`/`id: "biz"` (Task 1) ↔ `AircraftClassId` union member `"biz"` (Task 3 Step 5) ↔ `Record<AircraftClassId>` fills (Task 3 Step 6) ↔ `resolveClass` returning `classId: "biz"` (Task 3 Step 4) all agree. Mission profile `classId: "biz"` (Task 2) matches the validator allowlist string (Task 2 Step 8) and the union (Task 3). `PROFILES.biz`/`MODEL_DIMS.biz` are `Record<string>` (Task 2), consistent with their string-keyed lookups. Free-flight `FREE_FLIGHT_CLASSES.biz`/`MISSION_IDS.biz` keyed by the union member (Task 3). No signature drift.
