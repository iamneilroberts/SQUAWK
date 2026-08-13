# Graphic control-state indicators (#48) — design

**Date:** 2026-08-13
**Issue:** #48 (canonical; supersedes the older #7). Related: #79 (cheat-sheet), #51 (speedbrake, already shipped).
**Branch/worktree:** `mongols-rich-hud` (IS live prod — fly.voygent.app). Commit/deploy discipline.
**Interactive mock (owner-approved idiom):** `https://claude.ai/code/artifact/432c000e-859a-44c6-8515-fbc6dc4393dc` — idiom **A (mini-instruments)** selected; the SVG geometry there is the visual source of truth.

## Goal

Replace/augment the text-only control-state readouts with small **graphic vector indicators** in LORAN's
mission-terminal language (1px strokes, amber `#ffb000` / cyan `#5fd7e0` only, no fills beyond the
established faint tints, monospace uppercase labels). Five controls:

| Control | Form (idiom A) | Text value? | Data source (snapshot) |
|---|---|---|---|
| Throttle | vertical lever on a slotted track, knob height = % | **yes** — `THR 78%` | `throttle: number` (0..1) |
| Flaps | wing chord + trailing edge drooping by detent fraction | **yes** — detent label `20` | *new* `flapDetentIndex` / `flapDetentCount` |
| Trim | vertical scale, fixed cyan **center gate**, needle offset; cyan on detent / amber off | **yes** — `3% NU` / `NEUTRAL` | `trim: number` (−1..1, + = nose up) |
| Gear | fuselage belly + strut + wheel; wheel-well dashed; transit = amber | **no** (icon-only) | `gear`, `gearPosition: number` (0..1) |
| Speedbrake | airfoil cross-section; boards flush (stowed) / raised amber (out) | **no** (icon-only) | `speedbrake?: boolean` |

Icon+value for the three quantitative controls; icon-only for the two categorical ones (owner decision).

## Scope — all three surfaces (owner chose "unify all")

1. **Desktop glass control strip** — `dashboard/ControlState.tsx` (today: THR/FLP/TRIM/GEAR text, **no speedbrake** — gap closed here).
2. **Desktop non-immersive HUD bottom** — `hud/Hud.tsx` `.hud-bottom` (today: THR/FLP/GEAR/SPDBRK text, no trim).
3. **Mobile immersive rails** — `hud/ImmersiveHudBar.tsx` (today: FLP/THR/BRK only). This surface **gains the currently-missing gear + trim.**

The mobile CSS throttle *lever* in `input/TouchControls.tsx` (`.touch-throttle`, a filled CSS gradient) is a
separate interactive control, **out of scope** — it stays as-is. This work is about read-only state indicators.

## Architecture

**One shared presentational component + one pure geometry module**, mirroring the existing
`dashboard/AttitudeIndicator.tsx` + `dashboard/gaugeMath.ts` idiom (props-in / SVG-out, hook-free,
testable without jsdom).

- `frontend/src/hud/controls/ControlIconMath.ts` (pure): geometry helpers — one exported function per glyph
  returning plain numbers/points (lever knob Y, flap droop endpoint, trim needle Y + neutral flag, gear wheel
  Y, speedbrake board points). No React, no SVG strings. Unit-tested like `gaugeMath.test.ts`.
- `frontend/src/hud/controls/ControlIcon.tsx` (presentational): `<ControlIcon kind="throttle|flaps|trim|gear|speedbrake" ... size=... />` → inline SVG using the math module. Stroke classes reuse the existing `.gauge-*` / new `.control-icon-*` CSS tokens (cyan default, amber accent). No state, no data fetching.
- `frontend/src/hud/controls/ControlStrip.tsx` (composition, optional): lays out the row of cells
  (icon + label + optional value) so all three surfaces share one layout and only pass a `variant`
  (`"glass" | "hud-bottom" | "mobile"`) for sizing. If a shared strip proves awkward across the three
  differing containers, each surface may compose `ControlIcon` cells directly — decided during implementation;
  the component + math split is the load-bearing seam, the strip is convenience.

### Snapshot change (the only data addition)

`frontend/src/hud/snapshot.ts` — add two fields to `HudSnapshot`:

```ts
flapDetentIndex: number;   // current detent index, 0 = clean
flapDetentCount: number;   // total detents for this class (>= 1)
```

Sourced where the snapshot is built (`game/flightLoop.ts` / wherever `flapLabel` is currently resolved) from
the live `ControlVector.flapDetent` index and `ClassParams.flaps.length`. Everything else the icons need is
already on the snapshot: `throttle`, `trim`, `gear`, `gearPosition`, `speedbrake`. **No new plumbing to
`ClassParams` in the render tree** — the two ints on the snapshot mean desktop and mobile both get flap
position without threading params into `ControlState`.

`format.ts` keeps producing the value strings (`formatThrottlePct`, `formatFlaps`, `formatTrim`); a small
`formatSpeedbrake` may be added to replace the three hand-written inline `SPD BRK`/`OUT` sites (tidy, optional).

## Data-not-branches (per class)

No `class === …` branches anywhere. Behavior is driven by params already on the snapshot:

- **Gear:** `gear === "fixed"` → render the FIXED glyph (static strut+wheel, cyan, no value). Retractable →
  animate by `gearPosition`; `gearPosition` strictly between 0 and 1 (or an explicit in-transit flag if one
  exists) → amber. C172 = fixed; jets = retractable. Same code path.
- **Speedbrake:** the cell is **only rendered when the class has a speedbrake.** Detected from
  `speedbrakeCd0 > 0` (the field #51 added to every params JSON). C172 (`speedbrakeCd0 = 0`) → no boards cell
  at all, on every surface. Requires surfacing a `hasSpeedbrake: boolean` on the snapshot (cheap; the value is
  already known where `speedbrake` is set) **or** reusing the existing `hasSpeedbrake` prop already threaded to
  `TouchControls` (`FlightSession.tsx` passes it). Prefer the snapshot boolean so all three surfaces read it
  uniformly.

## Two tuning knobs (flagged, settled on-device during implementation)

1. **Trim needle full-scale.** What `|trim|` value drives the needle to its end-stop. The mock used ±0.30
   (so 3% sits just off the gate and full authority pegs). Real feel may want a different mapping or a mild
   non-linearity. Default: a single `TRIM_FULL_SCALE` constant in `ControlIconMath.ts` (start 0.30), tuned
   against live trim ranges. Not a correctness question — a legibility knob.
2. **Mobile cell width / whether all five fit one row.** Idiom A is the widest idiom. On the narrowest phones
   the five-cell row may need slightly smaller glyphs or a tighter gap. Settled by eye on-device; the layout
   uses flex `1 1 0` cells so it degrades gracefully.

## Visual spec (from the approved mock)

- Glyph draw box ≈ 40×38 SVG units, scaled per surface (~40px desktop, ~34–38px mobile).
- Strokes: `stroke-width` ~1.4, round caps/joins, `fill:none`. Default **cyan**; **amber** for warning/active
  (throttle > ~0.92, trim off-neutral needle, gear in transit, speedbrake out). Track/detent marks in the
  existing dim grid tint — reuse the current `.gauge-tick`/`.gauge-race` stroke color (`var(--grid)`), do not
  invent a new token.
- Trim: fixed cyan center **gate** (two horizontal ticks bracketing zero) stays put; dim end-stop ticks;
  triangle needle registers against the gate — cyan on detent, amber off.
- Labels: existing uppercase letterspaced style (`THR / FLP / TRM / GEAR / SPD BRK`). Value text in cyan
  (dim when NEUTRAL / stowed), amber when the state is a warning.

## Testing

- `ControlIconMath.test.ts` — envelope-style unit tests per helper: knob Y monotonic in throttle; flap droop
  endpoint at index 0 vs max; trim needle Y sign + neutral-flag threshold; gear wheel Y at
  `gearPosition` 0/0.5/1; speedbrake board points stowed vs out. Pure numbers, no DOM.
- `ControlIcon` render smoke test (renders each kind without throwing; asserts amber class appears on the
  warning states) — jsdom, lightweight.
- Snapshot: assert `flapDetentIndex`/`flapDetentCount` populate correctly for a fixed-flap and a
  multi-detent class.
- Existing gate unchanged: `cd frontend && npm run typecheck && npm run test:unit && npm run lint`
  (lint ≤ 8 warns; add none). Suite currently 1286 green.

## Out of scope

- The interactive mobile throttle lever (`.touch-throttle`) — separate control, unchanged.
- Idioms B/C from the mock (rejected).
- The #79 cheat-sheet prettify (separate issue; this work absorbs the text SPD BRK/GEAR/FLP indicators #51
  added, which is expected).
- Any change to control *bindings* or physics.

## Decisions log entry

Append to `docs/decisions.md`: "2026-08-13 — #48 control-state indicators: idiom A (mini-instruments), shared
`ControlIcon` + pure `ControlIconMath`, one snapshot addition (`flapDetentIndex`/`flapDetentCount`),
data-not-branches per class (gear FIXED vs animated, speedbrake cell gated on `speedbrakeCd0 > 0`).
Icon+value for throttle/trim/flaps, icon-only for gear/speedbrake."
