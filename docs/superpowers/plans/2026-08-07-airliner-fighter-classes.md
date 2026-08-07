# Airliner (737-800) + Fighter (F-5E) Controllable Classes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do TDD in the order written: failing test → run-to-fail → minimal impl → run-to-pass → commit. **Stop and wait for owner sign-off at the end of Task 8** (data files complete, both jets fly in tests) and again at the end of Task 10 (wired end-to-end), per CLAUDE.md ground rule 5.

**Goal:** Let the player TAKE CONTROLS of a real airliner or fast-jet seen in the live ADS-B feed. The flight model is inferred from the contact's real ICAO type designator; the handoff card discloses the substitution (e.g. `A320 → 737-800 MODEL`). Ship two sourced data files (`b738.json`, `f5e.json`) and five small shared code seams — turbofan power lapse, an afterburner dry/wet toggle, a Mach limit, a per-class ASI face, and a per-class attitude ("horizon ball") indicator — plus a class resolver that grows `takeover/eligibility.ts` from a GA-only gate into a type→class mapper. **Every class difference stays data; there are no per-class code branches.**

**Architecture:** The pure `sim/` core stays Cesium-free and fully unit-testable (spec §Stack). New behaviour is added to the existing shared modules only: `sim/types.ts` (one new `LapseModel` value, one new `ControlVector` field, three new `ClassParams` fields), `sim/params.ts` (validator gains the three required fields; loading generalises from `loadC172()` to a class registry), `sim/forces.ts` (`POWER_LAPSE_MODELS.turbofan`; `thrustNewtons` gains an afterburner factor), `sim/isa.ts` (speed of sound + Mach), `dashboard/gaugeMath.ts` + `SixPack.tsx` (per-class ASI range + attitude style), `hud/snapshot.ts` + `game/flightLoop.ts` + `hud/format.ts` (Mach annunciator), and `takeover/eligibility.ts` (the resolver + disclosure). Two new data files (`params/b738.json`, `params/f5e.json`) and two new designator lists (`params/airliner-types.json`, `params/fighter-types.json`) join the existing `params/ga-types.json`. `game/FlightSession.tsx` and `dashboard/DashboardStrip.tsx` select the class from the origin contact instead of hard-loading the C172.

**Tech Stack:** Vite · React 18 + TypeScript · CesiumJS 1.143 (keyless, `Ion.defaultAccessToken = null`) · Zustand · Tailwind (layout only) + hand-written `styles/tokens.css` · Python 3.12 + FastAPI (backend untouched). Tests are **vitest in the node environment** (no jsdom, no `@testing-library/*`): components are tested by calling them as functions and walking the returned element tree. Gates: `cd frontend && npm test` (= `vitest run`), `cd frontend && npx tsc --noEmit`, `cd frontend && npm run build`.

## Global Constraints

These are binding for every task. Values in the first three are copied verbatim from the design spec (`docs/superpowers/specs/2026-08-07-airliner-fighter-classes-design.md`) and CLAUDE.md.

- **One force model, data not branches (spec §1, §2, §Ground rule; CLAUDE.md "Flight model"):** *"one fixed-wing 6-DOF force model, parameterized entirely by data files — no per-class code branches. This feature adds two sourced data files and five small shared code seams; every class difference stays data."* Concretely: no `if (class === …)` anywhere; the turbofan is expressed by tuning `maxPowerW` + `propPeakSpeedMs` on the **existing** prop formula (spec §2.1 — *"the alternative (a jet-specific thrust branch) is rejected"*); afterburner is `boolean × afterburnerFactor` data (`afterburnerFactor` 1.0 leaves a class unaffected — no branch); lapse is selected by the `lapseModel` key, never assumed.
- **Honest-data rule (CLAUDE.md ground rule 1, verbatim):** *"The only synthesized object is the player's aircraft. Live contacts are real or absent; feeds down = explicit offline state; unknown fields render as em-dash (—). Never mock, sample, or synthesize feed data to make a screen look finished."* In this feature that means: the class is inferred from the **real** feed type designator; where no designator matches, the sim substitutes the C172 default and **says so** on the handoff card (`… → C172 MODEL (NO MATCHING CLASS)`) — coverage is honest via disclosure, not completeness (spec §9). A missing/unknown type renders `—` on the card, never a guessed type.
- **Sim state unmistakable (CLAUDE.md ground rule 2):** the persistent `SIM` banner, the amber SIM accent, and the synthetic `SIM-<hex>` callsign are unchanged by this feature; the genuine aircraft stays on the live feed as a ghost. Do not touch that machinery.
- **No new dependencies (spec §Stack / CLAUDE.md ground rule 3):** *"Ask before adding any dependency beyond the approved list."* Gauges and the horizon ball are hand-rolled SVG. `git diff --stat main -- frontend/package.json` must show **zero** dependency lines added at every task boundary.
- **Validator has no silent defaults (spec §6, verbatim):** *"The validator REQUIRES `limits.mmo`, `propulsion.afterburnerFactor`, and the `display` block in every params file — no silent defaults, same discipline as `lapseModel`. This forces `c172.json` to be updated too."* An absent or malformed field is a **load-time error**, matching the existing hand-written validator style in `sim/params.ts` (no schema library — dependency list stays untouched).
- **F-5E numbers need source verification (spec §3, §9; CLAUDE.md "Flight model"):** *"fighter numbers need Phase B source verification."* Every number in `f5e.json` (and `b738.json`) carries a `sources` entry: a book value, a JSBSim/OpenAP cross-check, or the literal string `TUNING KNOB` **with the envelope-test target it was tuned against** — exactly the discipline `c172.json` already follows. Unsourced fighter aero/thrust numbers ship as `TUNING KNOB` with a measured target, never as bare guesses.
- **F-5E is capped subsonic (spec §1, §7):** the model has no wave-drag physics, so `f5e.json` ships `limits.mmo ≈ 0.95` and the Mach annunciator trips there. Supersonic + wave drag is deferred to issue #2; do not add a supersonic code path.
- **Mission-terminal palette (spec §2.5; CLAUDE.md "Visual direction"):** near-black `#05070a`, amber `#ffb000` (SIM accent + warnings), cyan `#5fd7e0` (nominal data), monospace, uppercase letterspaced labels, 1px borders, bracket corners, translucent panels, no rounded corners > 2px, no shadows, no gradients. The horizon ball is **palette-safe** (spec §2.5, owner choice): *"dim cyan-tinted sky, darker/olive ground … NOT garish blue/brown; NO shadows."* Every new colour is a variable in `styles/tokens.css` — no new hex literals in components.
- **Pure core stays testable (spec §Stack):** `sim/` has no Cesium imports; `gaugeMath.ts` stays React/Cesium-free (plain numbers in, plain numbers out). `SixPack.tsx` stays hook-free so tests can call it as a function.
- **Decisions log (CLAUDE.md ground rule 4):** append a dated entry to `docs/decisions.md` for every non-obvious call — this feature's entries are numbered **AF-001 … AF-006** ("airliner/fighter"), continuing the `G-00x` / `B-0xx` / `CD-0xx` convention. The six calls to log are enumerated in spec §8; the steps below say exactly when.
- **Each task ends with the full frontend suite green, `npx tsc --noEmit` clean, `npm run build` clean, and exactly ONE commit.** Intermediate TDD cycles inside a task end at a passing run, not at a commit.

## Source documents

- **This feature's spec (authoritative):** `docs/superpowers/specs/2026-08-07-airliner-fighter-classes-design.md` (§1 … §9)
- Founding spec: `docs/superpowers/specs/2026-07-27-adsb-game-design.md` (§14 dependency list, flight-model rules)
- Format precedent (task/step shape this plan mirrors): `docs/superpowers/plans/2026-08-07-cockpit-dashboard.md`
- Carried decisions: `docs/decisions.md` — B-006 (mass compromise), B-007 (rate-command moments), G-003 (ellipsoidal datum), CD-002/CD-004 (gauge honesty), CD-003 (sourced ASI arcs)
- Aero source notes: `docs/research/aero-parameters.md`

## Test-runner reality (verified against `frontend/package.json`, 2026-08-07)

| What | Command |
|---|---|
| Full frontend suite | `cd frontend && npm test` (= `vitest run`) |
| One file | `cd frontend && npm test -- src/sim/params.test.ts` |
| Typecheck | `cd frontend && npx tsc --noEmit` |
| Production build | `cd frontend && npm run build` |

vitest runs in the **node** environment. No module may touch `document` at import time; Cesium imports fine in node but a `Viewer` may not be constructed in a test.

## Spec requirement map — every §-clause to a task

| Spec clause | Requirement | Task |
|---|---|---|
| §2.1 | `LapseModel` gains `"turbofan"`; `POWER_LAPSE_MODELS.turbofan`; validator list in sync | 1 (type + validator), 2 (curve) |
| §2.1 | flat thrust via `maxPowerW`/`propPeakSpeedMs` on the prop formula, no jet branch | 2 (curve), 7 (b738 tuning), 8 (f5e tuning) |
| §2.2 | `ControlVector.afterburner`; `propulsion.afterburnerFactor` required (1.0 where none) | 1 (fields), 3 (thrust + `KeyB`) |
| §2.2 | `thrustNewtons` multiplies shaft power by `afterburner ? factor : 1` | 3 |
| §2.2 | `KeyB` edge-triggered toggle → `GAME_KEY_CODES` + `KEYMAP` + `ControlsHelp`, guarded | 3 |
| §2.3 | `limits.mmo` required everywhere; C172 gets an unreachable value | 1 (field + c172), 7/8 (jet Mmo) |
| §2.3 | speed of sound + Mach in `isa.ts`; Mach in `ForceResult`/`SimState`/`HudSnapshot` | 4 |
| §2.3 | HUD Mach-overspeed annunciator alongside IAS/Vne overspeed; ASI face unchanged | 4 |
| §2.4 | per-class ASI range in `display`; `asiNeedle`/`asiDegFor`/`asiArcs` + `SixPack` thread it | 1 (field), 5 |
| §2.5 | `display.attitudeStyle: "line"｜"ball"`; palette-safe filled ADI for jets | 1 (field), 6 |
| §3 | `b738.json` sourced data file | 7 |
| §3 | `f5e.json` sourced data file, unsourced numbers `TUNING KNOB` + target | 8 |
| §3 | `c172.json` gains `limits.mmo`, `propulsion.afterburnerFactor` 1.0, `display` | 1 |
| §4 | `resolveClass(contact) → classId`; three designator lists; unknown/missing/unmatched → c172s | 9 |
| §4 | drop the military hard-block; keep every physical gate | 9 |
| §4 | disclosure `<REAL TYPE> → <MODEL> MODEL` on the handoff card | 9 (string), 10 (card) |
| §4 | TAKE CONTROLS button + tooltip keep the SAME predicate | 9, 10 |
| §5 | b738 envelope: cruise ~M0.78 @ FL350, Vmo/Mmo bite, ceiling, g-clamp +2.5/−1.0 | 7 |
| §5 | f5e envelope: climb sane, dry-vs-wet thrust delta, Mmo cap, fighter g-limits | 8 |
| §5 | params.test: new required fields validate, absence is a load-time error | 1 |
| §6 | validator requires `mmo`, `afterburnerFactor`, `display` in every file | 1 |
| §6 | per-class ASI face + attitude style ship this feature (no jet flies the C172 gauge) | 5, 6, 10 |

## Signature decisions (made while reading the real code — consistent across all tasks)

1. **`ControlVector.afterburner: boolean` is REQUIRED, not optional.** `ControlVector` has no optional fields today; adding the first one would be a silent-default smell, and the codebase constructs the vector in exactly a handful of places. Task 1 sweeps every `ControlVector` literal (`grep -rn "flapDetent:" frontend/src` — sites: `input/controls.ts`, `takeover/spawn.ts`, `sim/types.ts` doc, `sim/envelope.test.ts`, `sim/aircraft.test.ts`, `sim/forces.test.ts`, `input/controls.test.ts`) and adds `afterburner: false`. Existing test **assertions** are untouched, so they still pass.
2. **`thrustNewtons` gains a trailing `afterburner: boolean = false` param (defaulted).** Defaulting the trailing arg keeps the existing call in `sim/envelope.test.ts` (`levelFlightExcessThrustN`) compiling unchanged; `computeForces` passes `controls.afterburner` explicitly. This is a function-arg default (a code convenience), NOT a data silent-default — the no-silent-default rule targets validated `ClassParams`, and `afterburnerFactor` stays required there.
3. **Loading generalises to a registry.** `loadC172()` stays (many tests import it); Task 7/8 add `loadB738()` / `loadF5e()` with their own caches, and a `loadClassById(id: string): ClassParams` switch used by the resolver-driven UI (Task 10). Unknown id → throws (a programming error, never a data path).
4. **`resolveClass` always resolves** (fighter→`f5e`, airliner→`b738`, GA→`c172s`, else→`c172s`) and returns `{ classId, matched }`. `checkEligibility` keeps only the **physical** gates; the type-membership refusal and the military refusal are dropped (spec §4). Disclosure carries the `matched` flag so the card can print `(NO MATCHING CLASS)`.
5. **Per-file `modelNote` is the short model token** used in the disclosure line: `c172.json` keeps `"C172 MODEL THIS BUILD"`; `b738.json` uses `"737-800 MODEL"`; `f5e.json` uses `"F-5E MODEL"`. The card renders `${contact.t ?? "—"} → ${params.modelNote}${matched ? "" : " (NO MATCHING CLASS)"}`.
6. **The Mach annunciator string is `"MMO"`** (distinct from the existing `"OVERSPEED"` IAS/Vne warning), pushed by `warningsFor` when `machOverspeed` is true. `machNumber` is carried in the snapshot but the ASI face is not repainted (spec §2.3, §7 — Mach is an annunciator, not on the steam gauge).

---

## Task 1 — Types, validator, and `c172.json` new required fields (foundation)

Foundation for everything: add the new `LapseModel` value and the new `ControlVector` / `ClassParams` fields, make the validator require them with no silent default, and update `c172.json` so the shipped file still loads. Nothing here changes flight behaviour — the C172 envelope suite must stay green.

**Files:**
- Modify: `frontend/src/sim/types.ts` (`LapseModel` line 19; `ClassParams.propulsion` lines 79–90; `ClassParams.limits` lines 91–100; new `ClassParams.display` after `gear` line 102; `ControlVector` lines 108–121 + its doc comment)
- Modify: `frontend/src/sim/params.ts` (`LAPSE_MODELS` line 44; `validateClassParams` propulsion block lines 122–127, limits block lines 128–135; new `display` validation + `DisplayBlock` handling)
- Modify: `frontend/src/input/controls.ts` (`COLD` line 61; sampler return line 107)
- Modify: `frontend/src/params/c172.json` (add `propulsion.afterburnerFactor`, `limits.mmo`, `display`; add `sources` entries)
- Modify (literal sweep, `afterburner: false`): `frontend/src/takeover/spawn.ts` (line 160), `frontend/src/sim/envelope.test.ts` (lines 105, 134, 167, 215, 229, 249), `frontend/src/sim/aircraft.test.ts`, `frontend/src/sim/forces.test.ts`, `frontend/src/input/controls.test.ts`
- Modify: `frontend/src/sim/params.test.ts` (new cases)

**Interfaces:**
- Produces:
  - `sim/types.ts`: `LapseModel = "piston" | "none" | "turbofan"`
  - `sim/types.ts`: `type AttitudeStyle = "line" | "ball"`
  - `sim/types.ts`: `ClassParams.propulsion` gains `afterburnerFactor: number`
  - `sim/types.ts`: `ClassParams.limits` gains `mmo: number`
  - `sim/types.ts`: `ClassParams` gains `display: { asiMinKt: number; asiMaxKt: number; attitudeStyle: AttitudeStyle }`
  - `sim/types.ts`: `ControlVector` gains `afterburner: boolean`
  - `sim/params.ts`: `validateClassParams` enforces all four; `LAPSE_MODELS` includes `"turbofan"`
- Consumes: existing `num`/`positive`/`str`/`asRecord` helpers in `sim/params.ts`.

Steps:

- [ ] **Step 1 — Confirm the baseline.** `cd frontend && npm test && npx tsc --noEmit`. Record the passing counts (Test Files / Tests). If anything is red, stop — the plan assumes a green baseline on this branch.

- [ ] **Step 2 — Failing validator tests first.** Append to `frontend/src/sim/params.test.ts` inside the `describe("validateClassParams", …)` block:

```ts
  it("accepts turbofan as a lapse model", () => {
    const p = loadC172();
    const jet = {
      ...(p as unknown as Record<string, unknown>),
      propulsion: { ...p.propulsion, lapseModel: "turbofan" },
    };
    expect(validateClassParams(jet).propulsion.lapseModel).toBe("turbofan");
  });
  it("rejects a missing propulsion.afterburnerFactor rather than defaulting", () => {
    const p = loadC172();
    const { afterburnerFactor: _omitted, ...propulsion } = p.propulsion as Record<string, unknown>;
    const bad = { ...(p as unknown as Record<string, unknown>), propulsion };
    expect(() => validateClassParams(bad)).toThrow(/afterburnerFactor/);
  });
  it("rejects a missing limits.mmo rather than defaulting", () => {
    const raw = JSON.parse(JSON.stringify(c172Raw)) as Record<string, unknown>;
    delete (raw.limits as Record<string, unknown>).mmo;
    expect(() => validateClassParams(raw)).toThrow(/mmo/);
  });
  it("rejects a missing display block", () => {
    const raw = JSON.parse(JSON.stringify(c172Raw)) as Record<string, unknown>;
    delete raw.display;
    expect(() => validateClassParams(raw)).toThrow(/display/);
  });
  it("rejects an unknown attitudeStyle", () => {
    const raw = JSON.parse(JSON.stringify(c172Raw)) as Record<string, unknown>;
    (raw.display as Record<string, unknown>).attitudeStyle = "sphere";
    expect(() => validateClassParams(raw)).toThrow(/attitudeStyle/);
  });
```

Extend the existing `loadC172` case to assert the new fields load:

```ts
    expect(p.propulsion.afterburnerFactor).toBe(1.0);
    expect(p.limits.mmo).toBeGreaterThan(0);
    expect(p.display.asiMinKt).toBe(40);
    expect(p.display.asiMaxKt).toBe(180);
    expect(p.display.attitudeStyle).toBe("line");
```

- [ ] **Step 3 — Run to fail.** `cd frontend && npm test -- src/sim/params.test.ts`. Expect the five new cases to fail (fields absent / not validated) and the extended `loadC172` assertions to fail. TypeScript will also flag `p.propulsion.afterburnerFactor` etc. as unknown until Step 4 — that is the failing state.

- [ ] **Step 4 — Add the types.** In `frontend/src/sim/types.ts`:

Line 19 — extend `LapseModel` and its doc:

```ts
export type LapseModel = "piston" | "none" | "turbofan";
```

Add after `LapseModel` (near line 20):

```ts
/** ASI face style is data: C172 keeps its minimalist line horizon, jets get a filled ball. */
export type AttitudeStyle = "line" | "ball";
```

In `ClassParams.propulsion` (after `propPeakSpeedMs`, line 89):

```ts
    /**
     * Dry→wet thrust multiplier when ControlVector.afterburner is true. 1.0 for any class
     * without an afterburner — a factor of 1 leaves thrustNewtons unchanged, so no branch.
     */
    afterburnerFactor: number;
```

In `ClassParams.limits` (after `vfeIasMs`, line 95):

```ts
    /** Max operating Mach. The HUD trips a Mach-overspeed annunciator past this. */
    mmo: number;
```

After `gear: "fixed" | "retractable";` (line 102), add the `display` block:

```ts
  /** Per-class instrument faces — data, so no jet flies the C172's 40–180 kt gauge (spec §6). */
  display: {
    asiMinKt: number;
    asiMaxKt: number;
    attitudeStyle: AttitudeStyle;
  };
```

In `ControlVector` (after `trim`, line 120):

```ts
  /** Dry (false) / wet (true) — the F-5E's burner toggle. Ignored where afterburnerFactor is 1. */
  afterburner: boolean;
```

- [ ] **Step 5 — Extend the validator.** In `frontend/src/sim/params.ts`:

Line 44 — keep the list in sync with `POWER_LAPSE_MODELS` (the comment above it already requires this):

```ts
const LAPSE_MODELS: readonly LapseModel[] = ["piston", "none", "turbofan"];
```

Add a `display` validator helper below `lapseModel` (near line 52), styled like the others:

```ts
const ATTITUDE_STYLES = ["line", "ball"] as const;

function attitudeStyle(obj: Record<string, unknown>, path: string): "line" | "ball" {
  const v = str(obj, "attitudeStyle", path);
  if (!ATTITUDE_STYLES.includes(v as (typeof ATTITUDE_STYLES)[number])) {
    throw new Error(`${path}.attitudeStyle must be one of: ${ATTITUDE_STYLES.join(", ")}`);
  }
  return v as "line" | "ball";
}
```

In the returned object's `propulsion` block (after `propPeakSpeedMs`, line 126):

```ts
      afterburnerFactor: positive(propulsion, "afterburnerFactor", "params.propulsion"),
```

In the `limits` block (after `vfeIasMs`, line 131):

```ts
      mmo: positive(limits, "mmo", "params.limits"),
```

Add a `display` const before the `return` (near line 91, next to the other `asRecord` extractions):

```ts
  const display = asRecord(o.display, "params.display");
```

and a `display` field in the returned object (after `gear`, line 137):

```ts
    display: {
      asiMinKt: positive(display, "asiMinKt", "params.display"),
      asiMaxKt: positive(display, "asiMaxKt", "params.display"),
      attitudeStyle: attitudeStyle(display, "params.display"),
    },
```

- [ ] **Step 6 — Update `c172.json`.** In `frontend/src/params/c172.json`:

In `"propulsion"` (after `"propPeakSpeedMs": 60`, line 35), add:

```json
    "afterburnerFactor": 1.0
```

In `"limits"` (after `"vfeIasMs": 43.73`, line 39), add:

```json
    "mmo": 0.45
```

After `"gear": "fixed",` (line 51), add the `display` block:

```json
  "display": { "asiMinKt": 40, "asiMaxKt": 180, "attitudeStyle": "line" },
```

Add `sources` entries (inside the `"sources"` object):

```json
    "afterburnerFactor": "1.0 — the IO-360 has no afterburner. Required in every params file so a jet class can ship a real dry→wet factor without a per-class branch; 1.0 leaves thrustNewtons unchanged.",
    "mmo": "0.45 — a value the C172 never reaches (Vh 126 kt TAS at SL is M0.19; at the 14000 ft ceiling still under M0.25). Present only so the Mach annunciator is data everywhere, per spec §2.3; not a real placard limit.",
    "display": "ASI face 40–180 kt is the existing C172 gauge range (Vs0 40.4 to Vne 163 with headroom); attitudeStyle \"line\" keeps the minimalist horizon. Jets override both."
```

- [ ] **Step 7 — Sweep the `ControlVector` literals.** Run `grep -rn "flapDetent:" frontend/src` and add `afterburner: false` to every `ControlVector` object literal it finds: `input/controls.ts` `COLD` (line 61) and the sampler's `return { … }` (line 107); `takeover/spawn.ts` line 160; and the test literals in `sim/envelope.test.ts` (lines 105, 134, 167, 215, 229, 249), `sim/aircraft.test.ts`, `sim/forces.test.ts`, `input/controls.test.ts`. Do **not** change any assertion — only add the field. Example (`controls.ts` `COLD`):

```ts
const COLD: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle: 0, flapDetent: 0, trim: 0, afterburner: false };
```

and the sampler return:

```ts
      return { pitch, roll, yaw, throttle, flapDetent, trim, afterburner: false };
```

(The live toggle wiring is Task 3; here the sampler just passes `false` so the type is satisfied.)

- [ ] **Step 8 — Run to pass.** `cd frontend && npm test -- src/sim/params.test.ts` (new cases green), then the whole suite `cd frontend && npm test`, then `npx tsc --noEmit` and `npm run build`. The C172 envelope suite must be unchanged-green. Fix any missed literal the sweep left red.

- [ ] **Step 9 — Log the decision.** Append **AF-001** to `docs/decisions.md`: three new required `ClassParams` fields (`propulsion.afterburnerFactor`, `limits.mmo`, `display`) validated with no silent default, forcing `c172.json` to carry them; `ControlVector.afterburner` required and swept through all literals.

- [ ] **Step 10 — Commit.** `git add -A && git commit -m "feat(sim): required afterburnerFactor/mmo/display + ControlVector.afterburner + turbofan lapse type"`

---

## Task 2 — Turbofan power lapse

Add the `turbofan` entry to `POWER_LAPSE_MODELS` so a flat-rated turbofan holds rated thrust up to a corner altitude and falls off with density above it. The curve constants are documented tuning knobs pinned by the b738 cruise test in Task 7.

**Files:**
- Modify: `frontend/src/sim/forces.ts` (`POWER_LAPSE_MODELS` lines 101–104; new `turbofanPowerLapse` above it near line 92)
- Modify: `frontend/src/sim/forces.test.ts` (new `describe`)

**Interfaces:**
- Produces: `forces.ts`: `turbofanPowerLapse(altitudeM: number): number`; `POWER_LAPSE_MODELS.turbofan`
- Consumes: `isaDensity`, `RHO_SL` (`sim/isa.ts`) — already imported in `forces.ts`.

Steps:

- [ ] **Step 1 — Failing test.** Append to `frontend/src/sim/forces.test.ts`:

```ts
import { turbofanPowerLapse, POWER_LAPSE_MODELS } from "./forces";
import { ftToM } from "./units";

describe("turbofan power lapse", () => {
  it("holds rated thrust (1.0) at and below the flat-rated corner altitude", () => {
    expect(turbofanPowerLapse(0)).toBeCloseTo(1, 6);
    expect(turbofanPowerLapse(ftToM(30000))).toBeCloseTo(1, 6);
  });
  it("falls below 1 above the corner and is monotone decreasing there", () => {
    const a = turbofanPowerLapse(ftToM(37000));
    const b = turbofanPowerLapse(ftToM(41000));
    expect(a).toBeLessThan(1);
    expect(b).toBeLessThan(a);
  });
  it("is registered under the turbofan lapse key", () => {
    expect(POWER_LAPSE_MODELS.turbofan(0)).toBeCloseTo(1, 6);
  });
});
```

(If `forces.test.ts` already imports from `./forces` / `./units`, merge these imports into the existing lines rather than duplicating.)

- [ ] **Step 2 — Run to fail.** `cd frontend && npm test -- src/sim/forces.test.ts`. Expect `does not provide an export named 'turbofanPowerLapse'`.

- [ ] **Step 3 — Implement.** In `frontend/src/sim/forces.ts`, add above `POWER_LAPSE_MODELS` (near line 92, next to `pistonPowerLapse`):

```ts
/**
 * Flat-rated turbofan thrust lapse. A modern high-bypass fan holds close to its rated thrust
 * from sea level up to a corner altitude (roughly the tropopause, where the flat-rating runs
 * out), then loses thrust with density in the stratosphere. Modelled as: 1.0 up to
 * TURBOFAN_CORNER_M, then (sigma/sigma_corner)^TURBOFAN_LAPSE_EXP above it.
 *
 * TUNING KNOBS (pinned by the b738 cruise envelope test, Task 7): the corner altitude and the
 * exponent. FL360 corner keeps full rated thrust available at the 737's FL350 cruise; exponent
 * 1.0 makes stratospheric thrust track density (T ∝ rho), the standard first-order jet model.
 * One shared curve for both jets in v1 (both are flat-rated turbofans); per-jet parameterisation
 * is deferred (spec §2.1) unless an envelope test demands it.
 */
export const TURBOFAN_CORNER_M = 10972; // FL360
export const TURBOFAN_LAPSE_EXP = 1.0;

export function turbofanPowerLapse(altitudeM: number): number {
  if (altitudeM <= TURBOFAN_CORNER_M) return 1;
  const sigma = isaDensity(altitudeM) / RHO_SL;
  const sigmaCorner = isaDensity(TURBOFAN_CORNER_M) / RHO_SL;
  return Math.pow(sigma / sigmaCorner, TURBOFAN_LAPSE_EXP);
}
```

Extend `POWER_LAPSE_MODELS` (lines 101–104):

```ts
export const POWER_LAPSE_MODELS: Record<LapseModel, (altitudeM: number) => number> = {
  piston: pistonPowerLapse,
  none: () => 1,
  turbofan: turbofanPowerLapse,
};
```

- [ ] **Step 4 — Run to pass.** `cd frontend && npm test -- src/sim/forces.test.ts`, then full suite + `npx tsc --noEmit`. (`LAPSE_MODELS` in `params.ts` already gained `"turbofan"` in Task 1, so the `Record<LapseModel, …>` and the validator stay in step — the two lists the code comments require to match are both current.)

- [ ] **Step 5 — Commit.** `git add -A && git commit -m "feat(sim): turbofan power lapse (flat-rated to corner, density falloff above)"`

---

## Task 3 — Afterburner thrust + input

Thread the afterburner factor into `thrustNewtons`, and add the edge-triggered `KeyB` toggle to the sampler, keymap, and controls help.

**Files:**
- Modify: `frontend/src/sim/forces.ts` (`thrustNewtons` signature lines 112–122; its call in `computeForces` lines 180–181)
- Modify: `frontend/src/input/controls.ts` (`KEYMAP` line 15–38; sampler edge-trigger near line 99–107)
- Modify: `frontend/src/input/keyboard.ts` (`GAME_KEY_CODES` lines 9–15)
- Modify: `frontend/src/dashboard/ControlsHelp.tsx` (`KEY_LABELS` lines 13–34 — add `KeyB`)
- Modify: `frontend/src/sim/forces.test.ts`, `frontend/src/input/controls.test.ts`, `frontend/src/sim/envelope.test.ts` (`levelFlightExcessThrustN` call, line 35 — pass `false`)

**Interfaces:**
- Produces: `forces.ts`: `thrustNewtons(params, throttle, tasMs, altitudeM, afterburner?: boolean): number` (trailing `afterburner` defaults `false`).
- Consumes: `ControlVector.afterburner`, `ClassParams.propulsion.afterburnerFactor` (Task 1).

Steps:

- [ ] **Step 1 — Verify `KeyB` is free.** `grep -rn "KeyB" frontend/src`. Expect no hits (the spec §2.2 note flags `KeyL` as taken by the return-to-level assist; `KeyB` should be unused). If `KeyB` is taken, stop and pick the next free letter, updating the plan.

- [ ] **Step 2 — Failing thrust test.** Append to `frontend/src/sim/forces.test.ts`:

```ts
import { thrustNewtons } from "./forces";
import { loadC172 } from "./params";

describe("afterburner thrust", () => {
  it("scales dry thrust by afterburnerFactor when wet", () => {
    const p = loadC172(); // afterburnerFactor 1.0 → wet == dry for the C172
    const dry = thrustNewtons(p, 1, 100, 0, false);
    const wet = thrustNewtons(p, 1, 100, 0, true);
    expect(wet).toBeCloseTo(dry * p.propulsion.afterburnerFactor, 6);
  });
  it("multiplies by a real factor when one is present", () => {
    const p = loadC172();
    const jet = { ...p, propulsion: { ...p.propulsion, afterburnerFactor: 1.5 } };
    expect(thrustNewtons(jet, 1, 100, 0, true)).toBeCloseTo(thrustNewtons(jet, 1, 100, 0, false) * 1.5, 6);
  });
  it("defaults to dry when the flag is omitted", () => {
    const p = loadC172();
    expect(thrustNewtons(p, 1, 100, 0)).toBeCloseTo(thrustNewtons(p, 1, 100, 0, false), 6);
  });
});
```

- [ ] **Step 3 — Run to fail.** `cd frontend && npm test -- src/sim/forces.test.ts`. The `true`/`false` args are extra params `thrustNewtons` does not yet accept — TypeScript flags the call, tests fail.

- [ ] **Step 4 — Implement the thrust.** In `frontend/src/sim/forces.ts`, change `thrustNewtons` (lines 112–122):

```ts
export function thrustNewtons(
  params: ClassParams,
  throttle: number,
  tasMs: number,
  altitudeM: number,
  afterburner: boolean = false,
): number {
  const { maxPowerW, propEfficiency, propPeakSpeedMs, lapseModel, afterburnerFactor } =
    params.propulsion;
  const clamped = Math.min(1, Math.max(0, throttle));
  const burner = afterburner ? afterburnerFactor : 1;
  const shaftPowerW = clamped * maxPowerW * POWER_LAPSE_MODELS[lapseModel](altitudeM) * burner;
  return (propEfficiency * shaftPowerW) / Math.max(tasMs, propPeakSpeedMs);
}
```

Update its call inside `computeForces` (lines 180–181):

```ts
    x: -drag * Math.cos(aoaRad) + lift * Math.sin(aoaRad) +
       thrustNewtons(params, controls.throttle, tasMs, state.altitudeM, controls.afterburner),
```

- [ ] **Step 5 — Run to pass (thrust).** `cd frontend && npm test -- src/sim/forces.test.ts`. Green.

- [ ] **Step 6 — Failing input test.** Append to `frontend/src/input/controls.test.ts` (match its held-Set → sample style):

```ts
  it("KeyB toggles afterburner edge-triggered — one flip per press", () => {
    const s = createControlSampler(loadC172());
    expect(s.sample(new Set(), 1 / 60).afterburner).toBe(false);
    expect(s.sample(new Set(["KeyB"]), 1 / 60).afterburner).toBe(true);   // edge: off→on
    expect(s.sample(new Set(["KeyB"]), 1 / 60).afterburner).toBe(true);   // held: no re-flip
    expect(s.sample(new Set(), 1 / 60).afterburner).toBe(true);           // released: stays on
    expect(s.sample(new Set(["KeyB"]), 1 / 60).afterburner).toBe(false);  // next press: on→off
  });
```

(Match the file's existing imports of `createControlSampler` / `loadC172`; add them if absent.)

- [ ] **Step 7 — Run to fail.** `cd frontend && npm test -- src/input/controls.test.ts`. `afterburner` never flips — the sampler still returns the hard-coded `false` from Task 1.

- [ ] **Step 8 — Implement the toggle.** In `frontend/src/input/controls.ts`:

Add to `KEYMAP` (near line 30, beside the flap keys):

```ts
  KeyB: "afterburner dry/wet",
```

Add a burner state var beside `prevFlapDown`/`prevFlapUp` (line 79) and initialise from `initial`:

```ts
  let afterburner = initial.afterburner;
  let prevBurner = false;
```

In `sample()`, beside the flap edge-trigger (after line 105):

```ts
      const burnerKey = held.has("KeyB");
      if (burnerKey && !prevBurner) afterburner = !afterburner;
      prevBurner = burnerKey;
```

Return it (line 107):

```ts
      return { pitch, roll, yaw, throttle, flapDetent, trim, afterburner };
```

And in `reset()` (line 109–113):

```ts
      afterburner = initial.afterburner; prevBurner = false;
```

- [ ] **Step 9 — Register the key.** In `frontend/src/input/keyboard.ts`, add `"KeyB"` to `GAME_KEY_CODES` (line 13, beside `"KeyF", "KeyV", "KeyG"`). The existing Ctrl/Cmd/Alt guard in `onKeyDown` (line 34) already covers it — no other change.

- [ ] **Step 10 — Controls help label.** In `frontend/src/dashboard/ControlsHelp.tsx`, add to `KEY_LABELS` (near line 28):

```ts
  KeyB: "B",
```

(`ControlsHelp.test.tsx` asserts every `KEYMAP` code has a label and appears in the panel — the new `KeyB` row is picked up automatically once both maps carry it.)

- [ ] **Step 11 — Fix the envelope thrust helper.** In `frontend/src/sim/envelope.test.ts`, `levelFlightExcessThrustN` (line 35) calls `thrustNewtons(params, throttle, tasMs, altM)` — the defaulted trailing arg keeps this compiling; no edit needed. Confirm by running the file.

- [ ] **Step 12 — Run to pass.** `cd frontend && npm test`, `npx tsc --noEmit`, `npm run build`. All green, including `ControlsHelp.test.tsx` and the C172 envelope suite (afterburnerFactor 1.0 means dry == wet, so no envelope number moves).

- [ ] **Step 13 — Log + commit.** Append **AF-003** to `docs/decisions.md` (afterburner as `boolean × afterburnerFactor` data; `KeyB` edge-triggered toggle, guarded like the flap keys). `git add -A && git commit -m "feat: afterburner dry/wet toggle (KeyB) + afterburnerFactor thrust"`

---

## Task 4 — Mach limit + speed of sound

Add speed of sound and Mach to `isa.ts`, surface `machNumber` through `ForceResult` → `SimState` → `HudSnapshot`, and add the Mach-overspeed annunciator beside the existing IAS/Vne one.

**Files:**
- Modify: `frontend/src/sim/isa.ts` (new `GAMMA_AIR`, `speedOfSoundMs`, `machNumber` after line 48)
- Modify: `frontend/src/sim/forces.ts` (`ForceResult` lines 25–37; `computeForces` return lines 207–217)
- Modify: `frontend/src/sim/aircraft.ts` (`refreshDerived` return lines 28–38; `stepAircraft` return lines 58–73)
- Modify: `frontend/src/sim/types.ts` (`SimState` derived readouts, after `stalled` line 146)
- Modify: `frontend/src/hud/snapshot.ts` (`HudSnapshot` after `overspeed` line 37)
- Modify: `frontend/src/game/flightLoop.ts` (`publish()` after `overspeed` line 96)
- Modify: `frontend/src/hud/format.ts` (`warningsFor` line 98–108)
- Modify: `frontend/src/sim/isa.test.ts`, `frontend/src/hud/format.test.ts` (snap base literal), `frontend/src/hud/Hud.test.tsx` (snap base literal)

**Interfaces:**
- Produces:
  - `isa.ts`: `speedOfSoundMs(altitudeM: number): number`; `machNumber(tasMs: number, altitudeM: number): number`
  - `forces.ts`: `ForceResult` gains `machNumber: number`
  - `sim/types.ts`: `SimState` gains `machNumber: number`
  - `hud/snapshot.ts`: `HudSnapshot` gains `machNumber: number`, `machOverspeed: boolean`
  - `hud/format.ts`: `warningsFor` pushes `"MMO"` when `machOverspeed`
- Consumes: `isaTemperatureK`, `R_AIR` (module-private in `isa.ts`).

Steps:

- [ ] **Step 1 — Failing isa test.** Append to `frontend/src/sim/isa.test.ts`:

```ts
import { speedOfSoundMs, machNumber } from "./isa";

describe("speed of sound and Mach", () => {
  it("is about 340 m/s at sea level (ISA 15°C)", () => {
    expect(speedOfSoundMs(0)).toBeCloseTo(340.3, 1);
  });
  it("falls with temperature up to the tropopause, then holds", () => {
    expect(speedOfSoundMs(11000)).toBeLessThan(speedOfSoundMs(0));
    expect(speedOfSoundMs(12000)).toBeCloseTo(speedOfSoundMs(11000), 3); // isothermal above 11 km
  });
  it("Mach is TAS over the local speed of sound", () => {
    expect(machNumber(340.3, 0)).toBeCloseTo(1, 3);
    expect(machNumber(0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2 — Run to fail.** `cd frontend && npm test -- src/sim/isa.test.ts`.

- [ ] **Step 3 — Implement in `isa.ts`.** Append after line 48:

```ts
/** Ratio of specific heats for dry air. */
export const GAMMA_AIR = 1.4;

/** Local speed of sound, a = sqrt(gamma * R * T), from the ISA temperature at this altitude. */
export function speedOfSoundMs(altitudeM: number): number {
  return Math.sqrt(GAMMA_AIR * R_AIR * isaTemperatureK(altitudeM));
}

/** Mach number = TAS / local speed of sound. */
export function machNumber(tasMs: number, altitudeM: number): number {
  return tasMs / speedOfSoundMs(altitudeM);
}
```

- [ ] **Step 4 — Run to pass (isa).** `cd frontend && npm test -- src/sim/isa.test.ts`.

- [ ] **Step 5 — Surface Mach through the force pipeline.** In `frontend/src/sim/forces.ts`:

Add the import (line 18): `import { isaDensity, RHO_SL, tasToIas, machNumber } from "./isa";`

Add to `ForceResult` (after `iasMs`, line 33):

```ts
  machNumber: number;
```

In the `computeForces` return (lines 207–217), add:

```ts
    machNumber: machNumber(tasMs, state.altitudeM),
```

(The property key `machNumber` and the imported function `machNumber` do not collide — the key is not an identifier in scope.)

- [ ] **Step 6 — Carry it in `SimState`.** In `frontend/src/sim/types.ts`, add after `stalled` (line 146):

```ts
  /** Mach number = TAS / local speed of sound. HUD annunciator only; ASI face is unchanged. */
  machNumber: number;
```

In `frontend/src/sim/aircraft.ts`, add `machNumber: f.machNumber,` to both the `refreshDerived` return (after `stalled`, line 37) and the `stepAircraft` `advanced` object (after `stalled`, line 71). Every hand-built `SimState` literal in tests also needs `machNumber` — run `grep -rn "gLimited: false" frontend/src` to find the test states (`envelope.test.ts` `levelState`, `spawn.ts` `provisional`, etc.) and add `machNumber: 0` to each (it is a placeholder overwritten by `refreshDerived`, exactly like the other derived readouts documented in `spawn.ts`).

- [ ] **Step 7 — Failing HUD annunciator test.** In `frontend/src/hud/format.test.ts`, add `machNumber: 0, machOverspeed: false,` to the `snap()` base literal (line 17 region), then add:

```ts
  it("reports a Mach overspeed distinctly from an IAS overspeed", () => {
    expect(warningsFor(snap({ machOverspeed: true }))).toContain("MMO");
    expect(warningsFor(snap({ overspeed: true }))).toContain("OVERSPEED");
  });
```

Also add `machNumber: 0, machOverspeed: false,` to the `snap()` base in `frontend/src/hud/Hud.test.tsx` (line 40 region) so its literal still satisfies `HudSnapshot`.

- [ ] **Step 8 — Run to fail.** `cd frontend && npm test -- src/hud/format.test.ts`. TypeScript flags the two new snapshot fields as unknown until Step 9.

- [ ] **Step 9 — Implement the snapshot + annunciator.** In `frontend/src/hud/snapshot.ts`, add after `overspeed: boolean;` (line 37):

```ts
  /** Mach number, HUD annunciator only (ASI stays the analog four-arc face, spec §2.3/§7). */
  machNumber: number;
  /** True when Mach has exceeded limits.mmo — trips the MMO annunciator. */
  machOverspeed: boolean;
```

In `frontend/src/game/flightLoop.ts` `publish()`, add after `overspeed: … ` (line 96):

```ts
      machNumber: state.machNumber,
      machOverspeed: state.machNumber > params.limits.mmo,
```

In `frontend/src/hud/format.ts` `warningsFor` (after the `overspeed` push, line 101):

```ts
  if (s.machOverspeed) out.push("MMO");
```

- [ ] **Step 10 — Run to pass.** `cd frontend && npm test`, `npx tsc --noEmit`, `npm run build`. All green (C172 `mmo` 0.45 is never reached, so no C172 test sees `MMO`).

- [ ] **Step 11 — Commit.** `git add -A && git commit -m "feat(sim): speed of sound + Mach; MMO annunciator alongside IAS overspeed"`

---

## Task 5 — Per-class ASI face

Replace the hard-coded `ASI_MIN_KT`/`ASI_MAX_KT` module constants with a per-class range read from `params.display`, threaded through `asiNeedle`/`asiDegFor`/`asiArcs` and `SixPack`, with major tick labels derived from the range. The C172 stays 40–180.

**Files:**
- Modify: `frontend/src/dashboard/gaugeMath.ts` (`ASI_MIN_KT`/`ASI_MAX_KT` lines 45–46; `asiDegFor` lines 50–52; `asiNeedle` lines 54–61; `asiArcs` lines 72–84; new `asiTicks`)
- Modify: `frontend/src/dashboard/SixPack.tsx` (ASI `Dial`, lines 88–98)
- Modify: `frontend/src/dashboard/gaugeMath.test.ts`, `frontend/src/dashboard/SixPack.test.tsx`

**Interfaces:**
- Produces:
  - `gaugeMath.ts`: `asiNeedle(iasMs: number | null, minKt: number, maxKt: number): Needle | null`
  - `gaugeMath.ts`: `asiArcs(params: ClassParams): Arc[]` (reads `params.display.asiMinKt/asiMaxKt` internally — signature unchanged)
  - `gaugeMath.ts`: `asiTicks(minKt: number, maxKt: number): { kt: number; deg: number; label: string }[]`
  - `ASI_START_DEG`, `ASI_SWEEP_DEG` stay exported module constants.
- Consumes: `ClassParams.display` (Task 1); `msToKt`, `stallSpeedIasMs` (already imported).

Steps:

- [ ] **Step 1 — Failing gaugeMath test.** In `frontend/src/dashboard/gaugeMath.test.ts` add:

```ts
import { asiTicks } from "./gaugeMath";

describe("per-class ASI face", () => {
  it("C172 needle math is unchanged at the 40–180 range", () => {
    // 40 kt sits at the ASI_START_DEG stop; 180 at the far end.
    expect(asiNeedle(ktToMs(40), 40, 180)!.deg).toBeCloseTo(ASI_START_DEG, 4);
    expect(asiNeedle(ktToMs(180), 40, 180)!.deg).toBeCloseTo(ASI_START_DEG + ASI_SWEEP_DEG, 4);
  });
  it("maps a wide jet range linearly across the same sweep", () => {
    expect(asiNeedle(ktToMs(60), 60, 400)!.deg).toBeCloseTo(ASI_START_DEG, 4);
    expect(asiNeedle(ktToMs(230), 60, 400)!.deg).toBeCloseTo(ASI_START_DEG + ASI_SWEEP_DEG / 2, 1);
  });
  it("pegs past the ends of the class range", () => {
    expect(asiNeedle(ktToMs(20), 40, 180)!.pegged).toBe(true);
    expect(asiNeedle(ktToMs(500), 60, 400)!.pegged).toBe(true);
  });
  it("derives major tick labels from the range endpoints", () => {
    const t = asiTicks(60, 400);
    expect(t[0].kt).toBe(60);
    expect(t[t.length - 1].kt).toBe(400);
    expect(t.map((x) => x.label)).toContain("400");
  });
});
```

(`gaugeMath.test.ts` already imports `ASI_START_DEG`/`ASI_SWEEP_DEG` and `ktToMs`.)

**Migrate the EXISTING `gaugeMath.test.ts` callers in the same edit** — they will otherwise break, because this task changes `asiNeedle`'s signature and removes the `ASI_MIN_KT`/`ASI_MAX_KT` module constants:
- Line 3 import: drop `ASI_MIN_KT, ASI_MAX_KT` from the `./gaugeMath` import (they no longer exist).
- Line 19 (the test's own `asiDegFor` replica): replace the two constants with the literals `40`/`180` (the C172 range), i.e. `ASI_START_DEG + ((kt - 40) / (180 - 40)) * ASI_SWEEP_DEG`.
- Lines 23–24: `asiNeedle(ktToMs(40), 40, 180)` and `asiNeedle(ktToMs(180), 40, 180)`.
- Line 27: `asiNeedle(P.limits.vneIasMs, P.display.asiMinKt, P.display.asiMaxKt)` (`P = loadC172()`).
- Lines 33, 38: `asiNeedle(ktToMs(12), 40, 180)` / `asiNeedle(ktToMs(400), 40, 180)`.
- Lines 43–44: `asiNeedle(null, 40, 180)` / `asiNeedle(Number.NaN, 40, 180)`.
These edits change the call form only; every assertion value is unchanged, so the C172 ASI math is provably unchanged.

- [ ] **Step 2 — Run to fail.** `cd frontend && npm test -- src/dashboard/gaugeMath.test.ts`. `asiNeedle` still takes one arg; `asiTicks` is missing; the removed constants are unresolved.

- [ ] **Step 3 — Implement in `gaugeMath.ts`.** Remove the two module constants (lines 45–46) and re-thread:

```ts
// ASI face is per-class: the range comes from params.display so a jet does not fly the
// C172's 40–180 kt gauge (spec §2.4/§6). The 300° sweep from the 1 o'clock stop is fixed.
export const ASI_START_DEG = 30;
export const ASI_SWEEP_DEG = 300;

function asiDegFor(kt: number, minKt: number, maxKt: number): number {
  return ASI_START_DEG + ((kt - minKt) / (maxKt - minKt)) * ASI_SWEEP_DEG;
}

export function asiNeedle(iasMs: number | null, minKt: number, maxKt: number): Needle | null {
  if (!known(iasMs)) return null;
  const raw = asiDegFor(msToKt(iasMs), minKt, maxKt);
  const lo = ASI_START_DEG;
  const hi = ASI_START_DEG + ASI_SWEEP_DEG;
  return { deg: clamp(raw, lo, hi), pegged: raw < lo || raw > hi };
}
```

Update `asiArcs` (lines 72–84) to read the range from `params.display` and pass it to `asiDegFor`:

```ts
export function asiArcs(params: ClassParams): Arc[] {
  const { asiMinKt, asiMaxKt } = params.display;
  const deg = (kt: number) => asiDegFor(kt, asiMinKt, asiMaxKt);
  const vs0 = msToKt(stallSpeedIasMs(params, params.flaps.length - 1));
  const vs1 = msToKt(stallSpeedIasMs(params, 0));
  const vfe = msToKt(params.limits.vfeIasMs);
  const vno = msToKt(params.limits.vnoIasMs);
  const vne = msToKt(params.limits.vneIasMs);
  return [
    { kind: "white", fromDeg: deg(vs0), toDeg: deg(vfe) },
    { kind: "green", fromDeg: deg(vs1), toDeg: deg(vno) },
    { kind: "yellow", fromDeg: deg(vno), toDeg: deg(vne) },
    { kind: "red", fromDeg: deg(vne), toDeg: deg(vne) },
  ];
}

/**
 * Major tick labels for the ASI, derived from the class range so a 60–400 kt jet face reads
 * its own numbers (the 40–180 C172 math is unchanged). Five evenly spaced ticks, endpoints
 * included; the label is the rounded knot value.
 */
export function asiTicks(minKt: number, maxKt: number): { kt: number; deg: number; label: string }[] {
  const N = 4; // 4 intervals → 5 ticks
  return Array.from({ length: N + 1 }, (_, i) => {
    const kt = minKt + ((maxKt - minKt) * i) / N;
    return { kt, deg: asiDegFor(kt, minKt, maxKt), label: String(Math.round(kt)) };
  });
}
```

- [ ] **Step 4 — Thread `SixPack`.** In `frontend/src/dashboard/SixPack.tsx`, update the ASI `Dial` (lines 88–98) to pass the class range and render the ticks:

```tsx
      <Dial title="ASI KT" digits={formatIasKt(ias)} needle={asiNeedle(ias, params.display.asiMinKt, params.display.asiMaxKt)}>
        {asiArcs(params).map((a) => (
          <path
            key={a.kind}
            className={arcClass(a)}
            d={a.kind === "red"
              ? `M ${polar(a.fromDeg, R - 10).x.toFixed(2)} ${polar(a.fromDeg, R - 10).y.toFixed(2)} L ${polar(a.fromDeg, R - 2).x.toFixed(2)} ${polar(a.fromDeg, R - 2).y.toFixed(2)}`
              : arcPath(a.fromDeg, a.toDeg, R - 6)}
          />
        ))}
        {asiTicks(params.display.asiMinKt, params.display.asiMaxKt).map((t) => (
          <text key={t.kt} x={polar(t.deg, R - 16).x} y={polar(t.deg, R - 16).y + 3}
            className="gauge-card-text" textAnchor="middle">{t.label}</text>
        ))}
      </Dial>
```

Add `asiTicks` to the `./gaugeMath` import (line 14–18).

- [ ] **Step 5 — Update `SixPack.test.tsx`.** Its calls to `SixPack({ snapshot, params })` already pass `params`; assert the C172 ASI still shows `40`/`180`-range ticks and that a wide-range params object renders a `400` tick. (Reuse the file's existing `collectText` helper and the C172 `params` fixture; construct a jet fixture by spreading the C172 params with `display: { asiMinKt: 60, asiMaxKt: 400, attitudeStyle: "ball" }`.)

- [ ] **Step 6 — Run to pass.** `cd frontend && npm test`, `npx tsc --noEmit`, `npm run build`.

- [ ] **Step 7 — Commit.** `git add -A && git commit -m "feat(dashboard): per-class ASI range + derived tick labels"`

---

## Task 6 — Per-class attitude ("horizon ball")

Render the filled palette-safe ball when `display.attitudeStyle === "ball"`, keep the existing line horizon for `"line"`. Both driven by data.

**Files:**
- Modify: `frontend/src/dashboard/SixPack.tsx` (attitude `gauge`, lines 100–126)
- Modify: `frontend/src/dashboard/gaugeMath.ts` (new `bankScaleTicks`)
- Modify: `frontend/src/styles/tokens.css` (palette-safe ADI classes)
- Modify: `frontend/src/dashboard/SixPack.test.tsx`, `frontend/src/dashboard/gaugeMath.test.ts`

**Interfaces:**
- Produces: `gaugeMath.ts`: `bankScaleTicks(): { deg: number; major: boolean }[]` — bank-angle marks for the ball's roll scale (pure, testable).
- Consumes: `ClassParams.display.attitudeStyle` (Task 1); existing `attitudeRollDeg`, `attitudePitchOffsetPx`, `pitchLadderRungs`.

Steps:

- [ ] **Step 1 — Failing tests.** In `frontend/src/dashboard/gaugeMath.test.ts`:

```ts
import { bankScaleTicks } from "./gaugeMath";

describe("attitude ball bank scale", () => {
  it("marks the standard bank angles with 0/30/60 as majors", () => {
    const marks = bankScaleTicks();
    expect(marks.map((m) => m.deg)).toEqual(expect.arrayContaining([0, 30, 60, -30, -60]));
    expect(marks.find((m) => m.deg === 30)!.major).toBe(true);
    expect(marks.find((m) => m.deg === 10)?.major ?? false).toBe(false);
  });
});
```

In `frontend/src/dashboard/SixPack.test.tsx` (walking the element tree with `collectClassNames`/`collectText` — add a small class-name collector if the file lacks one):

```ts
  it("renders the filled ball for a ball class and the line horizon for a line class", () => {
    const line = SixPack({ snapshot: snap(), params: c172 });          // attitudeStyle "line"
    const ball = SixPack({ snapshot: snap(), params: jetBall });        // attitudeStyle "ball"
    expect(classNamesIn(line)).toContain("gauge-horizon");             // existing line element
    expect(classNamesIn(line)).not.toContain("gauge-adi-sky");
    expect(classNamesIn(ball)).toContain("gauge-adi-sky");             // filled ball elements
    expect(classNamesIn(ball)).toContain("gauge-adi-ground");
  });
```

where `jetBall` is the C172 fixture spread with `display: { asiMinKt: 60, asiMaxKt: 400, attitudeStyle: "ball" }`.

- [ ] **Step 2 — Run to fail.** `cd frontend && npm test -- src/dashboard/SixPack.test.tsx src/dashboard/gaugeMath.test.ts`.

- [ ] **Step 3 — Add `bankScaleTicks`.** In `frontend/src/dashboard/gaugeMath.ts` (in the attitude section, after `pitchLadderRungs`, line 159):

```ts
/** Bank-angle marks around the top of the horizon ball. 0/30/60 are majors; 10/20/45 minors. */
export function bankScaleTicks(): { deg: number; major: boolean }[] {
  return [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((deg) => ({
    deg,
    major: deg % 30 === 0,
  }));
}
```

- [ ] **Step 4 — Add the palette-safe ADI tokens.** In `frontend/src/styles/tokens.css`, add classes using existing tokens only (no new hex literals — reuse the near-black, `--grid`, and cyan/amber variables; the "sky" is a dim cyan tint, the "ground" a darker olive-grey derived from `--grid`):

```css
.gauge-adi-sky { fill: color-mix(in srgb, var(--cyan) 14%, var(--bg)); }
.gauge-adi-ground { fill: color-mix(in srgb, var(--grid) 70%, var(--bg)); }
.gauge-adi-horizon { stroke: var(--cyan); stroke-width: 1; }
.gauge-adi-bank { stroke: var(--grid); stroke-width: 1; }
.gauge-adi-bank-major { stroke: var(--cyan); stroke-width: 1; }
.gauge-adi-pointer { fill: var(--amber); }
```

(Confirm the exact token variable names in `tokens.css` — `--cyan`/`--amber`/`--bg`/`--grid` per the mission-terminal palette; if a name differs, use the real one. `color-mix` keeps it palette-safe with zero new literals.)

- [ ] **Step 5 — Branch the attitude render on data.** In `frontend/src/dashboard/SixPack.tsx`, replace the attitude `gauge` block (lines 100–126) so it renders the ball for `params.display.attitudeStyle === "ball"` and the existing line horizon otherwise. The ball uses a clipped `<g>` (an SVG `clipPath` circle of radius `R`) containing a tall sky rect and ground rect split at the horizon, the existing `pitchLadderRungs()` for the ladder, `bankScaleTicks()` for the roll scale, and a fixed roll pointer triangle in amber; the line branch is the current markup verbatim. Keep the fixed aircraft symbol and the `ATTITUDE` label/digits outside the branch. Sketch:

```tsx
      <div className="gauge">
        <svg viewBox="0 0 120 120" className="gauge-face" role="img">
          <defs><clipPath id="adiClip"><circle cx={C} cy={C} r={R} /></clipPath></defs>
          <circle cx={C} cy={C} r={R} className="gauge-bezel" />
          {roll !== null && pitch !== null && (
            params.display.attitudeStyle === "ball" ? (
              <g clipPath="url(#adiClip)" transform={`rotate(${round(roll)} ${C} ${C})`}>
                <g transform={`translate(0 ${round(pitch.px)})`}>
                  <rect x={C - R} y={C - R * 3} width={R * 2} height={R * 3} className="gauge-adi-sky" />
                  <rect x={C - R} y={C} width={R * 2} height={R * 3} className="gauge-adi-ground" />
                  <line x1={C - 46} y1={C} x2={C + 46} y2={C} className="gauge-adi-horizon" />
                  {pitchLadderRungs().map((r) => (
                    <line key={r.deg} x1={C - r.halfWidthPx} y1={C + round(r.px)}
                      x2={C + r.halfWidthPx} y2={C + round(r.px)} className="gauge-ladder" />
                  ))}
                </g>
                {bankScaleTicks().map((t) => (
                  <line key={t.deg}
                    x1={polar(t.deg, R).x} y1={polar(t.deg, R).y}
                    x2={polar(t.deg, R - (t.major ? 8 : 4)).x} y2={polar(t.deg, R - (t.major ? 8 : 4)).y}
                    className={t.major ? "gauge-adi-bank-major" : "gauge-adi-bank"} />
                ))}
              </g>
            ) : (
              <g transform={`rotate(${round(roll)} ${C} ${C})`}>
                <g transform={`translate(0 ${round(pitch.px)})`}>
                  <line x1={C - 46} y1={C} x2={C + 46} y2={C} className="gauge-horizon" />
                  {pitchLadderRungs().map((r) => (
                    <line key={r.deg} x1={C - r.halfWidthPx} y1={C + round(r.px)}
                      x2={C + r.halfWidthPx} y2={C + round(r.px)} className="gauge-ladder" />
                  ))}
                </g>
              </g>
            )
          )}
          <path d={`M ${C - 18} ${C} L ${C - 6} ${C} L ${C} ${C + 5} L ${C + 6} ${C} L ${C + 18} ${C}`}
            className="gauge-aircraft" />
        </svg>
        <div className="gauge-label label">ATTITUDE</div>
        <div className="gauge-digits">
          {roll === null ? EM_DASH : `${roll > 0 ? "L" : roll < 0 ? "R" : ""}${Math.abs(Math.round(roll))}°`}
        </div>
      </div>
```

Add `bankScaleTicks` to the `./gaugeMath` import.

- [ ] **Step 6 — Run to pass.** `cd frontend && npm test`, `npx tsc --noEmit`, `npm run build`. C172 attitude test unchanged (still `"line"` → `gauge-horizon`, no `gauge-adi-sky`).

- [ ] **Step 7 — Log + commit.** Append **AF-006** to `docs/decisions.md` (per-class ASI face + attitude style: line vs palette-safe ball, both data-selected). `git add -A && git commit -m "feat(dashboard): palette-safe horizon ball for jet classes (attitudeStyle data)"`

---

## Task 7 — `b738.json` + envelope tests

Author the sourced 737-800 data file and its envelope suite. Tune the shared turbofan curve (Task 2) and the b738 `maxPowerW`/`propPeakSpeedMs`/`cd0` knobs until the cruise and climb targets are met — exactly the c172 discipline.

**Files:**
- Create: `frontend/src/params/b738.json`
- Create: `frontend/src/sim/b738-envelope.test.ts`
- Modify: `frontend/src/sim/params.ts` (`loadB738()` + cache)
- Modify: `frontend/src/sim/params.test.ts` (b738 loads + validates)

**Interfaces:**
- Produces: `params.ts`: `loadB738(): ClassParams`
- Consumes: `validateClassParams`; the pure force/trim helpers.

**Target numbers (spec §3 — design intent; the `sources` entries record what each was tuned against):** ~79 t operating mass; turbofan lapse; `afterburnerFactor` 1.0; Vmo 340 KIAS (`vneIasMs` 174.9 m/s), Mmo 0.82; +2.5/−1.0 g; service ceiling 41 000 ft (12 497 m); large roll inertia (low `rollRateMaxRadS`, high `rollDampingPerS`); flap detents 0/1/2/5/10/15/25/30/40; ASI face 60–400 kt; `attitudeStyle: "ball"`. Cruise: trims at ~M0.78 at FL350.

Steps:

- [ ] **Step 1 — Write `b738.json`** following `c172.json`'s shape exactly (every number has a `sources` entry). Starting values (aero/thrust marked `TUNING KNOB` with their envelope target):

```json
{
  "id": "b738",
  "label": "B738",
  "modelNote": "737-800 MODEL",
  "massKg": 66000,
  "wingAreaM2": 124.6,
  "wingSpanM": 35.79,
  "aspectRatio": 10.28,
  "aero": {
    "cl0": 0.2, "clAlphaPerRad": 5.5, "stallAlphaRad": 0.28, "postStallDecayRad": 0.18,
    "cd0": 0.02, "oswaldE": 0.8, "cyBeta": -0.9
  },
  "control": {
    "rollRateMaxRadS": 0.2618, "pitchRateMaxRadS": 0.1745, "yawRateMaxRadS": 0.1047,
    "rollDampingPerS": 2.0, "pitchDampingPerS": 1.8, "yawDampingPerS": 1.5,
    "pitchStiffnessPerS2": 2.5, "yawStiffnessPerS2": 1.8, "refDynamicPressurePa": 6000,
    "trimAlphaCenterRad": 0.035, "trimAlphaRangeRad": 0.12
  },
  "propulsion": {
    "maxPowerW": 60000000, "lapseModel": "turbofan", "propEfficiency": 0.85,
    "propPeakSpeedMs": 260, "afterburnerFactor": 1.0
  },
  "limits": {
    "vneIasMs": 174.9, "vnoIasMs": 164.6, "vfeIasMs": 128.6,
    "gLimitPos": 2.5, "gLimitNeg": -1.0, "serviceCeilingM": 12497, "mmo": 0.82
  },
  "flaps": [
    { "label": "0", "dCL0": 0.0, "dStallAlphaRad": 0.0, "dCD0": 0.0 },
    { "label": "1", "dCL0": 0.15, "dStallAlphaRad": -0.01, "dCD0": 0.004 },
    { "label": "2", "dCL0": 0.30, "dStallAlphaRad": -0.02, "dCD0": 0.008 },
    { "label": "5", "dCL0": 0.5, "dStallAlphaRad": -0.03, "dCD0": 0.014 },
    { "label": "10", "dCL0": 0.7, "dStallAlphaRad": -0.045, "dCD0": 0.022 },
    { "label": "15", "dCL0": 0.9, "dStallAlphaRad": -0.06, "dCD0": 0.032 },
    { "label": "25", "dCL0": 1.15, "dStallAlphaRad": -0.08, "dCD0": 0.05 },
    { "label": "30", "dCL0": 1.35, "dStallAlphaRad": -0.095, "dCD0": 0.07 },
    { "label": "40", "dCL0": 1.6, "dStallAlphaRad": -0.11, "dCD0": 0.1 }
  ],
  "gear": "retractable",
  "display": { "asiMinKt": 60, "asiMaxKt": 400, "attitudeStyle": "ball" },
  "sources": {
    "massKg": "~66 t operating empty + typical payload, below 79 t MTOW (spec §3 target ~79 t is the upper bound; tune toward the cruise/climb tests). OpenAP 737-800 OEW 41.4 t, MTOW 79 t.",
    "wingAreaM2": "737-800 reference wing area 124.6 m^2 (Boeing).",
    "wingSpanM": "35.79 m with winglets (Boeing 737-800).",
    "aspectRatio": "derived b^2/S = 35.79^2/124.6 = 10.28.",
    "cl0": "TUNING KNOB — swept-wing zero-AoA lift; pinned by the FL350 cruise trim test.",
    "clAlphaPerRad": "TUNING KNOB — ~0.096/deg swept-wing slope; pinned by cruise trim.",
    "stallAlphaRad": "TUNING KNOB (stall/ref speeds) — 16 deg; verify Vref band in the envelope test.",
    "cd0": "TUNING KNOB (cruise Mach + ceiling) — clean jet ~0.02; tuned so the model trims at ~M0.78 at FL350 and holds a sane service ceiling.",
    "oswaldE": "TUNING KNOB — 0.80 typical transport.",
    "cyBeta": "TUNING KNOB — transport side-force slope.",
    "control": "TUNING KNOBS (spec §3 large roll inertia): low rollRateMaxRadS (15 deg/s) + high rollDampingPerS give the heavy-jet feel; refDynamicPressurePa raised because the jet flies faster.",
    "maxPowerW / propPeakSpeedMs": "TUNING KNOBS — flat-rated turbofan expressed via the prop formula (decisions AF-... / spec §2.1): propPeakSpeedMs 260 m/s sits above max flight TAS so thrust is constant (T = eta*P/260), maxPowerW tuned to the FL350 cruise + climb targets. 2xCFM56-7B ~2x117 kN static as the sanity ceiling.",
    "afterburnerFactor": "1.0 — no afterburner.",
    "limits.vne/vno/vfe": "Vmo 340 KIAS = 174.9 m/s; vno 320 KIAS; vfe ~250 KIAS flap placard (verify against detent-specific placards if refined).",
    "mmo": "0.82 — 737-800 Mmo (spec §3 says ~0.82).",
    "gLimits": "+2.5 / -1.0 transport-category clean.",
    "serviceCeilingM": "41000 ft = 12497 m.",
    "flaps": "0/1/2/5/10/15/25/30/40 detents (737 flap schedule); dCL0/dCD0/dStallAlpha are TUNING KNOBS pinned by the approach-speed / stall envelope checks.",
    "display": "ASI face 60-400 kt spans the jet band; attitudeStyle ball.",
    "gear": "retractable."
  }
}
```

- [ ] **Step 2 — Add `loadB738()`.** In `frontend/src/sim/params.ts`, import `b738Raw from "../params/b738.json"` and add beside `loadC172`:

```ts
let cachedB738: ClassParams | null = null;
export function loadB738(): ClassParams {
  if (cachedB738 === null) cachedB738 = validateClassParams(b738Raw);
  return cachedB738;
}
```

- [ ] **Step 3 — Failing params test.** In `frontend/src/sim/params.test.ts`:

```ts
describe("loadB738", () => {
  it("loads and validates the shipped 737-800 file", () => {
    const p = loadB738();
    expect(p.id).toBe("b738");
    expect(p.propulsion.lapseModel).toBe("turbofan");
    expect(p.propulsion.afterburnerFactor).toBe(1.0);
    expect(p.limits.mmo).toBeCloseTo(0.82, 2);
    expect(p.display.attitudeStyle).toBe("ball");
    expect(p.gear).toBe("retractable");
  });
});
```

Run `cd frontend && npm test -- src/sim/params.test.ts` → fails until Step 2 is wired and the file validates. Fix any validator complaint (a real missing/negative field in the JSON) before moving on.

- [ ] **Step 4 — Write the envelope suite** `frontend/src/sim/b738-envelope.test.ts`, mirroring `envelope.test.ts` but with the trim/level helpers parametrised on `params` (copy `levelFlightExcessThrustN`, `maxLevelSpeedMs`, `bestClimbRateMs`, `levelState`, `flyAndMeasure`, `trimForLevelFlight`, taking `params` as an argument instead of closing over `P`). Assertions:

```ts
import { machNumber } from "./isa";
const P = loadB738();

describe("B738 envelope — cruise", () => {
  it("trims at cruise Mach ~0.78 at FL350", () => {
    const alt = ftToM(35000);
    // Find the fastest level speed the jet can hold at a cruise power setting, then confirm Mach.
    const tas = maxLevelSpeedMs(P, alt, 0.85);
    const mach = machNumber(tas, alt);
    expect(mach).toBeGreaterThan(0.72);
    expect(mach).toBeLessThan(0.82);
  });
});

describe("B738 envelope — limits", () => {
  it("Vmo bites low and Mmo bites high (the binding limit swaps with altitude)", () => {
    // At sea level Vmo (IAS) is the constraint; at FL350 the same IAS is a higher Mach, so Mmo binds.
    const machAtVmoLow = machNumber(iasToTas(P.limits.vneIasMs, 0), 0);
    const machAtVmoHigh = machNumber(iasToTas(P.limits.vneIasMs, ftToM(35000)), ftToM(35000));
    expect(machAtVmoLow).toBeLessThan(P.limits.mmo);       // Vmo is the low-altitude limit
    expect(machAtVmoHigh).toBeGreaterThan(P.limits.mmo);   // Mmo is the high-altitude limit
  });
  it("g clamps at +2.5 / -1.0 and reaches them", () => {
    // Same broken-arm structure as envelope.test.ts: prove the clamp is hit, not merely never exceeded.
    const controls: ControlVector = { pitch: 1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: 1, afterburner: false };
    let s = levelState(P, ftToM(20000), ktToMs(320), controls);
    let maxG = 0, sawLimit = false;
    for (let i = 0; i < 600; i++) { s = stepAircraft(s, controls, P); maxG = Math.max(maxG, s.loadFactor); if (s.gLimited) sawLimit = true; }
    expect(sawLimit).toBe(true);
    expect(maxG).toBeLessThanOrEqual(P.limits.gLimitPos + 1e-9);
  });
  it("still climbs, but barely, at the service ceiling", () => {
    const fpm = msToFpm(bestClimbRateMs(P, P.limits.serviceCeilingM, 1));
    expect(fpm).toBeGreaterThan(0);
    expect(fpm).toBeLessThan(500);
  });
  it("never produces NaN across a control sweep", () => {
    const controls: ControlVector = { pitch: 0.6, roll: 0.6, yaw: 0.6, throttle: 1, flapDetent: 4, trim: 1, afterburner: false };
    let s = levelState(P, ftToM(30000), ktToMs(280), controls);
    for (let i = 0; i < 3600; i++) s = stepAircraft(s, controls, P);
    expect(Number.isFinite(s.tasMs)).toBe(true);
    expect(Number.isFinite(s.loadFactor)).toBe(true);
  });
});
```

- [ ] **Step 5 — Tune to green.** Run `cd frontend && npm test -- src/sim/b738-envelope.test.ts` and adjust ONLY the documented knobs (`maxPowerW`, `propPeakSpeedMs`, `cd0`, `clAlphaPerRad`, `cl0`, and if needed `TURBOFAN_CORNER_M`/`TURBOFAN_LAPSE_EXP` in `forces.ts`) until cruise Mach, the Vmo/Mmo swap, the g-clamp, and the ceiling all pass. Re-run the C172 suite after any change to the shared turbofan constants to confirm the piston class is untouched (it uses `lapseModel: "piston"`, so it should be). Update each tuned number's `sources` note with the measured value it was pinned to.

- [ ] **Step 6 — Full gates + commit.** `cd frontend && npm test`, `npx tsc --noEmit`, `npm run build`. Append **AF-002** (one shared turbofan lapse curve for both jets) and **AF-004a** (flat thrust via high `propPeakSpeedMs`, no jet branch) to `docs/decisions.md`. `git add -A && git commit -m "feat(sim): b738 (737-800) sourced params + envelope suite"`. **This is a natural review checkpoint — pair with Task 8's sign-off.**

---

## Task 8 — `f5e.json` + envelope tests

Author the F-5E data file and envelope suite. Every unsourced number is `TUNING KNOB` with a measured target (spec §3, §9; CLAUDE.md — fighter numbers need Phase B source verification).

**Files:**
- Create: `frontend/src/params/f5e.json`
- Create: `frontend/src/sim/f5e-envelope.test.ts`
- Modify: `frontend/src/sim/params.ts` (`loadF5e()` + cache)
- Modify: `frontend/src/sim/params.test.ts` (f5e loads + validates)

**Interfaces:**
- Produces: `params.ts`: `loadF5e(): ClassParams`

**Target numbers (spec §3):** turbofan lapse; `afterburnerFactor` ~1.5 (dry→wet); Mmo capped ~0.95; high roll rate; fighter g-limits ~+7.3/−3; maneuvering + landing flap detents; ASI face 80–800 kt; `attitudeStyle: "ball"`.

Steps:

- [ ] **Step 1 — Write `f5e.json`** (J85 turbojets are near-flat-rated, so `lapseModel: "turbofan"` is the closest shared curve; note it). Starting values:

```json
{
  "id": "f5e",
  "label": "F5E",
  "modelNote": "F-5E MODEL",
  "massKg": 8500,
  "wingAreaM2": 17.28,
  "wingSpanM": 8.13,
  "aspectRatio": 3.83,
  "aero": {
    "cl0": 0.05, "clAlphaPerRad": 3.5, "stallAlphaRad": 0.35, "postStallDecayRad": 0.25,
    "cd0": 0.02, "oswaldE": 0.7, "cyBeta": -0.8
  },
  "control": {
    "rollRateMaxRadS": 3.5, "pitchRateMaxRadS": 0.5, "yawRateMaxRadS": 0.3,
    "rollDampingPerS": 4.0, "pitchDampingPerS": 3.0, "yawDampingPerS": 2.5,
    "pitchStiffnessPerS2": 4.0, "yawStiffnessPerS2": 3.0, "refDynamicPressurePa": 8000,
    "trimAlphaCenterRad": 0.02, "trimAlphaRangeRad": 0.15
  },
  "propulsion": {
    "maxPowerW": 22000000, "lapseModel": "turbofan", "propEfficiency": 0.85,
    "propPeakSpeedMs": 320, "afterburnerFactor": 1.5
  },
  "limits": {
    "vneIasMs": 360, "vnoIasMs": 320, "vfeIasMs": 130,
    "gLimitPos": 7.33, "gLimitNeg": -3.0, "serviceCeilingM": 15700, "mmo": 0.95
  },
  "flaps": [
    { "label": "0", "dCL0": 0.0, "dStallAlphaRad": 0.0, "dCD0": 0.0 },
    { "label": "MNVR", "dCL0": 0.3, "dStallAlphaRad": -0.02, "dCD0": 0.02 },
    { "label": "FULL", "dCL0": 0.6, "dStallAlphaRad": -0.05, "dCD0": 0.06 }
  ],
  "gear": "retractable",
  "display": { "asiMinKt": 80, "asiMaxKt": 800, "attitudeStyle": "ball" },
  "sources": {
    "massKg": "TUNING KNOB — ~8.5 t combat weight (F-5E empty 4.35 t, loaded ~9.3 t). Phase B source verification pending (CLAUDE.md).",
    "wingAreaM2": "17.28 m^2 (F-5E, published).",
    "wingSpanM": "8.13 m (F-5E, published).",
    "aspectRatio": "derived b^2/S = 8.13^2/17.28 = 3.83.",
    "aero": "TUNING KNOBS — low-AR fighter aero; cl0/clAlpha/cd0/oswaldE pinned by the climb + dry/wet-thrust envelope tests, not sourced coefficients. Phase B verification pending.",
    "control": "TUNING KNOBS — high rollRateMaxRadS (~200 deg/s) for a nimble jet; refDynamicPressurePa raised for high-speed authority. No published derivatives; response constants are named knobs (decisions B-007).",
    "maxPowerW / propPeakSpeedMs / afterburnerFactor": "TUNING KNOBS — 2xJ85-GE-21 ~2x22 kN dry / ~2x31 kN wet (afterburner). afterburnerFactor 1.5 ~= wet/dry static thrust ratio; propPeakSpeedMs 320 m/s keeps thrust ~constant; maxPowerW pinned by the climb envelope test. Phase B verification pending.",
    "limits.vne/vno/vfe": "TUNING KNOBS — subsonic-capped operating speeds; the sim never runs where wave drag would lie (spec §1/§7).",
    "mmo": "0.95 — capped subsonic (spec §7). Supersonic + wave drag deferred to issue #2.",
    "gLimits": "+7.33 / -3.0 — F-5E design load factors.",
    "serviceCeilingM": "TUNING KNOB — ~51500 ft. Phase B verification pending.",
    "flaps": "0 / maneuvering / full — F-5E flap positions. dCL0/dCD0 are TUNING KNOBS pinned by approach + turn-rate checks.",
    "display": "ASI face 80-800 kt spans the fighter band; attitudeStyle ball.",
    "gear": "retractable."
  }
}
```

- [ ] **Step 2 — Add `loadF5e()`** in `params.ts` (import `f5eRaw from "../params/f5e.json"`, own cache), mirroring `loadB738()`.

- [ ] **Step 3 — Failing params test** in `params.test.ts`:

```ts
describe("loadF5e", () => {
  it("loads and validates the shipped F-5E file", () => {
    const p = loadF5e();
    expect(p.id).toBe("f5e");
    expect(p.propulsion.afterburnerFactor).toBeGreaterThan(1); // real dry->wet factor
    expect(p.limits.mmo).toBeLessThanOrEqual(0.95);            // capped subsonic
    expect(p.limits.gLimitPos).toBeGreaterThan(5);             // fighter g
    expect(p.display.attitudeStyle).toBe("ball");
  });
});
```

- [ ] **Step 4 — Write `f5e-envelope.test.ts`** with the same parametrised helpers as Task 7. Assertions:

```ts
describe("F5E envelope", () => {
  it("dry-vs-wet thrust delta is ~afterburnerFactor", () => {
    const dry = thrustNewtons(P, 1, 200, ftToM(20000), false);
    const wet = thrustNewtons(P, 1, 200, ftToM(20000), true);
    expect(wet / dry).toBeCloseTo(P.propulsion.afterburnerFactor, 3);
  });
  it("climbs strongly with the burner lit and more strongly than dry", () => {
    const dryClimb = msToFpm(bestClimbRateMs(P, ftToM(10000), 1, /*afterburner*/ false));
    const wetClimb = msToFpm(bestClimbRateMs(P, ftToM(10000), 1, /*afterburner*/ true));
    expect(wetClimb).toBeGreaterThan(dryClimb);
    expect(wetClimb).toBeGreaterThan(5000); // fighter-class wet climb; tune the target with the file
  });
  it("caps at Mmo ~0.95 (no supersonic path)", () => {
    expect(P.limits.mmo).toBeLessThanOrEqual(0.95);
  });
  it("g clamps at the fighter limits and reaches +limit", () => {
    const controls: ControlVector = { pitch: 1, roll: 0, yaw: 0, throttle: 1, flapDetent: 0, trim: 1, afterburner: true };
    let s = levelState(P, ftToM(15000), ktToMs(450), controls);
    let maxG = 0, sawLimit = false;
    for (let i = 0; i < 600; i++) { s = stepAircraft(s, controls, P); maxG = Math.max(maxG, s.loadFactor); if (s.gLimited) sawLimit = true; }
    expect(sawLimit).toBe(true);
    expect(maxG).toBeLessThanOrEqual(P.limits.gLimitPos + 1e-9);
  });
});
```

The `bestClimbRateMs` helper in this file must take an `afterburner` flag and pass it to `thrustNewtons`/the excess-thrust calc, so the dry-vs-wet climb delta is real. Extend the parametrised copy accordingly.

- [ ] **Step 5 — Tune to green** using only the documented knobs; update each `sources` note with the measured target it was pinned to. Confirm the C172 and b738 suites stay green.

- [ ] **Step 6 — Gates + commit.** `cd frontend && npm test`, `npx tsc --noEmit`, `npm run build`. Append **AF-004b** (afterburner factor sourced to J85 wet/dry ratio) and **AF-005** (F-5E capped subsonic, issue #2) to `docs/decisions.md`. `git add -A && git commit -m "feat(sim): f5e (F-5E) sourced params + envelope suite (subsonic-capped)"`. **Stop and wait for owner sign-off** (both jets fly in tests; CLAUDE.md ground rule 5).

---

## Task 9 — Class resolution + disclosure

Grow `takeover/eligibility.ts` from a GA-only gate into a resolver: three designator lists, unknown/missing/unmatched → `c172s`, the military hard-block dropped, every physical gate kept, and a disclosure string exposed.

**Files:**
- Create: `frontend/src/params/airliner-types.json`, `frontend/src/params/fighter-types.json`
- Modify: `frontend/src/takeover/eligibility.ts`
- Modify: `frontend/src/sim/params.ts` (`loadClassById`)
- Modify: `frontend/src/takeover/eligibility.test.ts` (it EXISTS and asserts the old behaviour — its `describe("checkEligibility — each gate names itself")` table includes `["not a GA piston type", { t: "B738" }, /NOT GA PISTON/]` (line 39), a military-refusal case, a `NO TYPE IN FEED` case, and `checkEligibility(ga({ t: "B738" }))` refused (line 56). Those cases MUST be removed or rewritten — after this task a `B738` / military / no-type contact resolves to a class and passes the physical gates. Keep the physical-gate cases (`ON GROUND`, `POSITION STALE`, `NO ALTITUDE`, `NO GROUND SPEED`, `NO TRACK`, the `seen_pos` boundary at 15/15.1) unchanged.)
- Check (may need a test edit): `frontend/src/panels/ContactList.tsx` uses `checkEligibility` for the TAKE CONTROLS button (line 42) — no code change (same predicate), but grep its test for any assertion that a B738/military contact's button is disabled and update it.

**Interfaces:**
- Produces:
  - `eligibility.ts`: `type ClassResolution = { classId: string; matched: boolean }`
  - `eligibility.ts`: `resolveClass(contact: Contact): ClassResolution`
  - `eligibility.ts`: `disclosureLine(contact: Contact, params: ClassParams, matched: boolean): string`
  - `eligibility.ts`: `checkEligibility` keeps only the physical gates
  - `params.ts`: `loadClassById(id: string): ClassParams`
- Consumes: `ga-types.json`, `airliner-types.json`, `fighter-types.json`; `Contact` (`data/types.ts`); `ClassParams`.

Steps:

- [ ] **Step 1 — Designator lists.** `frontend/src/params/airliner-types.json` (airliner/regional-jet ICAO designators, C172-discipline `note` + `designators` array), e.g. `A319 A320 A321 A20N A21N B737 B738 B739 B38M B739 B752 B763 E170 E75L E190 CRJ9 DH8D AT76 …`. `frontend/src/params/fighter-types.json` (fast-jet designators): `F5 F16 F15 F18 EUFI RFAL MIG29 SU27 A10 T38 …`. Keep both small and honest (spec §9 — lists start small and grow; coverage is honest via disclosure, not completeness).

- [ ] **Step 2 — Failing resolver tests.** In `frontend/src/takeover/eligibility.test.ts`:

```ts
import { resolveClass, checkEligibility, disclosureLine } from "./eligibility";
import { loadClassById } from "../sim/params";

function contact(over: Partial<Contact> = {}): Contact {
  return { hex: "abc123", flight: "TEST", t: "C172", alt_geom: 10000, alt_baro: 10000,
    gs: 110, track: 90, lat: 30, lon: -88, military: false, seen_pos: 2, ...over } as Contact;
}

describe("resolveClass", () => {
  it("maps an airliner designator to b738", () => {
    expect(resolveClass(contact({ t: "A320" }))).toEqual({ classId: "b738", matched: true });
  });
  it("maps a fighter designator to f5e — including a military fast-jet", () => {
    expect(resolveClass(contact({ t: "F16", military: true }))).toEqual({ classId: "f5e", matched: true });
  });
  it("maps a GA designator to c172s", () => {
    expect(resolveClass(contact({ t: "PA28" }))).toEqual({ classId: "c172s", matched: true });
  });
  it("falls to c172s (unmatched) for an unknown type", () => {
    expect(resolveClass(contact({ t: "C130" }))).toEqual({ classId: "c172s", matched: false });
  });
  it("falls to c172s (unmatched) for a missing type", () => {
    expect(resolveClass(contact({ t: null }))).toEqual({ classId: "c172s", matched: false });
  });
});

describe("checkEligibility — physical gates only", () => {
  it("no longer refuses a military contact", () => {
    expect(checkEligibility(contact({ t: "F16", military: true }))).toEqual({ eligible: true });
  });
  it("no longer refuses a non-GA type", () => {
    expect(checkEligibility(contact({ t: "A320" }))).toEqual({ eligible: true });
  });
  it("still refuses on the ground", () => {
    expect(checkEligibility(contact({ alt_baro: "ground" })).eligible).toBe(false);
  });
  it("still refuses a stale position", () => {
    expect(checkEligibility(contact({ seen_pos: 40 })).eligible).toBe(false);
  });
  it("still refuses no ground speed / no track / no altitude", () => {
    expect(checkEligibility(contact({ gs: null })).eligible).toBe(false);
    expect(checkEligibility(contact({ track: null })).eligible).toBe(false);
    expect(checkEligibility(contact({ alt_geom: null, alt_baro: null })).eligible).toBe(false);
  });
});

describe("disclosureLine", () => {
  it("shows REAL TYPE → MODEL for a matched class", () => {
    const p = loadClassById("b738");
    expect(disclosureLine(contact({ t: "A320" }), p, true)).toBe("A320 → 737-800 MODEL");
  });
  it("flags an unmatched substitution", () => {
    const p = loadClassById("c172s");
    expect(disclosureLine(contact({ t: "C130" }), p, false)).toBe("C130 → C172 MODEL THIS BUILD (NO MATCHING CLASS)");
  });
  it("renders an em-dash for a missing type", () => {
    const p = loadClassById("c172s");
    expect(disclosureLine(contact({ t: null }), p, false)).toBe("— → C172 MODEL THIS BUILD (NO MATCHING CLASS)");
  });
});
```

- [ ] **Step 3 — Run to fail.** `cd frontend && npm test -- src/takeover/eligibility.test.ts`.

- [ ] **Step 4 — Add `loadClassById`.** In `frontend/src/sim/params.ts`, after the three loaders:

```ts
/** Resolve a class id (from resolveClass) to its validated params. Unknown id is a bug, not data. */
export function loadClassById(id: string): ClassParams {
  switch (id) {
    case "c172s": return loadC172();
    case "b738": return loadB738();
    case "f5e": return loadF5e();
    default: throw new Error(`unknown class id: ${id}`);
  }
}
```

- [ ] **Step 5 — Rewrite `eligibility.ts`.** Replace the file with the resolver + physical-gate-only eligibility + disclosure, dropping the type-membership and military refusals:

```ts
import type { Contact } from "../data/types";
import type { ClassParams } from "../sim/types";
import { EM_DASH } from "../hud/format";
import gaTypes from "../params/ga-types.json";
import airlinerTypes from "../params/airliner-types.json";
import fighterTypes from "../params/fighter-types.json";

export const GA_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(gaTypes.designators);
export const AIRLINER_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(airlinerTypes.designators);
export const FIGHTER_TYPE_DESIGNATORS: ReadonlySet<string> = new Set(fighterTypes.designators);

/** readsb `seen_pos` can run to ~50 s; spawning on a 50-second-old position is a lie. */
export const MAX_SEEN_POS_S = 15;

export type ClassResolution = { classId: string; matched: boolean };

/**
 * Which flight model a contact flies, inferred from its real ICAO type designator (spec §4).
 * Fighter → f5e, airliner → b738, GA → c172s; unknown / missing / unmatched → c172s (the
 * substitution is disclosed on the handoff card, never silent). Military is NOT a refusal here:
 * a military fast-jet resolves to f5e, an unmatched military type falls to the c172s default.
 */
export function resolveClass(contact: Contact): ClassResolution {
  const t = contact.t;
  if (t !== null) {
    if (FIGHTER_TYPE_DESIGNATORS.has(t)) return { classId: "f5e", matched: true };
    if (AIRLINER_TYPE_DESIGNATORS.has(t)) return { classId: "b738", matched: true };
    if (GA_TYPE_DESIGNATORS.has(t)) return { classId: "c172s", matched: true };
  }
  return { classId: "c172s", matched: false };
}

/** The handoff card's disclosure: REAL TYPE → MODEL, flagged when no class matched. */
export function disclosureLine(contact: Contact, params: ClassParams, matched: boolean): string {
  const real = contact.t ?? EM_DASH;
  return `${real} → ${params.modelNote}${matched ? "" : " (NO MATCHING CLASS)"}`;
}

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string };

/**
 * The PHYSICAL gates only (spec §4): a contact that cannot be honestly spawned is refused.
 * Type is no longer a refusal — every type resolves to some class (disclosed). Military is no
 * longer a refusal — the F-5E is military. The button's disabled state and its tooltip share
 * this one predicate, so the button can never be disabled for a reason the UI cannot name.
 */
export function checkEligibility(contact: Contact | null | undefined): EligibilityResult {
  if (!contact) return { eligible: false, reason: "NO CONTACT SELECTED" };
  if (contact.alt_baro === "ground") return { eligible: false, reason: "ON GROUND" };
  if (contact.seen_pos === null || contact.seen_pos > MAX_SEEN_POS_S) {
    const age = contact.seen_pos === null ? EM_DASH : String(contact.seen_pos);
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

(Confirm `EM_DASH` is exported from `hud/format.ts`; it is used by the gauges. If importing `hud/format` into `takeover/` creates an unwanted cycle, inline the `"—"` literal instead.)

- [ ] **Step 6 — Run to pass + check callers.** `cd frontend && npm test -- src/takeover/eligibility.test.ts`, then the full suite. `grep -rn "checkEligibility\|NOT GA PISTON\|MILITARY CONTACT" frontend/src` to find any UI/test that asserted the removed reasons and update them (the TAKE CONTROLS button/tooltip test may assert the old "MILITARY CONTACT" / "NOT GA PISTON" strings — those cases now resolve to eligible or a different reason). `npx tsc --noEmit`, `npm run build`.

- [ ] **Step 7 — Commit.** `git add -A && git commit -m "feat(takeover): resolveClass + disclosure; drop military/type hard-block, keep physical gates"`

---

## Task 10 — Wire class selection into takeover + disclosure card

Select the class from the origin contact in `FlightSession` and `DashboardStrip`, load the right params, fix the spawn's hard-coded piston lapse, and show `<REAL TYPE> → <MODEL> MODEL` on the handoff card.

**Files:**
- Modify: `frontend/src/game/FlightSession.tsx` (line 101 `loadC172()`; HandoffCard render lines 232–234)
- Modify: `frontend/src/dashboard/DashboardStrip.tsx` (line 161 `loadC172()`)
- Modify: `frontend/src/panels/HandoffCard.tsx` (disclosure lines 52–56; new `params`/`matched` props)
- Modify: `frontend/src/takeover/spawn.ts` (thrust-capacity lapse line 149–151)
- Modify: `frontend/src/panels/HandoffCard.test.tsx`

**Interfaces:**
- Consumes: `resolveClass`, `disclosureLine` (Task 9); `loadClassById` (Task 9); `POWER_LAPSE_MODELS` (Task 2).
- Produces: `HandoffCard` gains props `params: ClassParams | null` and `matched: boolean`.

Steps:

- [ ] **Step 1 — Fix the spawn lapse (no hidden piston assumption for jets).** `takeover/spawn.ts` (lines 149–151) computes the trimmed throttle with `pistonPowerLapse(altitudeM)` hard-coded — for a turbofan class this is the wrong lapse. Failing test first, in a new/extended `frontend/src/takeover/spawn.test.ts`:

```ts
it("trims a turbofan class using its own lapse, not the piston curve", () => {
  const b738 = loadB738();
  const c = { t: "A320", gs: 450, alt_geom: 35000, alt_baro: 35000, baro_rate: 0,
    lat: 30, lon: -88, track: 90, hex: "abc", flight: "T", military: false, seen_pos: 2 } as Contact;
  const spawn = buildSpawnState(c, b738, { terrainHeightM: null });
  // The trimmed throttle holds level flight: re-derive drag and confirm thrust ≈ drag at spawn.
  expect(spawn.controls.throttle).toBeGreaterThan(0);
  expect(spawn.controls.throttle).toBeLessThanOrEqual(1);
  expect(spawn.state.machNumber).toBeGreaterThan(0.6); // it spawned at a real cruise Mach
});
```

Then change `spawn.ts` to use the class's own lapse:

```ts
import { POWER_LAPSE_MODELS } from "../sim/forces";
// ...
  const thrustCapacityN =
    (params.propulsion.propEfficiency * params.propulsion.maxPowerW *
      POWER_LAPSE_MODELS[params.propulsion.lapseModel](altitudeM)) /
    Math.max(tasMs, params.propulsion.propPeakSpeedMs);
```

Remove the now-unused `pistonPowerLapse` import if nothing else in the file uses it. (Afterburner is not threaded into spawn: the aircraft spawns trimmed and dry, `afterburner: false` in its `controls` literal from Task 1.)

- [ ] **Step 2 — Failing HandoffCard test.** `frontend/src/panels/HandoffCard.test.tsx` currently asserts `"C172 MODEL THIS BUILD"` (line 43). Update it and add cases:

```ts
  it("discloses the model substitution for a matched airliner", () => {
    const p = loadClassById("b738");
    const text = render({ contact: ac({ t: "A320" }), spawn, params: p, matched: true, countdown: 3, note: "" });
    expect(text).toContain("A320 → 737-800 MODEL");
  });
  it("flags an unmatched substitution (C130 flies the C172 default)", () => {
    const p = loadClassById("c172s");
    const text = render({ contact: ac({ t: "C130" }), spawn, params: p, matched: false, countdown: 3, note: "" });
    expect(text).toContain("C130 → C172 MODEL THIS BUILD (NO MATCHING CLASS)");
  });
```

(Adapt the file's existing `render`/`ga` helpers; add a `ac(over)` contact factory if needed. The old `"C172 MODEL THIS BUILD"` assertion becomes the matched-C172 disclosure `"C172 → C172 MODEL THIS BUILD"` for a GA contact.)

- [ ] **Step 3 — Update `HandoffCard.tsx`.** Add `params: ClassParams | null` and `matched: boolean` to the props (lines 21–31), import `disclosureLine` from `../takeover/eligibility` and `ClassParams`, and replace the hard-coded disclosure (lines 52–56):

```tsx
      <div className="handoff-disclosure">
        FLYING THE {spawn === null || params === null ? EM_DASH : disclosureLine(contact, params, matched)} ·
        GROUND SPEED IS USED AS TRUE AIRSPEED (STILL AIR) · ALTITUDE FROM{" "}
        {spawn === null ? EM_DASH : spawn.altitudeSource === "alt_geom" ? "ALT_GEOM" : "ALT_BARO"}
      </div>
```

(Import `EM_DASH` from `../hud/format`.)

- [ ] **Step 4 — Wire `FlightSession.tsx`.** Replace `const params = loadC172();` (line 101) inside the countdown effect with the resolved class, and compute the resolution once in render scope for the card:

```tsx
    const resolution = resolveClass(contact);
    const params = loadClassById(resolution.classId);
```

In render scope, derive the card's params/matched from `origin`:

```tsx
  const originResolution = origin ? resolveClass(origin.snapshot) : null;
  const originParams = originResolution ? loadClassById(originResolution.classId) : null;
```

and pass them to `HandoffCard` (line 232–234):

```tsx
        <HandoffCard contact={origin.snapshot} spawn={spawn} params={originParams}
          matched={originResolution?.matched ?? false} countdown={countdown} note={note} />
```

Import `resolveClass` from `../takeover/eligibility` and `loadClassById` from `../sim/params`; drop the now-unused `loadC172` import if nothing else uses it.

- [ ] **Step 5 — Wire `DashboardStrip.tsx`.** Replace `const params = loadC172();` (line 161) with:

```tsx
  const params = origin ? loadClassById(resolveClass(origin.snapshot).classId) : loadC172();
```

(Import `loadClassById`, `resolveClass`. Keep the `loadC172()` fallback for when there is no origin — the strip can mount before an origin is set.)

- [ ] **Step 6 — Full run to pass.** `cd frontend && npm test`, `npx tsc --noEmit`, `npm run build`. Confirm: a B738 contact flies `b738` (its ASI face is 60–400, attitude is a ball, disclosure `A320 → 737-800 MODEL`); a C130 contact flies `c172s` with `C130 → C172 MODEL THIS BUILD (NO MATCHING CLASS)`.

- [ ] **Step 7 — Manual smoke (owner-facing).** `bash scripts/dev.sh`, pick a real airliner and (if present) a fast-jet on the browse globe, TAKE CONTROLS, and confirm the handoff card discloses the substitution, the jet ASI face and horizon ball render, and `KeyB` toggles DRY/WET on the F-5E. Screenshot for the sign-off.

- [ ] **Step 8 — Commit + stop.** `git add -A && git commit -m "feat: infer class from feed type, disclose substitution, per-class spawn lapse"`. **Stop and wait for owner sign-off** (CLAUDE.md ground rule 5).

---

## Done-list (verify before declaring the feature complete)

- [ ] `grep -rn "if (.*=== \"b738\"\|=== \"f5e\"\|=== \"c172s\")" frontend/src/sim` returns nothing — no per-class branch leaked into the physics (data-not-branches).
- [ ] `git diff --stat main -- frontend/package.json` shows zero dependency lines — no new deps.
- [ ] Every number in `b738.json` and `f5e.json` has a `sources` entry; every unsourced one says `TUNING KNOB` with a target. `grep -c "TUNING KNOB" frontend/src/params/f5e.json` > 0.
- [ ] The validator rejects each of `mmo`, `afterburnerFactor`, `display`, and an unknown `attitudeStyle`/`lapseModel` (Task 1 tests green).
- [ ] `c172.json` still loads and the whole C172 envelope suite is unchanged-green.
- [ ] `npx tsc --noEmit` and `npm run build` clean; full `npm test` green.
- [ ] `docs/decisions.md` carries AF-001 … AF-006.
