# Spawn chooser (reposition + unranked) — design

_Date: 2026-08-14 · Status: draft for owner review · Feature 1 of 2 (chooser, then curved ribbon)_

## Problem

Taking control drops you at the live aircraft's position/heading, which can mean a long or
awkward entry to the approach. #90 added a default-on "point at the FAF" heading nudge. The owner
wants a **choice** at takeover: fly it authentically, get lined up with one turn, or start on
final — trading realism for getting to the fun part. Repositioning (B/C) must not count as a
ranked result.

This supersedes #90's binary `HEADING → APPROACH` checkbox and implements the core of #87
(skip-to-landing-approach) as the "on final" option.

## Owner decisions (locked)

- The chooser **repositions** the SIM aircraft (teleport), not heading-only.
- Repositioned flights (B and C) are **unranked**.
- "One turn" places you on a **45° base-leg entry to the FAF** (tunable).
- Curved corridor ribbon + menu toggle is **Feature 2** (separate spec), not here.

## Ground rules honored

- Only the player's SIM aircraft is repositioned; the genuine aircraft's ghost stays on the live
  feed at its real position/heading. SIM banner + synthetic callsign unchanged. No feed data
  synthesized (ground rule #1).
- Every reposition is **disclosed** on the handoff card ADJUSTMENTS list (position/altitude/speed/
  heading changes), same honesty rule the spawn builder already applies.
- `mission/` and `takeover/spawn.ts` stay Cesium-free, pure, unit-testable.
- No new dependencies.

## The three options

Presented as a 3-way control on the TAKE CONTROLS card (replaces #90's checkbox). Persisted
preference (localStorage), default **A**.

- **A — Real position** _(ranked, default)_: spawn at the live position, **heading rotated toward
  the FAF** (this is #90's shipped, ranked behavior — kept as the helpful ranked default). Position/
  altitude/speed untouched.
- **B — One turn** _(unranked)_: repositioned onto a **45° base-leg entry ~`baseLegOffsetNm` out**,
  pointed at the FAF, on-slope altitude, approach speed — a single turn rolls you onto final.
- **C — On final** _(unranked)_: repositioned onto the extended centerline **at the FAF**, on-slope
  altitude, approach speed, **gear down + landing flaps**, runway heading.

> **Open sub-decision (flagged):** Option A keeps #90's "heading toward FAF" so the default stays
> helpful AND ranked. This drops the pre-#90 "pure real heading" spawn (pointing exactly where the
> live aircraft points). If you want pure-real-heading kept, say so and it becomes A (with
> face-FAF folded into B) or a 4th option.

## Part 1 — Spawn override seam

**File:** `takeover/spawn.ts` (+ test)

Extend `buildSpawnState` / `buildLockedMissionSpawn` opts (mirroring #90's `spawnHeadingDeg?`),
each `??`-defaulted to the live-derived value and **disclosed** via an `adjustments[]` entry when
applied:
- `spawnPositionOverride?: { latDeg: number; lonDeg: number }` (default = `contact.lat/lon`)
- `spawnAltitudeFtOverride?: number` (default = derived `altitudeM`)
- `spawnSpeedKtOverride?: number` (default = `contact.gs`)
- `spawnVerticalRateFpmOverride?: number` (default = `contact.baro_rate`)
- reuse existing `initialFlapDetent?` / `initialGearDown?` for the on-final config.

Position/altitude feed `geodeticToEcef`; speed feeds `tasMs`; vertical rate feeds `fpaRad` — all
already the single sources at `spawn.ts:159-200`. Each override pushes a `POSITION` / `ALTITUDE` /
`SPEED` adjustment `{field, from, to, reason}` exactly like the existing `HEADING` block.

## Part 2 — Reposition geometry

**File:** `mission/spawnPlacement.ts` (new, pure) + `mission/types.ts` + profiles

- New `guidance` knobs: `baseLegOffsetNm` (default ~3), `baseLegOffsetDeg` (default 45), validated
  in `profiles.ts`.
- `onFinalPlacement(assignment, guidance)` → `{ latDeg, lonDeg, altitudeFt, headingDeg, speedKt }`
  from `finalApproachFix(assignment, guidance)` (point + heading + on-slope alt) + `approach.targetSpeedKt`.
- `baseLegPlacement(assignment, guidance)` → same shape: from the FAF, `destinationPoint(faf, faf.headingDeg+180±baseLegOffsetDeg, baseLegOffsetNm)` for the entry lat/lon, heading = `initialBearingDeg(entry → faf.point)`, altitude via `glideSlopeAltitudeFt` at the entry's along-track distance, speed = approach speed.
- Pure TS, unit-tested (point on the correct side/offset; heading points at the FAF; altitude on-slope).

## Part 3 — Unranked flagging (client-side, no backend)

**File:** `state/store.ts`, `game/FlightSession.tsx`

- Add a store flag `repositioned: boolean` set true when spawn mode is B or C.
- In `FlightSession.tsx` `onEnd` (`:475-525`), add `repositioned` to the same short-circuit chain
  as `freeFlight`/`instantFlight`: give a local debrief (`status` carrying a
  `"REPOSITIONED — LOCAL AND UNRANKED. NO RESULT SUBMITTED."` disclosure) and **never call
  `submitMissionResult`**. No `LockedMissionDocument` / worker / signing changes.
- `EndCard` shows the unranked disclosure for the repositioned status (mirrors instant/tutorial).

## Part 4 — Chooser UI + preference

**Files:** `takeover/spawnModePreference.ts` (replaces `headingToFafPreference.ts`),
`game/FlightSession.tsx`, `panels/HandoffCard.tsx`

- Preference module (extend #90's): `SpawnMode = "real" | "base" | "final"`, key
  `adsb.spawn-mode.v1`, default `"real"`, same `Pick<Storage,…>` + try/catch shape. (Migrate the
  old `adsb.handoff-heading-to-faf.v1` → treat missing as `"real"`.)
- `FlightSession.tsx`: replace `faceApproach` boolean state + ref with `spawnMode` state + ref;
  both spawn-build sites (`:382-400` initial, `:602-625` toggle-reaction) branch on mode to build
  the override opts (A → `spawnHeadingDeg` only; B → `baseLegPlacement`; C → `onFinalPlacement` +
  gear/flaps). Set the store `repositioned` flag for B/C. Keep the decoupled-effect + ref pattern
  so changing the choice rebuilds only the spawn (no countdown restart).
- `HandoffCard.tsx`: replace the checkbox with a 3-option selector (`real`/`base`/`final`),
  terminal style. Show an **UNRANKED** note when `base`/`final` is selected. Hidden in free flight.

## Relationship to #87

Option C **is** #87's skip-to-landing-approach (reposition onto a stabilized final). This ships that
core with the ranked question answered (repositioned → unranked, client-side). #87's remaining scope
(time compression, and any richer skip variants) stays open. Will update the #87 note on merge.

## Testing

- **Pure TS units:** `spawn.ts` overrides (each moves the state field + adds its disclosure; omitted
  = unchanged). `spawnPlacement.ts` (on-final at FAF on-slope; base-leg offset side/angle + heading
  at FAF). Profile validation for the new knobs.
- **UI (build + run):** the 3-way chooser rebuilds the spawn live (no countdown restart), the card
  shows the UNRANKED note for B/C and the reposition adjustments; a B/C flight ends with a local
  unranked debrief and submits nothing; A still submits/ranks normally. Owner live-verifies on prod.

## Files touched

- `takeover/spawn.ts` (+ test) — position/alt/speed/vrate overrides + disclosures.
- `mission/spawnPlacement.ts` (new, + test) — base-leg + on-final placement.
- `mission/types.ts`, `mission/profiles/*.json`, `mission/profiles.ts` — base-leg knobs.
- `takeover/spawnModePreference.ts` (replaces headingToFafPreference.ts) (+ test).
- `state/store.ts` — `repositioned` flag.
- `game/FlightSession.tsx` — spawnMode state, branch both build sites, unranked short-circuit.
- `panels/HandoffCard.tsx` — 3-way chooser + UNRANKED note.
- `debrief` (EndCard/types) — repositioned unranked disclosure.

## Out of scope

- Curved corridor ribbon + menu toggle (Feature 2).
- Time compression and any non-reposition parts of #87.
- Server-side ranked schema changes (not needed — client short-circuit suffices).
