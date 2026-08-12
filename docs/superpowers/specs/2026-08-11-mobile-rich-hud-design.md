# Mobile Rich HUD — Design Spec

**Date:** 2026-08-11
**Branch:** `adsb-ui-cleanup`
**Decisions referenced:** UI-001 (richer look allowed on flight surfaces), UI-002 (declutter set-once identity)
**Build spec / visual reference:** `<coord>/handoffs/assets/mock-adsb-hud-rich.html`
(staging: `https://staging.voygent.ai/mocks/adsb-hud-rich-scenery.html`)

## Goal

Port the rich mock to the real mobile HUD: glossy attitude ball, functional scrolling
IAS/ALT tapes bound to real `HudSnapshot`, rounded/translucent panels, amber SIM pill.
Add per-class tape ranges, the UI-002 identity declutter, throttle-state clarity, and
render the compact rail on **every** narrow flight (not only immersive mode).

The real app renders over Cesium terrain — the mock's fake satellite ground is not ported.
Tapes bind to real sim state; they never re-simulate as the mock does.

## Scope (this pass)

Core rich HUD + UI-002 declutter + verify/commit, **plus** touch-throttle state clarity and
the always-narrow rail.

**Explicitly NOT in this pass:** browser glass-cockpit adaptation (`dashboard/UnifiedGlass`,
`DashboardStrip`) — a separate later pass; high-contrast audit; onboarding declutter;
the 4 MB mock-binary decision; the funnel/public-game track.

## Components & changes

### 1. Functional tapes — `hud/ImmersiveHudBar.tsx`

The mock's tape is a prebuilt tick strip translated vertically so the current value sits at a
fixed center pointer, with an amber reference line. The mock reads `window.clientHeight` at
runtime; the real component is deliberately **hook-free** (file comment, line 6) so its layout
stays a cheap plain-React unit test. Replace runtime measurement with a **fixed-height window
constant** so the transform is a pure function of props.

New pieces (all pure / hook-free):

- `type TapeRange = { min: number; max: number; step: number; major: number; pxPerUnit: number }`
- `tapeTicks(range): { value: number; major: boolean; y: number }[]` — tick list, `y` in px from the strip bottom.
- `tapeStripOffset(value: number, range: TapeRange, windowPx: number): number` — the `translateY` px:
  `(value − min) × pxPerUnit − windowPx / 2`, clamped so the strip never scrolls past its ends.
- `Tape({ side, label, unit, value, range })` component — renders `.imm-tape` › `.tape-window`
  (fixed height `TAPE_WINDOW_PX`) › `.tape-strip` (ticks, `transform` from `tapeStripOffset`) ›
  `.tape-ptr` (`.imm-field-value` = `Math.round(value)`). Amber reference line via `.tape-window::after`.

`TapeRail` uses two `Tape`s (IAS left, ALT right) around the existing director column, binding
`value` to `snapshot.iasMs`→kt and `snapshot.altitudeM`→ft via `format.ts`.

### 2. Per-class tape ranges — `hud/ImmersiveHudBar.tsx` + `game/FlightSession.tsx`

New pure helper `tapeRangesFor(params): { ias: TapeRange; alt: TapeRange }`:

- **IAS:** `min = params.display.asiMinKt`, `max = params.display.asiMaxKt` (per-class instrument
  face, spec §6 — no jet flies the C172 gauge). `step`/`major`/`pxPerUnit` derived from the span.
- **ALT:** `min = 0`, `max` = `serviceCeilingM` converted to ft and rounded up to a clean
  boundary. `step`/`major`/`pxPerUnit` scaled to the span (fine for GA, coarse for airliner/jet).

`FlightSession` derives it once from `originParams` and passes `tapeRange` into `Hud` →
`ImmersiveHudBar` along the same path `attitudeStyle` already travels. When `originParams` is
null (defensive), tapes fall back to a hidden/em-dash state — never fabricated numbers.

### 3. Rich styling — `styles/tokens.css`

Add the rich treatment scoped under `.imm-hud` (flight surface only, UI-001):

- Rounded panels (9–12px), translucent gradient backgrounds + `backdrop-filter: blur`, soft inset
  + drop shadow (mock lines 118–141).
- Glossy SVG attitude ball: radial `skyG` / `gndG` / `gloss` gradients, clipped to a circle, amber
  aircraft reference, cyan bezel (mock lines 367–383). The flat/line ADI path is retained for the
  `line` attitude style; the glossy ball is the `ball` style.
- Amber `.imm-sim-pill` (rounded, amber gradient).

Both variant A (balanced) and C (tapes) receive the rich look. **C stays primary**; the HUD A/C
toggle is kept. Desktop `dashboard/AttitudeIndicator`, `DashboardStrip`, and non-`.imm-*` tokens
are not touched — the richer look does not leak to the desktop glass cockpit in this pass.

### 4. UI-002 declutter — `hud/ImmersiveHudBar.tsx` + `panels/HandoffCard.tsx` + debrief

- `SimIdentity` in the bar: keep the `SIM` badge; **remove** the live callsign (`SIM-<hex>`) and
  class (`C172`) from the rail.
- Surface callsign + class on the **spawn card** (`panels/HandoffCard.tsx`) and the **debrief**
  (`panels/EndCard.tsx` / `debrief/`) as set-once identity, if not already present there.

### 5. Always-narrow rail — `hud/Hud.tsx` + `game/FlightSession.tsx`

`Hud` renders the immersive bar when `immersive || narrow` (new `narrow` prop threaded from
`FlightSession`), so a phone that has not tapped FULL gets the compact rail rather than the
desktop scattered-corner readout cluster. The `faded` auto-hide and fullscreen behavior stay
gated to `immersiveActive` only — a non-immersive narrow flight shows the bar but does not fade.

### 6. Throttle-state clarity — `input/TouchControls.tsx`

Make the touch throttle unmistakable at 0% / mid / 100%: amber fill height tracking throttle, a
visible numeric `%`, and distinct end-stop markers so the lever position reads at a glance.

## Data flow

`originParams` (aircraft profile) → `tapeRangesFor()` → `tapeRange` prop → `Hud` →
`ImmersiveHudBar` → `Tape`. Live values come only from `HudSnapshot` (`iasMs`, `altitudeM`,
`throttle`, attitude fields); no re-simulation, no fabricated data. Unknown/absent values render
as em-dash per the honesty ground rules.

## Testing (TDD, ~1,150-test surface)

Pure functions first (fast, deterministic):

- `tapeStripOffset` — center alignment, clamping at min/max, monotonic in value.
- `tapeTicks` — count, major/minor flags, `y` monotonic.
- `tapeRangesFor` — C172 / B738 / F-5E fixtures produce sane, class-appropriate min/max.

Component tests:

- `Tape` renders the rounded pointer value and applies the expected strip transform.
- `SimIdentity` no longer renders callsign/class; `SIM` badge remains.
- Spawn card + debrief show callsign + class.
- `Hud` renders the immersive bar when `narrow` and not `immersive`; does not fade in that case.
- Throttle control shows distinct 0% / mid / 100% state.

Gate every step: `npm run test:unit`, `npm run typecheck:app`, `npm run build`, `npm run lint`.
Verify running against real Cesium terrain; keep the touch stick, throttle, and button row
uncovered by the rail.

## Risks

- Rich `.imm-*` CSS could collide with existing `tokens.css` rules or the shared
  `AttitudeIndicator` geometry — scope strictly under `.imm-hud` and re-verify the desktop path
  is visually unchanged.
- Fixed-height tape window (vs the mock's runtime measurement) must match the CSS `min-height`
  used for `.tape-window`; keep the constant and the CSS in sync (single source: the CSS value).
- Mobile/desktop HUDs share almost no code, so this richer mobile look leaves the desktop glass
  cockpit inconsistent until the separate second pass — expected and accepted for this pass.
