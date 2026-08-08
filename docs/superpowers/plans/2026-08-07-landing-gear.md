# Retractable Landing Gear (dynamic gear control) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Do TDD in the order written: failing test → run-to-fail
> → minimal impl → run-to-pass → commit. **Stop and wait for owner sign-off at the end of Task 4**
> (KeyG actually toggles something, still no annunciator) and again at the end of Task 6 (wired
> end-to-end — the acceptance-flight bug is fixed), per CLAUDE.md ground rule 5.

**Goal:** Turn `gear` from a static class descriptor into a real, dynamic system: a `KeyG`
edge-toggle commands a target (`ControlVector.gearDown`), an integrated position
(`SimState.gearPosition`, 0=up..1=down) eases toward it over a shared transition time, extended
gear adds parasitic drag, and a `GEAR O'SPD` annunciator trips above the gear-limit speed —
**all data, not per-class branches**. This fixes the acceptance-flight bug where every jet reads
`GEAR DOWN` forever, including at FL350 cruise. The C172 (fixed gear) is unaffected: gear stays
down, `KeyG` inert, readout `GEAR FIXED`.

**Architecture:** Builds entirely on the shared modules the airliner/fighter-classes feature
already put in place (`ClassParams.gear`, `ControlVector.afterburner`'s edge-trigger pattern, the
`warningsFor` annunciator list, `ControlState`'s `formatGear` readout). New behaviour: `sim/types.ts`
gains `ControlVector.gearDown`, `SimState.gearPosition`, and two `ClassParams` fields
(`aero.gearDragCd0`, `limits.vleIasMs`); `sim/params.ts`'s validator requires the two new fields
(no silent default); `sim/forces.ts` gains a `GEAR_TRANSITION_S` constant + a pure
`advanceGearPosition()` integrator (mirroring `TURBOFAN_CORNER_M`/`turbofanPowerLapse`), and
`computeForces` folds `gearDragCd0 * gearPosition` into parasitic drag; `sim/aircraft.ts`'s
`stepAircraft` calls the integrator once per physics tick (the sim's actual per-tick state
advance, not `game/flightLoop.ts` — see the Signature decisions section for why this plan departs
from the design spec's literal file placement); `game/flightLoop.ts` threads `gearPosition` and a
computed `gearOverspeed` into the `HudSnapshot`; `hud/format.ts`'s `formatGear` grows a fourth
state (`GEAR IN TRANSIT`) and `warningsFor` pushes `GEAR O'SPD`; `input/controls.ts` adds the
edge-triggered `KeyG` toggle (mirroring the existing `KeyB` afterburner toggle), guarded inert for
`gear === "fixed"`; `takeover/spawn.ts` spawns retractable aircraft gear-up (the actual bug fix)
and fixed aircraft gear-pinned. Every gate is `params.gear === "retractable"` (data), never a
class-id check.

**Tech Stack:** Vite · React 18 + TypeScript · CesiumJS (keyless) · Zustand · Tailwind (layout
only) + hand-written `styles/tokens.css` · Python 3.12 + FastAPI (untouched by this feature).
Tests are **vitest in the node environment** (no jsdom): components are called as plain functions
and their returned element tree is walked. Gates: `cd frontend && npm test` (= `vitest run`),
`cd frontend && npx tsc --noEmit`, `cd frontend && npm run build`.

## Global Constraints

Binding for every task.

- **One force model, data not branches (CLAUDE.md "Flight model"; spec's binding ground rules):**
  no `if (class === …)` or `if (id === …)` anywhere. Every gate is `params.gear` (`"fixed"` |
  `"retractable"`) or a numeric field (`gearDragCd0`, `vleIasMs`) — data, never a class id.
- **Sim state unmistakable (CLAUDE.md ground rule 2):** unchanged by this feature — the SIM
  banner, amber accent, `SIM-<hex>` callsign, and the ghost are not touched.
- **No new dependencies (CLAUDE.md ground rule 3):** `git diff --stat main -- frontend/package.json`
  must show **zero** lines at every task boundary.
- **Validator has no silent defaults (spec, verbatim):** the two new required `ClassParams`
  fields (`aero.gearDragCd0`, `limits.vleIasMs`) throw at load time if absent or the wrong type —
  same hand-written validator style already used for `mmo`/`afterburnerFactor`/`display`. Note
  `gearDragCd0` uses the plain `num()` helper, not `positive()` — the C172 ships `gearDragCd0: 0`
  (its fixed-gear drag is already folded into `cd0`), and `positive()` rejects zero.
- **`sim/` stays Cesium-free and pure modules stay pure (CLAUDE.md "Stack"):** `advanceGearPosition`
  is a plain `(number, boolean, string, number) → number` function; `stepAircraft`/`refreshDerived`
  take no Cesium types.
- **Structural/damage limits deferred to Phase E (spec, binding):** `GEAR O'SPD` is an
  **annunciator only** — no damage, no forced retraction, no override. Do not add either.
- **Decisions log (CLAUDE.md ground rule 4):** append dated entries to `docs/decisions.md` tagged
  **GR-001 … GR-006**, per the design spec's own numbering. The six decisions are already written
  in the spec; the steps below say exactly when each is logged (some decisions get one entry that
  covers their data half and behaviour half in two tasks — noted at each `Log` step).
- **Each task ends with the full frontend suite green, `npx tsc --noEmit` clean, `npm run build`
  clean, and exactly ONE commit.** Intermediate TDD cycles inside a task end at a passing run, not
  at a commit.
- **Broken-arm discipline (`task-relative-test-gate`):** every "broken-arm" test below must be run
  and confirmed RED before the implementation step that turns it green — not just asserted to be
  meaningful. The step list says explicitly when to check this.

## Source documents

- **This feature's spec (authoritative):** `docs/superpowers/specs/2026-08-07-landing-gear-design.md`
- **Depends on / format precedent:** `docs/superpowers/plans/2026-08-07-airliner-fighter-classes.md`
  (already implemented on this branch — `gear`, `ClassParams.display`, `ControlVector.afterburner`,
  the `warningsFor`/`formatGear` machinery this plan extends all exist because of it)
- Founding spec: `docs/superpowers/specs/2026-07-27-adsb-game-design.md`
- Carried decisions: `docs/decisions.md` — AF-001 (required-field validator pattern),
  AF-002/AF-004a (`TURBOFAN_CORNER_M` tuning-knob-constant pattern this plan mirrors for
  `GEAR_TRANSITION_S`), AF-006 (per-class display data), AF-008 (spawn envelope clamps)

## Test-runner reality (verified against `frontend/package.json`, 2026-08-07; baseline 703/703 green)

| What | Command |
|---|---|
| Full frontend suite | `cd frontend && npm test` (= `vitest run`) |
| One file | `cd frontend && npm test -- src/sim/params.test.ts` |
| Typecheck | `cd frontend && npx tsc --noEmit` |
| Production build | `cd frontend && npm run build` |

## Spec requirement map — every decision/section to a task

| Spec clause | Requirement | Task |
|---|---|---|
| GR-001 | `ControlVector.gearDown` (required boolean); `SimState.gearPosition` (integrated) | 1 (fields), 2 (integrator) |
| GR-002 | Timed transition via a shared `GEAR_TRANSITION_S` constant, eased `dt/GEAR_TRANSITION_S` per tick, clamped `[0,1]` | 2 |
| GR-003 | `gearDragCd0` required per-class field; effective parasitic drag `cd0 + gearDragCd0 * gearPosition`; C172 `gearDragCd0: 0` (no regression) | 1 (field), 3 (wiring + broken-arm) |
| GR-004 | `vleIasMs` required per-class field (spec's `vleKt` — see Signature decisions for the unit/name change); `GEAR O'SPD` annunciator: retractable + extended + IAS > `vleIasMs` | 1 (field), 5 (annunciator + label) |
| GR-005 | Fixed gear pinned: `gearPosition` forced to 1, `KeyG` inert, readout `GEAR FIXED`, no transition, no `GEAR O'SPD` | 2 (pin), 4 (inert key) |
| GR-006 | Retractable spawns gear-up (`gearDown: false`, `gearPosition: 0`); fixed spawns `gearPosition: 1` — the actual bug fix | 6 |
| Testing §"Transition integrator" | unit tests: up→down over ~`GEAR_TRANSITION_S`, clamp, fixed pinned | 2 |
| Testing §"Drag ramp" | broken-arm: retractable class has measurably more drag / lower max-level-speed gear-down vs gear-up; C172 unchanged | 3 |
| Testing §"`GEAR O'SPD`" | trips retractable+extended+over-speed; does NOT trip fixed, gear-up, or under-speed; broken-arm on the gate ignoring either input | 5 |
| Testing §"Spawn" | retractable spawns `GEAR UP`; fixed spawns `GEAR FIXED` | 6 |
| Testing §"`KeyG`" | edge-triggered, one flip per press; inert for fixed gear | 4 |
| Testing §"`formatGear`" | all four label states | 5 |
| Testing §"No regression" | C172 envelope suite + existing gauge/format tests stay green | every task |
| Non-goals | no gear damage, no auto-retract/horn, no per-class transition time, no ground ops | (nothing to build — verified absent in review) |

## Signature decisions (made while reading the real code — consistent across all tasks)

1. **`vleIasMs`, not the spec's `vleKt` — same unit convention as its siblings.** Every existing
   `ClassParams.limits` speed field (`vneIasMs`, `vnoIasMs`, `vfeIasMs`) is IAS in **m/s**, matching
   CLAUDE.md's "SI units internally, aviation units only at the display edge." The spec names the
   field `vleKt` (implying knots) purely because the design table quotes book Vle figures in knots.
   Storing knots inside `ClassParams` would be the one field in the whole file breaking the SI-
   internal rule, and would force a `ktToMs`/`msToKt` conversion at the `gearOverspeed` gate that
   every sibling limit (`overspeed`, `machOverspeed`) does not need. This plan ships `limits.vleIasMs:
   number` (m/s), converts the design table's kt figures (270/240 kt) to m/s once in the JSON
   (`ktToMs(270) ≈ 138.9`, `ktToMs(240) ≈ 123.5`), and keeps the kt figure in that field's `sources`
   note for provenance. `gearOverspeed` then reads exactly like the existing
   `overspeed: state.iasMs > params.limits.vneIasMs` line — same shape, same units, no conversion
   at the gate.
2. **The transition integrator lives in `sim/aircraft.ts`'s `stepAircraft`, not literally inside
   `game/flightLoop.ts`.** The design spec's architecture table says `game/flightLoop.ts`
   "integrates gearPosition" — but `SimState` is advanced ONLY inside `stepAircraft` (that is where
   every other integrated/derived field — `tasMs`, `rates`, `machNumber`, `loadFactor` — gets its
   new value each tick; `game/flightLoop.ts` just calls `stepAircraft` once per physics tick and
   reads the result). Duplicating a second, `game/`-side mutation path for one field would split
   `SimState`'s ownership and make it untestable without a `FlightHost` mock. This plan puts
   `advanceGearPosition()` (a pure function) in `sim/forces.ts` — exactly where the spec puts the
   `GEAR_TRANSITION_S` constant — and calls it from `stepAircraft`, so it is unit-tested the same
   way `turbofanPowerLapse` is: directly, in the node env, no Cesium, no `FlightHost`.
   `game/flightLoop.ts`'s only job (Task 5) is reading `state.gearPosition` into the `HudSnapshot`
   and computing `gearOverspeed` — the same shape as its existing `overspeed`/`machOverspeed` lines.
3. **Gear drag is added inline in `computeForces`, not by changing `dragCoefficient`'s signature.**
   `dragCoefficient(cl, params, flap)` has three direct call sites in test files
   (`forces.test.ts`, `envelope.test.ts`, `b738-envelope.test.ts`, `f5e-envelope.test.ts`) plus
   `takeover/spawn.ts`. The spec's formula — "effective parasitic drag is `cd0 + gearDragCd0 *
   gearPosition`" — is a plain additive term, so `computeForces` and `spawn.ts` each add
   `params.aero.gearDragCd0 * gearPosition` to the `cd` value returned by `dragCoefficient` at
   their own call sites, rather than growing `dragCoefficient`'s parameter list and touching five
   files whose assertions do not involve gear at all. `dragCoefficient` itself is unchanged.
4. **`KeyG` and its `GAME_KEY_CODES`/`ControlsHelp` entries already exist as an inert placeholder**
   — this feature only changes `input/controls.ts` (the sampler + the `KEYMAP` action string).
   `input/keyboard.ts`'s `GAME_KEY_CODES` already contains `"KeyG"` (added when gear was a static
   descriptor) and `dashboard/ControlsHelp.tsx`'s `KEY_LABELS` already has `KeyG: "G"` — both need
   zero edits. `ControlsHelp` renders its rows entirely from `KEYMAP` (`groupKeymap`), so changing
   `KEYMAP.KeyG`'s text from `"gear (fixed on this aircraft)"` to `"gear up/down"` is the only
   surface-level change, and no test hardcodes the old string (verified: `grep -rn "gear (fixed" —
   only the one line in `controls.ts`).
5. **`formatGear` grows a second parameter, `gearPosition: number | null`.** Its four output
   states (`GEAR FIXED` / `GEAR UP` / `GEAR DOWN` / `GEAR IN TRANSIT`) cannot be derived from the
   `gear` capability string alone. `ControlState.tsx` threads `snapshot?.gearPosition ?? null`
   through alongside the existing `gear` prop.

---

## Task 1 — Types + validator + data fields + `ControlVector` sweep (foundation)

Foundation for everything: add `ControlVector.gearDown`, `SimState.gearPosition`, and the two new
required `ClassParams` fields (`aero.gearDragCd0`, `limits.vleIasMs`); make the validator require
them with no silent default; update all three shipped param files; sweep every `ControlVector`
literal so the type still compiles. Nothing here changes flight behaviour — the full suite must
stay green at 703+ (some new params tests) with no C172/B738/F5E envelope numbers moving.

**Files:**
- Modify: `frontend/src/sim/types.ts` (`ClassParams.aero` lines 46–63; `ClassParams.limits` lines
  99–110; `ControlVector` lines 124–139; `SimState` lines 142–167)
- Modify: `frontend/src/sim/params.ts` (aero block lines 113–121; limits block lines 142–150)
- Modify: `frontend/src/params/c172.json`, `frontend/src/params/b738.json`,
  `frontend/src/params/f5e.json` (add `gearDragCd0`, `vleIasMs` + `sources` entries)
- Modify (literal sweep, add `gearDown: false`): `frontend/src/input/controls.ts` (`COLD` line 65;
  sampler return line 117), `frontend/src/takeover/spawn.ts` (line 176),
  `frontend/src/sim/forces.test.ts` (line 18), `frontend/src/sim/aircraft.test.ts` (line 27),
  `frontend/src/sim/envelope.test.ts` (lines 105, 134, 167, 215, 230, 249),
  `frontend/src/sim/b738-envelope.test.ts` (lines 109, 134, 157, 171, 190),
  `frontend/src/sim/f5e-envelope.test.ts` (line 109),
  `frontend/src/input/controls.test.ts` (lines 20, 127, 142)
- Modify (literal sweep, add `gearPosition: 0`): `frontend/src/sim/forces.test.ts` (the `stateAt`
  helper, line 41), `frontend/src/sim/aircraft.test.ts` (line 39),
  `frontend/src/sim/envelope.test.ts` (`levelState`, line 79),
  `frontend/src/sim/b738-envelope.test.ts` (line 81), `frontend/src/sim/f5e-envelope.test.ts`
  (line 78), `frontend/src/game/stats.test.ts` (line 17), `frontend/src/game/classify.test.ts`
  (line 109)
- Modify (production `SimState` literal, `gearPosition` set from spawn logic — see Task 6, not a
  placeholder here): `frontend/src/takeover/spawn.ts` (`provisional`, around line 196) — Task 1
  adds `gearPosition: 0,` as a placeholder so the file compiles; Task 6 replaces it with the real
  GR-006 value.
- Modify: `frontend/src/sim/params.test.ts` (new required-field cases + loader assertions)

**Interfaces:**
- Produces:
  - `sim/types.ts`: `ClassParams.aero.gearDragCd0: number`
  - `sim/types.ts`: `ClassParams.limits.vleIasMs: number`
  - `sim/types.ts`: `ControlVector.gearDown: boolean`
  - `sim/types.ts`: `SimState.gearPosition: number`
  - `sim/params.ts`: `validateClassParams` enforces both new fields, no silent default
- Consumes: existing `num`/`positive` helpers in `sim/params.ts`.

Steps:

- [ ] **Step 1 — Confirm the baseline.** `cd frontend && npm test && npx tsc --noEmit`. Expect
  **703 tests / 56 files, all green**, matching the branch's recorded baseline. If anything is
  red, stop — the plan assumes a green baseline.

- [ ] **Step 2 — Failing validator tests first.** Append to `frontend/src/sim/params.test.ts`
  inside `describe("validateClassParams", …)`:

```ts
  it("rejects a missing aero.gearDragCd0 rather than defaulting", () => {
    const p = loadC172();
    const { gearDragCd0: _omitted, ...aero } = p.aero as unknown as Record<string, unknown>;
    const bad = { ...(p as unknown as Record<string, unknown>), aero };
    expect(() => validateClassParams(bad)).toThrow(/gearDragCd0/);
  });
  it("accepts gearDragCd0 = 0 without rejecting it as non-positive", () => {
    const p = loadC172();
    const bad = { ...(p as unknown as Record<string, unknown>), aero: { ...p.aero, gearDragCd0: 0 } };
    expect(validateClassParams(bad).aero.gearDragCd0).toBe(0);
  });
  it("rejects a missing limits.vleIasMs rather than defaulting", () => {
    const p = loadC172();
    const { vleIasMs: _omitted, ...limits } = p.limits as unknown as Record<string, unknown>;
    const bad = { ...(p as unknown as Record<string, unknown>), limits };
    expect(() => validateClassParams(bad)).toThrow(/vleIasMs/);
  });
  it("rejects a non-positive limits.vleIasMs", () => {
    const p = loadC172();
    const bad = { ...(p as unknown as Record<string, unknown>), limits: { ...p.limits, vleIasMs: 0 } };
    expect(() => validateClassParams(bad)).toThrow(/vleIasMs/);
  });
```

  Extend the three existing loader `it("loads and validates …")` blocks:

  In `describe("loadC172", …)`:
  ```ts
    expect(p.aero.gearDragCd0).toBe(0);
    expect(p.limits.vleIasMs).toBeGreaterThan(0);
  ```
  In `describe("loadB738", …)`:
  ```ts
    expect(p.aero.gearDragCd0).toBeGreaterThan(0);
    expect(p.limits.vleIasMs).toBeCloseTo(ktToMs(270), 0);
  ```
  In `describe("loadF5e", …)`:
  ```ts
    expect(p.aero.gearDragCd0).toBeGreaterThan(0);
    expect(p.limits.vleIasMs).toBeCloseTo(ktToMs(240), 0);
  ```
  (`ktToMs` needs importing in `params.test.ts`: add it to the file's `import { msToKt } from
  "./units";` line, making it `import { msToKt, ktToMs } from "./units";`.)

- [ ] **Step 3 — Run to fail.** `cd frontend && npm test -- src/sim/params.test.ts`. Expect the
  four new cases to fail (fields not validated) and the three extended loader assertions to fail
  with a TypeScript "property does not exist" error until Step 4.

- [ ] **Step 4 — Add the types.** In `frontend/src/sim/types.ts`, in `ClassParams.aero` (after
  `cd0: number;`, line 58):

```ts
    /**
     * Parasitic-drag CD0 increment from extended gear. 0 for a fixed-gear class — its drag is
     * already folded into cd0, so this term must not double-count it (GR-003). Effective
     * parasitic drag is cd0 + gearDragCd0 * gearPosition (sim/forces.ts computeForces).
     */
    gearDragCd0: number;
```

  In `ClassParams.limits` (after `mmo: number;`, line 109):

```ts
    /**
     * Max gear-extended speed, IAS m/s — named like its siblings (vneIasMs/vnoIasMs/vfeIasMs),
     * not the design spec's "vleKt": every other limits field is SI internally per CLAUDE.md, and
     * this keeps the GEAR O'SPD gate a plain iasMs comparison with no unit conversion (GR-004).
     */
    vleIasMs: number;
```

  In `ControlVector` (after `afterburner: boolean;`, line 138):

```ts
  /**
   * Commanded gear target — true = down/extended. Edge-toggled by KeyG (input/controls.ts),
   * ignored (pinned) when ClassParams.gear === "fixed". The integrated position is
   * SimState.gearPosition, not this field (GR-001).
   */
  gearDown: boolean;
```

  In `SimState` (after `machNumber: number;`, line 166):

```ts
  /**
   * 0 = fully retracted, 1 = fully extended. Eased toward ControlVector.gearDown over
   * GEAR_TRANSITION_S seconds by stepAircraft (sim/aircraft.ts); pinned to 1 when
   * ClassParams.gear === "fixed" (GR-001/GR-002/GR-005).
   */
  gearPosition: number;
```

- [ ] **Step 5 — Extend the validator.** In `frontend/src/sim/params.ts`, in the `aero` block of
  the returned object (after `cd0: positive(aero, "cd0", "params.aero"),`, line 118):

```ts
      // num(), not positive(): the C172 ships gearDragCd0 = 0 (fixed-gear drag is already in
      // cd0), and positive() would reject that zero.
      gearDragCd0: num(aero, "gearDragCd0", "params.aero"),
```

  In the `limits` block (after `mmo: positive(limits, "mmo", "params.limits"),`, line 149):

```ts
      vleIasMs: positive(limits, "vleIasMs", "params.limits"),
```

- [ ] **Step 6 — Update the three param files.**

  `frontend/src/params/c172.json` — in `"aero"` (after `"cd0": 0.035,`, line 14):
  ```json
    "gearDragCd0": 0,
  ```
  in `"limits"` (after `"mmo": 0.45`, line 45):
  ```json
    ,
    "vleIasMs": 83.85
  ```
  Add to `"sources"`:
  ```json
    "gearDragCd0": "0 — the 172 has fixed gear; its drag is already inside the sourced cd0 (0.035). Present so the field is required data everywhere, per GR-003, not a per-class branch.",
    "vleIasMs": "83.85 m/s — set equal to vneIasMs, so IAS can never exceed it (structurally unreachable even before the retractable-only GEAR O'SPD gate excludes fixed gear entirely, GR-004)."
  ```

  `frontend/src/params/b738.json` — in `"aero"` (after `"cd0": 0.02,`, line 14):
  ```json
    "gearDragCd0": 0.018,
  ```
  in `"limits"` (after `"mmo": 0.82`, line 45):
  ```json
    ,
    "vleIasMs": 138.9
  ```
  Add to `"sources"`:
  ```json
    "gearDragCd0": "TUNING KNOB — 0.018, mid of the spec's ~0.015-0.02 range for a 737-class gear/doors. Pinned by the Task 3 broken-arm test: a measurable max-level-speed drop with gear down.",
    "vleIasMs": "270 KIAS = 138.9 m/s — 737-800 Vle/Vlo placard (spec target ~270 kt)."
  ```

  `frontend/src/params/f5e.json` — in `"aero"` (after `"cd0": 0.02,`, line 14):
  ```json
    "gearDragCd0": 0.025,
  ```
  in `"limits"` (after `"mmo": 0.95`, line 45):
  ```json
    ,
    "vleIasMs": 123.5
  ```
  Add to `"sources"`:
  ```json
    "gearDragCd0": "TUNING KNOB — 0.025, a fighter gear/doors drag increment above the 737's (smaller aircraft, proportionally higher CD0 impact). Phase B source verification pending (CLAUDE.md). Pinned by the Task 3 broken-arm test.",
    "vleIasMs": "240 KIAS = 123.5 m/s — F-5E gear limit speed (spec target ~240 kt). Phase B source verification pending."
  ```

- [ ] **Step 7 — Sweep the `ControlVector` literals (add `gearDown: false`).** Run
  `grep -rn "flapDetent:.*afterburner:\|afterburner:.*flapDetent:" frontend/src` — every hit needs
  `gearDown: false` added (placed before `afterburner` to match this task's field order). Sites:
  `input/controls.ts` `COLD` (line 65) and the sampler return (line 117);
  `takeover/spawn.ts` (line 176); `sim/forces.test.ts` (line 18, the module-level `CONTROLS`
  const); `sim/aircraft.test.ts` (line 27); `sim/envelope.test.ts` (lines 105, 134, 167, 215, 230,
  249); `sim/b738-envelope.test.ts` (lines 109, 134, 157, 171, 190); `sim/f5e-envelope.test.ts`
  (line 109); `input/controls.test.ts` (lines 20, 127, 142). Do **not** change any assertion —
  only add the field. Example (`controls.ts` `COLD`):

```ts
const COLD: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle: 0, flapDetent: 0, trim: 0, gearDown: false, afterburner: false };
```

  and the sampler return (line 117):

```ts
      return { pitch, roll, yaw, throttle, flapDetent, trim, gearDown, afterburner };
```

  (The live `gearDown` value here is still the hard-coded field name only — the sampler doesn't
  yet compute it; Task 4 adds the `gearDown` local variable and edge-trigger. For Step 7, add a
  `let gearDown = initial.gearDown;` placeholder next to `let afterburner = …` at line 85 so this
  compiles — Task 4 will build the edge-trigger on top of it.)

- [ ] **Step 8 — Sweep the `SimState` literals (add `gearPosition: 0`).** Run
  `grep -rn "machNumber: 0" frontend/src` — every hand-built `SimState` object literal needs
  `gearPosition: 0,` added (the value is a placeholder; nothing reads it meaningfully at this
  task). Sites: `sim/forces.test.ts` (the `stateAt` helper, line 41), `sim/aircraft.test.ts` (line
  39), `sim/envelope.test.ts` (`levelState`, line 79), `sim/b738-envelope.test.ts` (line 81),
  `sim/f5e-envelope.test.ts` (line 78), `sim/game/stats.test.ts` → actually `game/stats.test.ts`
  (line 17), `game/classify.test.ts` (line 109), and `takeover/spawn.ts`'s `provisional` object
  (after `machNumber: 0,`, line 196):

```ts
    machNumber: 0,
    gearPosition: 0,
```

  (Task 6 replaces this literal `0` in `spawn.ts` with the real GR-006 value — this step only
  makes the file compile.)

- [ ] **Step 9 — Run to pass.** `cd frontend && npm test -- src/sim/params.test.ts` (new cases
  green), then the whole suite `cd frontend && npm test`, then `npx tsc --noEmit` and
  `npm run build`. Every C172/B738/F5E envelope number must be **unchanged** — this task adds
  fields and sweeps literals only, no force-model behaviour moved yet. Fix any missed literal the
  sweep left red (TypeScript will name the file and the missing property).

- [ ] **Step 10 — Log the decisions.** Append to `docs/decisions.md`:

```
## 2026-08-07 — GR-001/GR-003/GR-004 · gear command/position split + drag/O'SPD data fields

ControlVector.gearDown (commanded target, edge-toggled) and SimState.gearPosition (integrated
0..1) are split fields, not one — the command is an input (testable independent of time), the
position is state (testable independent of the keyboard). Two new required ClassParams fields
land with no silent default: aero.gearDragCd0 (0 for the fixed-gear C172, whose drag is already
in cd0) and limits.vleIasMs (m/s — see the plan's Signature Decision #1 for why this departs
from the design spec's "vleKt" naming/unit: every sibling limits field is IAS in m/s per
CLAUDE.md's SI-internal rule, so vleIasMs keeps the GEAR O'SPD gate a plain iasMs comparison).
C172 ships vleIasMs = vneIasMs (structurally unreachable); b738 138.9 m/s (270 kt Vle/Vlo);
f5e 123.5 m/s (240 kt gear limit, Phase B verification pending).
```

- [ ] **Step 11 — Commit.** `git add -A && git commit -m "feat(sim): required gearDragCd0/vleIasMs + ControlVector.gearDown + SimState.gearPosition"`

---

## Task 2 — Gear transition integrator

Add the shared `GEAR_TRANSITION_S` constant and a pure `advanceGearPosition` integrator to
`sim/forces.ts` (mirroring the `TURBOFAN_CORNER_M`/`turbofanPowerLapse` pattern), and wire it into
`sim/aircraft.ts`'s `stepAircraft` — the sim's actual per-tick state advance (see Signature
Decision #2 for why this is not literally inside `game/flightLoop.ts`).

**Files:**
- Create: `frontend/src/sim/gear.test.ts`
- Modify: `frontend/src/sim/forces.ts` (new `GEAR_TRANSITION_S` + `advanceGearPosition`, placed
  after `controlAuthority`, line 160, before `computeForces`, line 162)
- Modify: `frontend/src/sim/aircraft.ts` (`stepAircraft`, lines 42–77 — import + call +
  `advanced.gearPosition`)

**Interfaces:**
- Produces: `forces.ts`: `GEAR_TRANSITION_S = 10` (seconds, exported constant);
  `advanceGearPosition(current: number, gearDown: boolean, gear: "fixed" | "retractable", dt: number): number`
- Consumes: nothing new — pure arithmetic.

Steps:

- [ ] **Step 1 — Failing test.** Create `frontend/src/sim/gear.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { advanceGearPosition, GEAR_TRANSITION_S } from "./forces";

describe("gear transition integrator", () => {
  it("eases from up to down over GEAR_TRANSITION_S seconds", () => {
    let pos = 0;
    for (let i = 0; i < GEAR_TRANSITION_S * 60; i++) {
      pos = advanceGearPosition(pos, true, "retractable", 1 / 60);
    }
    expect(pos).toBeCloseTo(1, 2);
  });
  it("eases from down to up over GEAR_TRANSITION_S seconds", () => {
    let pos = 1;
    for (let i = 0; i < GEAR_TRANSITION_S * 60; i++) {
      pos = advanceGearPosition(pos, false, "retractable", 1 / 60);
    }
    expect(pos).toBeCloseTo(0, 2);
  });
  it("does not move before GEAR_TRANSITION_S has elapsed", () => {
    let pos = 0;
    for (let i = 0; i < (GEAR_TRANSITION_S / 2) * 60; i++) {
      pos = advanceGearPosition(pos, true, "retractable", 1 / 60);
    }
    expect(pos).toBeCloseTo(0.5, 2);
  });
  it("clamps to [0, 1] and does not overshoot on a large dt", () => {
    expect(advanceGearPosition(0.9, true, "retractable", 5)).toBe(1);
    expect(advanceGearPosition(0.1, false, "retractable", 5)).toBe(0);
  });
  it("holds position when the command already matches it", () => {
    expect(advanceGearPosition(1, true, "retractable", 1 / 60)).toBe(1);
    expect(advanceGearPosition(0, false, "retractable", 1 / 60)).toBe(0);
  });
  it("fixed gear is pinned at 1 regardless of the command or dt (GR-005)", () => {
    expect(advanceGearPosition(0, true, "fixed", 1 / 60)).toBe(1);
    expect(advanceGearPosition(1, false, "fixed", 1 / 60)).toBe(1);
    expect(advanceGearPosition(0.3, false, "fixed", 100)).toBe(1);
  });
});
```

- [ ] **Step 2 — Run to fail.** `cd frontend && npm test -- src/sim/gear.test.ts`. Expect
  `does not provide an export named 'advanceGearPosition'` (and `'GEAR_TRANSITION_S'`).

- [ ] **Step 3 — Implement in `forces.ts`.** Insert after `controlAuthority` (line 160), before
  `computeForces` (line 162):

```ts
/**
 * Retractable gear travels between fully up (0) and fully down (1) over one shared transition
 * time — data-independent of class (GR-002): a per-class transition time would add a required
 * ClassParams field for one cosmetic-plus-drag knob, and no class in this sim needs a different
 * one yet (revisit if an envelope test demands it). Fixed-gear classes are pinned at 1 (GR-005):
 * gear never retracts, KeyG is inert (input/controls.ts), and this function never eases for them.
 */
export const GEAR_TRANSITION_S = 10;

export function advanceGearPosition(
  current: number,
  gearDown: boolean,
  gear: "fixed" | "retractable",
  dt: number,
): number {
  if (gear === "fixed") return 1;
  const target = gearDown ? 1 : 0;
  const step = dt / GEAR_TRANSITION_S;
  if (target > current) return Math.min(target, current + step);
  if (target < current) return Math.max(target, current - step);
  return current;
}
```

- [ ] **Step 4 — Run to pass (gear.test.ts).** `cd frontend && npm test -- src/sim/gear.test.ts`.

- [ ] **Step 5 — Wire into `stepAircraft`.** In `frontend/src/sim/aircraft.ts`, change the import
  (line 13):

```ts
import { computeForces, advanceGearPosition } from "./forces";
```

  In `stepAircraft` (lines 42–77), add before the `advanced` object is built:

```ts
  const gearPosition = advanceGearPosition(state.gearPosition, controls.gearDown, params.gear, dt);
```

  and add `gearPosition,` to the `advanced` object (after `machNumber: f.machNumber,`, line 74):

```ts
    machNumber: f.machNumber,
    gearPosition,
```

  `refreshDerived` (lines 20–40) needs **no change**: it does not advance time, so it must not
  re-run the transition — `gearPosition` already flows through unchanged via its `{ ...withAlt,
  … }` spread (`withAlt` is `{ ...state, altitudeM: … }`, and `state.gearPosition` is part of
  `state`).

- [ ] **Step 6 — Run to pass.** `cd frontend && npm test`, `npx tsc --noEmit`, `npm run build`.
  Full suite green; no envelope number moves (nothing yet reads `gearPosition` for drag or
  display — that's Task 3/5).

- [ ] **Step 7 — Log the decisions.** Append to `docs/decisions.md`:

```
## 2026-08-07 — GR-002/GR-005 · shared gear transition constant + fixed-gear pin

GEAR_TRANSITION_S = 10 s lives in sim/forces.ts as a documented TUNING KNOB, same placement
pattern as TURBOFAN_CORNER_M (decisions AF-002): one shared curve for every retractable class
in v1, not a per-class field, because no envelope test yet needs a different time. The pure
advanceGearPosition(current, gearDown, gear, dt) integrator is called from sim/aircraft.ts's
stepAircraft — the sim's actual per-tick SimState advance — rather than from game/flightLoop.ts
as the design spec's architecture table literally states; see the implementation plan's
Signature Decision #2 for why (SimState integration belongs in one place, alongside every other
derived/integrated field, and this keeps the integrator unit-testable without a FlightHost).
Fixed-gear classes are pinned at gearPosition = 1 unconditionally (GR-005) — no transition ever
runs for the C172, and KeyG's inertness (Task 4) is a second, independent enforcement of the
same rule at the input layer.
```

- [ ] **Step 8 — Commit.** `git add -A && git commit -m "feat(sim): gear transition integrator (GEAR_TRANSITION_S, advanceGearPosition)"`

---

## Task 3 — Gear drag

Fold `gearDragCd0 * gearPosition` into parasitic drag inside `computeForces` (and the equivalent
trim-drag calculation in `takeover/spawn.ts`), per Signature Decision #3 — an inline addition at
each `dragCoefficient` call site, not a signature change to `dragCoefficient` itself.

**Files:**
- Modify: `frontend/src/sim/forces.ts` (`computeForces`, the `cd` line, currently line 179)
- Modify: `frontend/src/takeover/spawn.ts` (the `dragN` line, currently line 163 — placeholder
  edit only; Task 6 finishes wiring `gearPositionAtSpawn` end-to-end)
- Modify: `frontend/src/sim/forces.test.ts` (new `describe("gear drag", …)`; needs `vLength` added
  to its `./vec3` import and `loadB738` added to its `./params` import)

**Interfaces:**
- Consumes: `ClassParams.aero.gearDragCd0` (Task 1), `SimState.gearPosition` (Task 1/2).
- No new exports — `computeForces`'s existing `ForceResult` shape is unchanged; the drag increase
  shows up in `forceEcef`.

Steps:

- [ ] **Step 1 — Failing broken-arm test.** In `frontend/src/sim/forces.test.ts`, add `loadB738`
  to the existing `import { loadC172 } from "./params";` (making it
  `import { loadC172, loadB738 } from "./params";`) and `vLength` to the existing
  `import { vScale, vSub } from "./vec3";` (making it `import { vLength, vScale, vSub } from
  "./vec3";`). Append:

```ts
describe("gear drag", () => {
  it("adds gearDragCd0 * gearPosition of parasitic drag for a retractable class (broken-arm)", () => {
    const B738 = loadB738();
    const controls: ControlVector = {
      pitch: 0, roll: 0, yaw: 0, throttle: 0.5, flapDetent: 0, trim: 0,
      gearDown: false, afterburner: false,
    };
    const alt = ftToM(10000);
    const tas = 128; // ~250 kt TAS
    const gearUp = computeForces({ ...stateAt(alt, tas), gearPosition: 0 }, controls, B738);
    const gearDown = computeForces({ ...stateAt(alt, tas), gearPosition: 1 }, controls, B738);
    // Same speed, altitude and AoA in both calls — the ONLY thing that can differ is the drag
    // term gearDragCd0 * gearPosition adds. A real drag increase, not floating-point noise.
    const forceDropN = vLength(vSub(gearUp.forceEcef, gearDown.forceEcef));
    expect(forceDropN).toBeGreaterThan(1000);
  });
  it("C172 (gearDragCd0 = 0) sees no force change with gear position — no regression", () => {
    const alt = ftToM(3000);
    const tas = 50;
    const gearUp = computeForces({ ...stateAt(alt, tas), gearPosition: 0 }, CONTROLS, P);
    const gearDown = computeForces({ ...stateAt(alt, tas), gearPosition: 1 }, CONTROLS, P);
    expect(vLength(vSub(gearUp.forceEcef, gearDown.forceEcef))).toBeCloseTo(0, 6);
  });
});
```

- [ ] **Step 2 — Run to fail.** `cd frontend && npm test -- src/sim/forces.test.ts`. Confirm RED:
  the first test fails because `forceDropN` is ~0 (gear drag is not wired yet — `gearPosition` is
  set on the state but nothing reads it inside `computeForces`).

- [ ] **Step 3 — Implement.** In `frontend/src/sim/forces.ts`, replace the `cd` line inside
  `computeForces` (currently line 179):

```ts
  const cd = dragCoefficient(cl, params, flap);
```

  with:

```ts
  // Effective parasitic drag adds the gear's contribution, ramped by its integrated position
  // (GR-003) — 0 for a fixed-gear class, whose drag already lives in cd0 (gearDragCd0 = 0).
  const cd = dragCoefficient(cl, params, flap) + params.aero.gearDragCd0 * state.gearPosition;
```

- [ ] **Step 4 — Run to pass (forces.test.ts).** `cd frontend && npm test -- src/sim/forces.test.ts`.
  Both new tests green; every existing `dragCoefficient`/`computeForces` assertion in the file is
  untouched (they build states through `stateAt`, which now carries `gearPosition: 0` from Task
  1's sweep, so nothing there moves).

- [ ] **Step 5 — Placeholder wiring in `spawn.ts`.** In `frontend/src/takeover/spawn.ts`, the
  `dragN` line (currently line 163):

```ts
  const dragN = dragCoefficient(cl, params, flap) * qBar * params.wingAreaM2;
```

  becomes (using the placeholder `gearPositionAtSpawn = 0` for now — Task 6 makes this GR-006
  correct for both fixed and retractable classes):

```ts
  const gearPositionAtSpawn = 0; // placeholder — Task 6 sets this per GR-006 for every class
  const dragN = (dragCoefficient(cl, params, flap) + params.aero.gearDragCd0 * gearPositionAtSpawn) *
    qBar * params.wingAreaM2;
```

  (This is inert today — `gearPositionAtSpawn` is always 0 — so no spawn envelope test moves. It
  exists here so Task 6's diff is a one-line value change, not a new formula.)

- [ ] **Step 6 — Full gates.** `cd frontend && npm test`, `npx tsc --noEmit`, `npm run build`. Full
  suite green; C172/B738/F5E envelope numbers unchanged (gear drag only fires when `gearPosition
  > 0`, and nothing sets it above 0 yet outside the new gear.test.ts / forces.test.ts cases).

- [ ] **Step 7 — Commit.** `git add -A && git commit -m "feat(sim): gear drag (cd0 + gearDragCd0 * gearPosition)"`

---

## Task 4 — `KeyG` input

Edge-triggered toggle of `gearDown`, mirroring the existing `KeyB` afterburner pattern exactly,
guarded inert when `gear === "fixed"`.

**Files:**
- Modify: `frontend/src/input/controls.ts` (`KEYMAP` line 30; sampler state lines 85–86; edge
  trigger after line 115; return line 117; `reset()` line 123)
- Modify: `frontend/src/input/controls.test.ts` (new `describe("gear toggle", …)`; add `loadB738`
  to its `../sim/params` import)

**Interfaces:**
- Produces: `controls.ts`'s sampler now computes a real `gearDown` (previously a Task 1 wiring
  placeholder that always returned `initial.gearDown` unchanged).
- Consumes: `ClassParams.gear` (already present), `ControlVector.gearDown` (Task 1).
- **No change needed** to `input/keyboard.ts` (`GAME_KEY_CODES` already contains `"KeyG"`) or
  `dashboard/ControlsHelp.tsx` (`KEY_LABELS` already has `KeyG: "G"`) — see Signature Decision #4.

Steps:

- [ ] **Step 1 — Failing tests.** In `frontend/src/input/controls.test.ts`, add `loadB738` to the
  existing `import { loadC172 } from "../sim/params";` (making it `import { loadC172, loadB738 }
  from "../sim/params";`). Append:

```ts
describe("gear toggle", () => {
  it("KeyG toggles gearDown edge-triggered — one flip per press (retractable class)", () => {
    const s = createControlSampler(loadB738());
    expect(s.sample(new Set(), 1 / 60).gearDown).toBe(false);
    expect(s.sample(new Set(["KeyG"]), 1 / 60).gearDown).toBe(true);   // edge: up→down
    expect(s.sample(new Set(["KeyG"]), 1 / 60).gearDown).toBe(true);   // held: no re-flip
    expect(s.sample(new Set(), 1 / 60).gearDown).toBe(true);           // released: stays down
    expect(s.sample(new Set(["KeyG"]), 1 / 60).gearDown).toBe(false);  // next press: down→up
  });
  it("KeyG is inert for a fixed-gear class (GR-005)", () => {
    const s = createControlSampler(loadC172());
    expect(s.sample(new Set(["KeyG"]), 1 / 60).gearDown).toBe(false);
    expect(s.sample(new Set(["KeyG"]), 1 / 60).gearDown).toBe(false);
    expect(s.sample(new Set(), 1 / 60).gearDown).toBe(false);
  });
});
```

- [ ] **Step 2 — Run to fail.** `cd frontend && npm test -- src/input/controls.test.ts`.
  `gearDown` never flips — the sampler still returns the unmodified `initial.gearDown` from
  Task 1's placeholder wiring.

- [ ] **Step 3 — Implement the toggle.** In `frontend/src/input/controls.ts`, change the `KEYMAP`
  entry (line 30):

```ts
  KeyG: "gear up/down",
```

  Replace the Task 1 placeholder (`let gearDown = initial.gearDown;`, added beside `afterburner`
  at line 85–86) with the full edge-trigger state:

```ts
  let gearDown = initial.gearDown;
  let prevGear = false;
```

  In `sample()`, after the afterburner edge-trigger block (after line 115):

```ts
      const gearKey = held.has("KeyG");
      if (gearKey && !prevGear && params.gear === "retractable") gearDown = !gearDown;
      prevGear = gearKey;
```

  Return it (line 117):

```ts
      return { pitch, roll, yaw, throttle, flapDetent, trim, gearDown, afterburner };
```

  And in `reset()` (after `afterburner = initial.afterburner; prevBurner = false;`, line 123):

```ts
      gearDown = initial.gearDown; prevGear = false;
```

- [ ] **Step 4 — Run to pass.** `cd frontend && npm test`, `npx tsc --noEmit`, `npm run build`.
  All green, including `ControlsHelp.test.tsx` (KEYMAP's KeyG text changed but every code still
  has a label and appears in the panel — see Signature Decision #4).

- [ ] **Step 5 — Commit.** `git add -A && git commit -m "feat(input): KeyG edge-triggered gear toggle, inert for fixed gear"`

- [ ] **Stop and wait for owner sign-off.** KeyG now actually toggles `gearDown` in the control
  vector, but nothing downstream reads it yet (no transition visible, no drag, no annunciator,
  spawn still hands over whatever Task 1's placeholder set). This is a safe, narrow checkpoint
  before wiring the visible behaviour in Tasks 5–6.

---

## Task 5 — `GEAR O'SPD` annunciator + snapshot + display

Thread `gearPosition` and a computed `gearOverspeed` through `HudSnapshot`, extend `formatGear` to
four label states, and push `GEAR O'SPD` from `warningsFor`.

**Files:**
- Modify: `frontend/src/hud/snapshot.ts` (`HudSnapshot`, after `gear` line 37 and after
  `machOverspeed` line 44)
- Modify: `frontend/src/game/flightLoop.ts` (`publish()`, after `gear: params.gear,` line 112, and
  after the `machOverspeed` line, currently line 116)
- Modify: `frontend/src/hud/format.ts` (`formatGear`, lines 72–76; `warningsFor`, lines 109–120)
- Modify: `frontend/src/dashboard/ControlState.tsx` (thread `gearPosition` through to `formatGear`)
- Modify (literal sweep, `gearPosition`/`gearOverspeed`): `frontend/src/hud/format.test.ts` (`snap`
  base, line 21, plus the two direct `formatGear(...)` calls at lines 98–99),
  `frontend/src/hud/Hud.test.tsx` (`snap` base, line 65), `frontend/src/dashboard/RadarScope.test.tsx`
  (`snap` base, line 15), `frontend/src/dashboard/SixPack.test.tsx` (`snap` base, line 18),
  `frontend/src/dashboard/ControlState.test.tsx` (`snap` base, line 26, plus rewriting the gear
  assertions)

**Interfaces:**
- Produces:
  - `hud/snapshot.ts`: `HudSnapshot.gearPosition: number`, `HudSnapshot.gearOverspeed: boolean`
  - `hud/format.ts`: `formatGear(gear: "fixed" | "retractable" | null, gearPosition: number | null): string`
    — four states: `"GEAR FIXED"` / `"GEAR UP"` / `"GEAR DOWN"` / `"GEAR IN TRANSIT"` /
    `` `GEAR ${EM_DASH}` `` when unknown.
  - `hud/format.ts`: `warningsFor` pushes `"GEAR O'SPD"` when `s.gearOverspeed`.
- Consumes: `SimState.gearPosition` (Task 1/2), `ClassParams.limits.vleIasMs` (Task 1).

Steps:

- [ ] **Step 1 — Failing `formatGear`/`warningsFor` tests.** In `frontend/src/hud/format.test.ts`,
  update the `snap()` base literal (line 21) to add the two new required fields:

```ts
  machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false,
```

  Replace the two existing direct calls (lines 98–99):

```ts
    expect(formatGear("fixed", 1)).toBe("GEAR FIXED");
    expect(formatGear("retractable", 1)).toBe("GEAR DOWN");
```

  Append new cases:

```ts
  it("reports GEAR UP, GEAR IN TRANSIT and an em-dash for the unknown case", () => {
    expect(formatGear("retractable", 0)).toBe("GEAR UP");
    expect(formatGear("retractable", 0.5)).toBe("GEAR IN TRANSIT");
    expect(formatGear(null, null)).toBe(`GEAR ${EM_DASH}`);
    expect(formatGear("retractable", null)).toBe(`GEAR ${EM_DASH}`);
  });
  it("reports a gear overspeed distinctly from IAS and Mach overspeed", () => {
    expect(warningsFor(snap({ gearOverspeed: true }))).toContain("GEAR O'SPD");
    expect(warningsFor(snap({ overspeed: true }))).toContain("OVERSPEED");
    expect(warningsFor(snap({ overspeed: true }))).not.toContain("GEAR O'SPD");
  });
```

  Also update `frontend/src/hud/Hud.test.tsx`'s `snap()` base (line 65) and
  `frontend/src/dashboard/RadarScope.test.tsx`'s `snap()` base (line 15) and
  `frontend/src/dashboard/SixPack.test.tsx`'s `snap()` base (line 18) the same way:

```ts
  machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false,
```

- [ ] **Step 2 — Run to fail.** `cd frontend && npm test -- src/hud/format.test.ts`. TypeScript
  flags the two-argument `formatGear` calls and the new snapshot fields as errors until Steps 3–4;
  the full suite (`npm test`) also fails to compile in `Hud.test.tsx`/`RadarScope.test.tsx`/
  `SixPack.test.tsx` for the same reason, confirming those three sweep sites are real, not
  optional.

- [ ] **Step 3 — Extend `HudSnapshot`.** In `frontend/src/hud/snapshot.ts`, after
  `gear: "fixed" | "retractable";` (line 37):

```ts
  gear: "fixed" | "retractable";
  /** 0 (up) .. 1 (down); mirrors SimState.gearPosition. Always 1 for a fixed-gear class. */
  gearPosition: number;
```

  After `machOverspeed: boolean;` (line 44):

```ts
  /** True when retractable, gearPosition > 0, and IAS exceeds limits.vleIasMs (GR-004). */
  gearOverspeed: boolean;
```

- [ ] **Step 4 — Compute it in `flightLoop.ts`.** In `frontend/src/game/flightLoop.ts`'s
  `publish()`, after `gear: params.gear,` (line 112):

```ts
      gear: params.gear,
      gearPosition: state.gearPosition,
```

  After the `machOverspeed` line (currently line 116):

```ts
      machOverspeed: state.machNumber > params.limits.mmo,
      gearOverspeed:
        params.gear === "retractable" && state.gearPosition > 0 && state.iasMs > params.limits.vleIasMs,
```

- [ ] **Step 5 — Implement `formatGear` and `warningsFor`.** In `frontend/src/hud/format.ts`,
  replace `formatGear` (lines 72–76):

```ts
/**
 * The 172's gear is fixed; the HUD says so rather than offering a control that does nothing.
 * A retractable class reads its integrated position: fully up/down, or IN TRANSIT between.
 */
export function formatGear(
  gear: "fixed" | "retractable" | null,
  gearPosition: number | null,
): string {
  if (gear === "fixed") return "GEAR FIXED";
  if (gear !== "retractable") return `GEAR ${EM_DASH}`;
  if (gearPosition === null || !Number.isFinite(gearPosition)) return `GEAR ${EM_DASH}`;
  if (gearPosition <= 0) return "GEAR UP";
  if (gearPosition >= 1) return "GEAR DOWN";
  return "GEAR IN TRANSIT";
}
```

  In `warningsFor` (after the `machOverspeed` push, line 113):

```ts
  if (s.machOverspeed) out.push("MMO");
  if (s.gearOverspeed) out.push("GEAR O'SPD");
```

- [ ] **Step 6 — Thread it through `ControlState.tsx`.** In
  `frontend/src/dashboard/ControlState.tsx`:

```ts
  const gear = snapshot?.gear ?? null;
  const gearPosition = snapshot?.gearPosition ?? null;
```

  and its render line:

```tsx
      <span className="control-state-item">{formatGear(gear, gearPosition)}</span>
```

- [ ] **Step 7 — Update `ControlState.test.tsx`.** Update the `snap()` base (line 26):

```ts
  machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false,
```

  Update the existing "shows GEAR DOWN for a retractable class" test to be explicit about
  position (it previously relied on `formatGear`'s old one-argument unconditional `"GEAR DOWN"`):

```ts
  it("shows GEAR DOWN for a retractable class with gear extended", () => {
    const text = collectText(
      ControlState({ snapshot: snap({ gear: "retractable", gearPosition: 1, trim: -0.4 }) }),
    ).join(" ");
    expect(text).toContain("GEAR DOWN");
    expect(text).toContain("TRIM NOSE DN 40%");
  });
  it("shows GEAR UP for a retractable class with gear retracted (the acceptance-flight bug fix)", () => {
    const text = collectText(
      ControlState({ snapshot: snap({ gear: "retractable", gearPosition: 0 }) }),
    ).join(" ");
    expect(text).toContain("GEAR UP");
  });
```

- [ ] **Step 8 — Run to pass.** `cd frontend && npm test`, `npx tsc --noEmit`, `npm run build`.
  Full suite green. Broken-arm sanity check: temporarily change the `gearOverspeed` line in
  `flightLoop.ts` to drop the `state.gearPosition > 0` clause and confirm the new
  `format.test.ts`/`ControlState.test.tsx` gear-up cases you added do NOT falsely trip (they would
  need `iasKt > vleIasMs` to matter, which these tests don't set up — so this is a design sanity
  check, not a required CI test; revert the change before committing). The two required broken-arm
  tests (Step 1) already prove `GEAR O'SPD` is distinct from `OVERSPEED`.

- [ ] **Step 9 — Log the decision.** Append to `docs/decisions.md`:

```
## 2026-08-07 — GR-004 · GEAR O'SPD annunciator wired

warningsFor pushes "GEAR O'SPD" (distinct from OVERSPEED/MMO) when the class is retractable,
gearPosition > 0, and IAS exceeds limits.vleIasMs — computed once in game/flightLoop.ts's
publish(), the same shape as the existing overspeed/machOverspeed lines (plain state.iasMs
comparison, no unit conversion — see the plan's Signature Decision #1 for why vleIasMs is m/s).
formatGear grows a fourth label state, GEAR IN TRANSIT, for 0 < gearPosition < 1; ControlState
threads gearPosition through so a retractable aircraft's readout tracks its real position
instead of reading GEAR DOWN unconditionally (the bug this whole feature exists to fix).
```

- [ ] **Step 10 — Commit.** `git add -A && git commit -m "feat(hud): GEAR O'SPD annunciator + four-state formatGear + ControlState gearPosition"`

---

## Task 6 — Spawn gear-up + end-to-end

`buildSpawnState` sets `gearDown`/`gearPosition` per GR-006 — the actual fix for the acceptance-
flight bug (a retractable jet no longer reads `GEAR DOWN` at cruise).

**Files:**
- Modify: `frontend/src/takeover/spawn.ts` (the `gearPositionAtSpawn` placeholder from Task 3, and
  the `controls`/`provisional` literals, lines ~163–197)
- Modify: `frontend/src/takeover/spawn.test.ts` (new `describe("buildSpawnState — gear (GR-006)",
  …)`)

**Interfaces:**
- Produces: `buildSpawnState` now returns `controls.gearDown` and `state.gearPosition` set
  honestly per class (`false`/`0` for retractable, `true`/`1` for fixed) instead of the Task
  1/3 placeholders (`false`/`0` unconditionally).
- Consumes: `ClassParams.gear` (already present).

Steps:

- [ ] **Step 1 — Failing broken-arm tests.** Append to `frontend/src/takeover/spawn.test.ts`:

```ts
describe("buildSpawnState — gear (GR-006)", () => {
  it("spawns a retractable class gear-up (fixes the acceptance-flight GEAR DOWN-at-cruise bug)", () => {
    const b738 = loadB738();
    const c: Contact = {
      hex: "abc", flight: "T", t: "A320", lat: 30, lon: -88,
      alt_geom: 35000, alt_baro: 35000, gs: 450, track: 90, baro_rate: 0,
      military: false, seen_pos: 2,
    };
    const { state, controls } = buildSpawnState(c, b738, { terrainHeightM: null });
    expect(controls.gearDown).toBe(false);
    expect(state.gearPosition).toBe(0);
  });
  it("spawns a fixed-gear class pinned gear-down", () => {
    const { state, controls } = buildSpawnState(ga(), P, { terrainHeightM: 20 });
    expect(controls.gearDown).toBe(true);
    expect(state.gearPosition).toBe(1);
  });
});
```

- [ ] **Step 2 — Run to fail.** `cd frontend && npm test -- src/takeover/spawn.test.ts`. Confirm
  RED: both assertions fail — `controls.gearDown` is always `false` and `state.gearPosition` is
  always `0` today (Task 1/3's placeholders), so the fixed-gear case fails.

- [ ] **Step 3 — Implement.** In `frontend/src/takeover/spawn.ts`, replace the Task 3 placeholder
  line:

```ts
  const gearPositionAtSpawn = 0; // placeholder — Task 6 sets this per GR-006 for every class
```

  with:

```ts
  // GR-006: retractable spawns gear-up (the honest airborne-cruise state — this is the fix for
  // the acceptance-flight bug where every jet read GEAR DOWN forever); fixed gear is pinned down.
  const gearPositionAtSpawn = params.gear === "retractable" ? 0 : 1;
```

  Update the `controls` literal (currently ending `…, afterburner: false };`):

```ts
  const controls: ControlVector = {
    pitch: 0, roll: 0, yaw: 0, throttle, flapDetent: 0, trim,
    gearDown: params.gear === "retractable" ? false : true,
    afterburner: false,
  };
```

  Update the `provisional` literal's Task 1 placeholder (`gearPosition: 0,`) to:

```ts
    gearPosition: gearPositionAtSpawn,
```

- [ ] **Step 4 — Run to pass.** `cd frontend && npm test -- src/takeover/spawn.test.ts`, then the
  whole suite `cd frontend && npm test`, `npx tsc --noEmit`, `npm run build`. All green — in
  particular `game/flightLoop.test.ts`, which builds every spawn through `buildSpawnState` and
  never a hand-built literal, needs no direct edit and must stay green unchanged.

- [ ] **Step 5 — Log the decision.** Append to `docs/decisions.md`:

```
## 2026-08-07 — GR-006 · spawn gear state (the acceptance-flight bug fix)

buildSpawnState now sets ControlVector.gearDown and SimState.gearPosition per class:
retractable spawns gear-up (gearDown: false, gearPosition: 0) — the honest state for an
airborne-cruise takeover — and fixed spawns gear-down/pinned (gearDown: true, gearPosition: 1).
This is the actual fix for the bug that motivated this whole feature: before GR-001..GR-005
existed, gear was a static "retractable" descriptor and formatGear read it as GEAR DOWN
unconditionally, so a 737 or F-5E taken over at FL350 showed GEAR DOWN for the whole flight.
Gated entirely on params.gear (data), not a class id — a fixed-gear class spawning "down" and a
retractable class spawning "up" is one branch-free expression, not two class-specific paths.
```

- [ ] **Step 6 — Commit.** `git add -A && git commit -m "feat(takeover): spawn gear per GR-006 (retractable gear-up, fixed pinned)"`

- [ ] **Stop and wait for owner sign-off.** Full feature wired end-to-end. Acceptance flight:
  take over a 737 or F-5E contact, confirm the control-state strip reads `GEAR UP` at spawn (not
  `GEAR DOWN`), press `KeyG`, watch it read `GEAR IN TRANSIT` for ~10 s then `GEAR DOWN`, confirm
  a perceptible speed/handling change with gear down, then accelerate past `vleIasMs` with gear
  extended and confirm `GEAR O'SPD` appears in the warnings list. Confirm the C172 is untouched:
  `GEAR FIXED` always, `KeyG` does nothing. After sign-off: whole-branch review, then ff-merge
  `airliner-fighter → main` and rebuild the public Docker stack (per the design spec's Rollout
  section).

---

## Self-review checklist (confirmed before handing off this plan)

- Every GR-00x decision and every spec Testing bullet is mapped to a task in the table above; no
  spec requirement was left unmapped.
- No placeholders: every step has real, file-specific code — no "similar to Task N", no "add
  validation here", no TBD values. The two intentional placeholders (`gearPositionAtSpawn = 0` in
  Task 3, `gearDown` local var in Task 1's `controls.ts` sweep) are each explicitly flagged as
  placeholders **with the task that resolves them**, not left dangling.
- Identifier names are identical everywhere they appear: `gearDown`, `gearPosition`,
  `gearDragCd0`, `vleIasMs`, `gearOverspeed`, `GEAR_TRANSITION_S`, `advanceGearPosition`.
- Two deliberate departures from the design spec's literal wording are called out and justified
  in "Signature decisions": `vleKt` → `vleIasMs` (unit/naming consistency, GR-004), and the
  transition integrator's home in `sim/aircraft.ts` rather than `game/flightLoop.ts` (state-
  ownership consistency, GR-002). Both are cross-referenced from the tasks that touch them and
  from the spec map table.
