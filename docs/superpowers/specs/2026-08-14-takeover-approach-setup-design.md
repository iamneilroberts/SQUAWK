# Takeover approach-setup quality — design

_Date: 2026-08-14 · Status: approved for planning_

## Problem

When a player takes control of a real contact, the game should set them up for a sane
approach. Two gaps and one visibility fix:

1. **Distance.** The auto-picked airport is bounded only by a hard reachability radius
   (C172 ~57–70 NM at the 30-min cap; 737 ~215–240 NM) and biased closer only by a soft
   time penalty. Nothing targets a *reasonable* approach length, so the default can be a long
   boring cruise.
2. **Spawn heading.** The player spawns on the contact's live track, which can point away
   from the destination — the first thing they must do is a big turn.
3. **Handoff card** shows contact/spawn info but **no distance to the assigned airport**
   (distance is shown in the pre-takeover briefing and in-flight, just not on that card).

Heading-aware airport selection already shipped (#88 cone filter, live on `main`); this builds
on top of it.

## Ground rules honored

- **Only the player's SIM aircraft is synthesized.** Part B rotates only the spawned SIM
  aircraft; the genuine aircraft's ghost keeps its real live track. Part A only reweights which
  **real** airport is assigned. No feed data synthesized or extrapolated (ground rule #1).
- Rotation is disclosed on the handoff card's ADJUSTMENTS list (sim-state-unmistakable rule).
- `mission/` and `takeover/spawn.ts` stay pure and unit-testable (no Cesium).
- No new dependencies. Terminal visual language for UI (amber/cyan, uppercase, monospace, 1px).

## Relationship to issue #87 (time compression / skip-to-landing-approach)

- **Part B is the reusable subset of #87's "skip to landing approach."** It adds an optional
  heading override to the spawn builder (`buildSpawnState`). #87's skip will extend the **same
  seam** with position + on-slope altitude + on-speed + config to place the player on a
  stabilized final. Both reuse `finalApproachFix` (from #88). We keep the param minimal now
  (`spawnHeadingDeg?`) and mark it as the extension point — no speculative abstraction.
- **Part A reduces, not removes, the boring-cruise motivation for #87.** A far outlier still
  benefits from #87's compression/skip.
- **Ranked-neutral boundary.** Parts A and B change which real airport is assigned and the
  initial heading, but the player still flies the whole route — so they do NOT touch the
  ranked-eligibility question #87 raises. That decision stays entirely #87's.

Recorded on the issue: github.com/iamneilroberts/adsb-game/issues/87#issuecomment-5296629133

## Owner decisions (locked)

- Distance: **sweet-spot band** (prefer a target NM range, penalize outside both ends), not
  "prefer nearest" or a hard-cap cut.
- Spawn heading (toggle on): point at the **FAF** (bearing to `finalApproachFix`).
- Toggle: **handoff card checkbox, default ON, remembered** in localStorage.
- Spawn-heading edge case (taken already inside the FAF distance): **apply anyway** (simplest,
  honest, rare).
- Exclusions: **free flight** (user chose their own heading) and **RE-SYNC** (matches the live
  aircraft) never apply the heading override.

---

## Part A — Sweet-spot distance band

**Files:** `mission/types.ts`, `mission/profiles/*.json` (5), `mission/profiles.ts`,
`mission/assignment.ts`, `mission/assignment.test.ts`

- New per-profile `ranking` knobs (flat numeric, matching the existing validated fields):
  `preferredBandMinNm`, `preferredBandMaxNm`, `outsideBandPenaltyWeight`.
- `suitability()` (assignment.ts:57-66) gains `distanceNm` (already in scope in `bestForAirport`)
  and subtracts a band penalty:
  ```
  bandPenalty =
    distanceNm < preferredBandMinNm ? (preferredBandMinNm - distanceNm) * outsideBandPenaltyWeight
  : distanceNm > preferredBandMaxNm ? (distanceNm - preferredBandMaxNm) * outsideBandPenaltyWeight
  : 0
  score -= bandPenalty
  ```
  Inside the band, distance stops mattering (the soft `minutePenalty` still applies mildly).
  Heading cone + 3-tier fallback unchanged.
- Proposed defaults (all tunable knobs):

  | profile | bandMinNm | bandMaxNm | penaltyWeight |
  |---|---|---|---|
  | c172s | 8 | 25 | 0.6 |
  | tprop | 15 | 60 | 0.3 |
  | biz | 30 | 120 | 0.15 |
  | f5e | 30 | 120 | 0.15 |
  | b738 | 40 | 150 | 0.12 |

- Validator (`profiles.ts`): add the three keys to the ranking allow-list.
- Tests: an in-band airport beats an equally-suitable too-far one and an equally-suitable
  too-close one; band values read from the profile; existing assignment tests still pass.

## Part B — Spawn heading toward the FAF

**Files:** `takeover/headingToFafPreference.ts` (new) + test, `takeover/spawn.ts` + `spawn.test.ts`,
`game/FlightSession.tsx`, `takeover/instantMission.ts`

- **Preference module** mirroring `briefing/quickStartState.ts`: key
  `adsb.handoff-heading-to-faf.v1`, **default TRUE**, narrow `Pick<Storage, …>` types, try/catch,
  `typeof window` guard at the call site. Exposes `shouldFaceApproach(storage|null): boolean`
  (true on null/error) and a setter.
- **Spawn override:** add `spawnHeadingDeg?: number` to `buildSpawnState` / `buildLockedMissionSpawn`
  opts. At spawn.ts:159:
  `const headingRad = degToRad(opts.spawnHeadingDeg ?? contact.track ?? 0);`
  Everything downstream (attitude quat, velocity vector) already derives from `headingRad`, so
  the aircraft both points at and moves toward the target. When the override is applied (differs
  from the live track), push a `SpawnAdjustment` disclosure (e.g. `HEADING SET TO APPROACH`).
- **Callers compute the bearing when the pref is on:**
  `faf = finalApproachFix(assignment, missionProfile.guidance)` →
  `spawnHeadingDeg = initialBearingDeg(contact.lat, contact.lon, faf.point.latDeg, faf.point.lonDeg)`.
  - Locked mission / tutorial (`FlightSession.tsx:360`) and instant flight (`instantMission.ts:106`):
    apply it.
  - Free flight (`freeFlight.ts:145`) and RE-SYNC live re-spawn (`FlightSession.tsx:666`): never.
- **Live interaction on the handoff card:** the handoff card previews the spawn heading
  (`hprFromQuat(spawn.state.attitude…)`). The spawn is a `useMemo` in `FlightSession` keyed on the
  toggle state (initialized from the pref); toggling the checkbox rebuilds the spawn (cheap, pure)
  so the HEADING readout updates live, and persists the new pref. Instant flight (fast path, no
  countdown card) reads the persisted pref at build time — no live toggle there.

## Part C — Distance on the handoff card

**Files:** `panels/HandoffCard.tsx`, `game/FlightSession.tsx`

- Add a `DESTINATION  <airportIdent> RWY <end> · <dist> NM` row to `HandoffCard` (currently
  absent). Distance from `lockedMission.assignment` (`airportIdent`, `runwayEndIdent`,
  `distanceNm`), threaded as a prop from `FlightSession`. Em-dash if unavailable. Terminal style.

---

## Testing

- **Part A** (pure TS): band scoring — in-band beats too-far and too-close equals; per-profile
  band respected; backward compat (existing tests green).
- **Part B** (pure TS): `spawn.ts` — `spawnHeadingDeg` sets the attitude heading and velocity
  direction (recover via `hprFromQuat` / velocity bearing) and adds the disclosure; omitted →
  uses `contact.track`. Pref module — default true, round-trip set/get, error→true.
- **Parts B/C UI** (`FlightSession` wiring, HandoffCard checkbox + destination row): build +
  `tsc` clean; owner live-verifies on a traffic-enabled env (local has no feed, #66).

## Files touched

- `mission/types.ts` — three `ranking` band knobs.
- `mission/profiles/*.json` (5), `mission/profiles.ts` — values + validator.
- `mission/assignment.ts` (+ test) — band penalty.
- `takeover/headingToFafPreference.ts` (new, + test) — persisted default-on toggle.
- `takeover/spawn.ts` (+ test) — `spawnHeadingDeg` override + disclosure.
- `game/FlightSession.tsx` — bearing compute, toggle state, spawn rebuild, card props.
- `takeover/instantMission.ts` — read pref, pass override.
- `panels/HandoffCard.tsx` — checkbox + destination row.

## Out of scope

- Full skip-to-approach reposition (position/alt/speed/config) and time compression — issue #87.
- Ranked-mission eligibility changes.
- Applying the heading override to free flight or RE-SYNC.
