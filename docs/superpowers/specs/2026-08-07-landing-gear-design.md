# Retractable Landing Gear (dynamic gear control) — Design Spec

**Date:** 2026-08-07
**Status:** approved (design), spec for implementation
**Feature branch:** `airliner-fighter` (this feature lands on the same branch as the
airliner/fighter classes — it is the fix for the acceptance-flight gear bug and only
matters for the retractable-gear jets those classes introduced).
**Depends on:** the airliner/fighter classes feature
(`docs/superpowers/specs/2026-08-07-airliner-fighter-classes-design.md`) — the `gear`
capability field, the `b738`/`f5e` data files, the `warningsFor` annunciator pattern,
and the `ControlState` readout all exist because of it.

## Problem

`gear` is currently a **static class descriptor** (`"fixed" | "retractable"`) with no
dynamic state. `formatGear` maps `"retractable"` → `"GEAR DOWN"` unconditionally, so
every jet reads **GEAR DOWN forever** — including at FL350 cruise, which the acceptance
flight caught. `KeyG` is inert. There is no gear position, no gear drag, no gear
extension speed limit.

## Goal

Model a **real, dynamic retractable landing gear**: a `KeyG`-actuated gear that travels
up/down over a realistic transition, adds drag when extended, and warns if extended
above the gear-limit speed — all as **data, not per-class code branches**, consistent
with the one-force-model discipline. Fixed-gear aircraft (C172) are unaffected: gear
stays down, `KeyG` inert, readout `GEAR FIXED`.

## Ground rules carried from the project (binding)

- **One force model, data not branches** (CLAUDE.md "Flight model"): no `if (class === …)`.
  Gear behaviour is selected by the `gear` capability field and per-class data, never by
  class id. Reading `params.gear` / `params.gearDragCd0` is data-driven, not a branch.
- **Sim state unmistakable / honest data:** unchanged. Gear is part of the player's SIM
  aircraft (the only synthesized object) — no feed data involved.
- **No new dependencies** (spec §14 of the founding design). Gauges/annunciators are the
  existing hand-rolled SVG/text.
- **Validator has no silent defaults:** the new required params fields throw at load time
  if absent/malformed, matching the existing hand-written validator in `sim/params.ts`.
- **Structural/damage limits stay deferred to Phase E:** `GEAR O'SPD` is an **annunciator
  only** — no damage, no forced retraction, no override.
- **Decisions log:** append `docs/decisions.md` entries `GR-001 … GR-00n` for each
  non-obvious call.

## Decisions

- **GR-001 — Gear is a persisted commanded boolean + an integrated position.**
  `ControlVector.gearDown: boolean` is the commanded target (edge-toggled by `KeyG`,
  persisted in the input sampler exactly like `flapDetent`/`afterburner`).
  `SimState.gearPosition: number` (0 = up, 1 = down) is integrated toward the target in
  the flight loop. The two-field split keeps the pure sim testable: the command is an
  input, the position is state.
- **GR-002 — Timed transition via a shared constant.** `GEAR_TRANSITION_S = 10`
  (seconds) in `sim/forces.ts` (a documented `TUNING KNOB`, same pattern as
  `TURBOFAN_CORNER_M`). Each tick, `gearPosition` eases toward `gearDown ? 1 : 0` by
  `dt / GEAR_TRANSITION_S`, clamped to `[0, 1]`. Shared, not per-class, to avoid adding a
  required field to every data file; revisit as per-class data if a class needs a
  distinct time.
- **GR-003 — Gear drag ramps with position.** New required per-class field
  `gearDragCd0: number` (a parasitic-drag CD0 increment), living alongside the existing
  `cd0` aero term. Effective
  parasitic drag is `cd0 + gearDragCd0 * gearPosition`. The C172 ships `gearDragCd0: 0`
  (its fixed-gear drag is already in its sourced `cd0` — no double-count, no regression).
  Jet values are sourced or `TUNING KNOB` + envelope target.
- **GR-004 — `GEAR O'SPD` annunciator.** New required per-class field `vleKt: number`
  (max gear-extended speed). `warningsFor` pushes `"GEAR O'SPD"` (distinct from
  `OVERSPEED`/`MMO`) when the aircraft is **retractable** AND `gearPosition > 0` AND
  IAS (knots) > `vleKt`. Fixed-gear aircraft never raise it. C172 `vleKt` is set
  unreachable for safety even though the retractable gate already excludes it.
- **GR-005 — Fixed gear is pinned.** For `gear === "fixed"`, `gearPosition` is forced to
  1, `KeyG` is inert (no toggle), and the readout is `GEAR FIXED`. No transition, no
  `GEAR O'SPD`.
- **GR-006 — Spawn state.** Retractable aircraft spawn **gear up** (`gearDown: false`,
  `gearPosition: 0`) — the honest airborne-cruise state (fixes the bug). Fixed aircraft
  spawn `gearPosition: 1`.

## Architecture — the seams (all existing shared modules)

| Module | Change |
|---|---|
| `sim/types.ts` | `ControlVector.gearDown: boolean` (required); `SimState.gearPosition: number`; `ClassParams` gains `gearDragCd0: number` and `vleKt: number`. |
| `sim/params.ts` | validator requires `gearDragCd0` + `vleKt` (no silent default); the three data files gain the fields with `sources`. |
| `sim/forces.ts` | `GEAR_TRANSITION_S` constant; parasitic drag uses `cd0 + gearDragCd0 * gearPosition`. |
| `game/flightLoop.ts` | integrate `gearPosition` toward `gearDown ? 1 : 0` (pinned to 1 for fixed gear); thread `gearPosition` + `gearOverspeed` into the snapshot. |
| `hud/snapshot.ts` | `HudSnapshot` gains `gearPosition: number` + `gearOverspeed: boolean`; keep the existing `gear` capability field. `formatGear` derives the label from `gear` + `gearPosition`. |
| `hud/format.ts` | `formatGear`: fixed → `GEAR FIXED`; retractable → `GEAR UP` (0) / `GEAR DOWN` (1) / `GEAR IN TRANSIT` (between). `warningsFor` pushes `GEAR O'SPD`. |
| `input/controls.ts` + `input/keyboard.ts` | `KeyG` edge-triggered toggle of `gearDown`, guarded (inert for fixed gear); `GAME_KEY_CODES` + `KEYMAP` + `ControlsHelp` label updated from "gear (fixed on this aircraft)" to the real toggle. |
| `takeover/spawn.ts` | set `gearDown`/`gearPosition` per GR-006. |
| `dashboard/ControlState.tsx` | render the dynamic gear state (already calls `formatGear`). |
| `params/{c172,b738,f5e}.json` | `gearDragCd0`, `vleKt` (+ `sources`). |

## Data (per class)

| Field | C172 | 737-800 | F-5E |
|---|---|---|---|
| `gear` | `fixed` | `retractable` | `retractable` |
| `gearDragCd0` | `0` (drag already in `cd0`) | sourced/`TUNING KNOB` (~0.015–0.02) | sourced/`TUNING KNOB` |
| `vleKt` | unreachable (e.g. `= vne`) | ~270 kt (real 737 Vle/Vlo, sourced) | ~240 kt (F-5 gear limit, sourced) |

All numbers follow the existing provenance rule: a book value or `TUNING KNOB` + the
envelope-test target it was tuned against.

## Testing (vitest, node env — no jsdom/Cesium)

- **Transition integrator:** from `gearPosition = 0`, commanding `gearDown = true` reaches
  ~1 in ~`GEAR_TRANSITION_S` (and vice versa); clamped to `[0,1]`; fixed gear stays at 1
  regardless of command.
- **Drag ramp:** parasitic drag at `gearPosition = 1` exceeds `gearPosition = 0` by
  `gearDragCd0`'s contribution; C172 (`gearDragCd0 = 0`) is unchanged — **broken-arm:**
  a retractable envelope test shows measurably more drag / lower max level speed with gear
  down than up.
- **`GEAR O'SPD`:** trips when retractable + extended + IAS > `vleKt`; does NOT trip for
  fixed gear, nor for a retractable aircraft with gear up, nor below `vleKt`. **Broken-arm:**
  fails if the gate ignores `vleKt` or `gearPosition`.
- **Spawn:** retractable spawns gear up (`gearPosition = 0`, readout `GEAR UP`); fixed
  spawns `gearPosition = 1` (`GEAR FIXED`).
- **`KeyG`:** edge-triggered — one press flips the command once (not every held frame);
  inert for fixed gear.
- **`formatGear`:** all four label states.
- **No regression:** C172 envelope suite + existing gauge/format tests stay green.

## Non-goals (this feature)

- No gear damage / structural failure (Phase E).
- No forced auto-retract, no gear-warning horn (audio is a v1 non-goal).
- No per-class transition time (shared constant; revisit if needed).
- No ground ops — airborne spawn only stays the model; gear is cosmetic-plus-drag while
  airborne.

## Rollout

Built on `airliner-fighter` via subagent-driven-development (TDD per task), each task
gated on `npm test` + `tsc --noEmit` + `npm run build`. After the gear tasks: whole-branch
review, owner acceptance flight (take a jet, `KeyG` to raise/lower, watch `GEAR IN
TRANSIT` → `GEAR UP`, confirm drag change and `GEAR O'SPD` above `vleKt`), then ff-merge
`airliner-fighter → main` + rebuild the public Docker stack.
