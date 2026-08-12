# Approach Guidance: Glide-Slope Surface + PAPI Lights — Design

**Date:** 2026-08-12 · **Issues:** #24 (surface), #23 (PAPI) · **Deferred:** #22 (ghost-plane director)
**Owner decisions captured 2026-08-11/12 (brainstorm complete, approved).**

## 1. What and why

Landing guidance today is line-work: two corridor edge polylines, cross-gates, and a flare
marker (`ApproachAssistLayer`). The owner wants guidance you can *fly on*, plus the real-world
glide-slope cue pilots actually use:

1. **Approach surface (#24)** — a translucent surface lying ON the glide slope, wide at the far
   end and tapering to the runway width at the threshold, so the player flies on/along it into
   the pavement. It **replaces** the corridor edge lines. The existing glide gates remain,
   drawn across the surface as depth cues. The flare cue is unchanged.
2. **PAPI (#23)** — four lights beside the threshold with real 4-box logic: each light flips
   white/red at its own angle (2.5° / 2.8° / 3.2° / 3.5° around the mission's 3° slope).
   2W2R = on slope; more white = high; more red = low. Teaches the real-world cue.

## 2. Visibility / assist gating

| Cue | OFF | NAV | FULL |
|---|---|---|---|
| Approach surface (+gates, flare) | — | — | ✓ (existing `assistFeatures.approachCorridor` / `glideGates` / `flareCue`) |
| PAPI | ✓ | ✓ | ✓ |

PAPI is **world furniture, not an assist** — it renders at every assist level, exactly like a
real airport, so skilled players keep a realistic glide cue after turning assists off.
`assistFeatures` is unchanged; the PAPI layer mounts outside the assist gate.

## 3. Geometry (pure, no Cesium — unit-tested)

All in `frontend/src/mission/` per the existing pattern (`guidanceGeometry.ts` is already pure).

### 3.1 `approachSurface()` (extend `guidanceGeometry.ts`)

`approachSurface(assignment, guidance): GuidanceSegment[]` — cross-sections sampled every
`gateSpacingNm` from the threshold out to `approachLengthNm` (reusing the existing
`crossSection(d)` math and glide-slope altitude formula), with one change: **linear width
taper** from `guidance.corridorWidthFt` at the far end down to the assigned runway's width at
the threshold. Missing runway width in the dataset → fall back to the constant corridor width
(never fabricate a value). Cross-section altitudes follow the existing
`elevationFt + tan(glideSlopeDeg) · distance` formula, so the surface is exactly the slope the
gates already mark.

### 3.2 `mission/papi.ts` (new)

- `papiPosition(assignment): GuidancePoint` — abeam the assigned threshold on the left side,
  offset half the runway width + 50 ft laterally, at runway elevation.
- `papiColors(aircraft: {latDeg,lonDeg,altitudeFt}, papi: GuidancePoint, glideSlopeDeg): boolean[4]`
  — the aircraft's elevation angle from the PAPI position
  (`atan2(altFt − papiAltFt, horizontalDistanceFt)`), compared against the four thresholds
  `glideSlopeDeg + (−0.5, −0.2, +0.2, +0.5)°`; each light is white when the aircraft is above
  its threshold. On-slope = `[true, true, false, false]` (2W2R). Pure, table-driven tests.

## 4. Rendering (Cesium, entity API — matches the existing layer style)

### 4.1 Surface — in `ApproachAssistLayer.tsx` (modified)

- **Remove** the two corridor edge polylines.
- **Add** one translucent polygon per segment between consecutive cross-sections
  (`perPositionHeight`, 4 corners each, ~`approachLengthNm / gateSpacingNm` ≈ 10 entities).
  Chosen over a custom Primitive triangle strip (more plumbing than ~10 quads justify) and over
  a single 4-corner polygon (gates would float off it; corners stretch over 5 nm).
- Gates + flare render exactly as today, on top of the surface (same cross-section geometry, so
  they lie on it by construction).
- Gating unchanged: mounts only when `assistFeatures(assist).approachCorridor`.

### 4.2 PAPI — `frontend/src/globe/PapiLayer.tsx` (new)

- Four `PointGraphics` entities at `papiPosition` spread laterally ~25 ft apart, colors via
  `CallbackProperty` reading the live `hudSnapshot` and calling `papiColors` — no per-frame
  entity churn, standard Cesium idiom.
- `scaleByDistance` so the boxes read from miles out without ballooning up close (~8 px).
- Mounted in `FlightSession` alongside `MissionRouteLayer` but **outside** the
  `assist`-gated block: any locked mission, any assist level, `mode !== "ENDED"`.

## 5. Look (terminal language, spec §visual direction)

- Surface: cyan fill, alpha ≈ 0.15, no glow, no gradient. Gate lines stay at 0.6 alpha above it.
- PAPI: white `#ffffff` / red `#ff3b30` points with a 1px darker outline for contrast against
  bright terrain; no bloom.
- Nothing new on the HUD; the surface and lights are world-space only.

## 6. Honest-data rules

- The surface and PAPI derive only from the locked mission's frozen assignment + guidance
  profile (CF-009/CF-010) — no live-feed dependence, so they can never be stale or fabricated.
- Missing runway width → constant-width fallback (a real value from the profile), never a guess.
- No PAPI at airports without an assigned mission runway (we only ever place the assigned end's).

## 7. Testing

- **Geometry:** taper width at threshold/mid/far (runway width, midpoint interpolation,
  corridor width); slope altitude continuity between surface samples and existing gates;
  `papiColors` table at slope −0.6°, −0.3°, −0.1°, +0.1° (on-slope), +0.3°, +0.6° → all five
  4-light states; negative-elevation runway (legitimate); missing-runway-width fallback.
- **Components:** hook-free render-tree tests per repo convention (entity descriptions /
  feature gating), no Cesium in tests.
- **Broken-arm:** assist OFF → no surface entities, PAPI present; no locked mission → neither.

## 8. Non-goals (this build)

Ghost-plane flight director (#22) · approach lighting systems beyond PAPI (ALSF/REIL) ·
PAPI at non-mission airports · wind/offset corrections · any HUD changes.

## 9. Acceptance

1. FULL assist, on final: a tapering translucent surface leads to the pavement; the old edge
   lines are gone; gates ride on the surface; flare cue unchanged.
2. Any assist level (incl. OFF): four PAPI boxes visible beside the assigned threshold from
   ≥5 nm; 2W2R when on the 3° slope; correct white/red progression above/below per §3.2.
3. All new geometry/logic pure-tested; suite green; no new dependencies; desktop unaffected
   except the same corridor-line → surface swap.

**Estimate:** ~1 day (geometry + tests ~2h · layers ~3h · live look-tuning ~1h · gates/review).
