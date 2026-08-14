# Enhanced landing guidance — design (issue #88)

_Date: 2026-08-14 · Status: approved for planning_

## Problem

Route guidance today is a **straight geodesic line from the aircraft to the runway
threshold** (`globe/MissionRouteLayer.tsx`) plus the runway outline. At NAV assist that is
all the player gets: "aim at the numbers," which produces un-stabilized dive-and-drag
arrivals. Three related gaps (from the KBFM mobile report):

1. No approach path — nothing describes a real final; guidance points straight at the airport.
2. Airport auto-selection ignores current heading/track, so the first instruction can be a
   large turn away from where the aircraft is pointed.
3. Nothing tells the player **when/where to turn onto final** with target altitude/speed;
   the #52 approach band is silent until already on final.

## Ground rules honored

- **Guidance-only.** Advisory instrumentation over the player's synthesized aircraft. No
  feed data synthesized, extrapolated, or mocked (ground rule #1).
- Terminal visual language: cyan nominal / amber-orange targets, monospace, uppercase
  letterspaced, 1px borders.
- Ranked-mission semantics are **out of scope** here (owned by issue #87). This change does
  not alter ranking eligibility; it only changes which airport is assigned and what advisory
  cues are shown.

## Owner decisions (locked)

- **Approach shape:** straight-in to a final-approach fix (FAF), not a full traffic pattern.
- **Heading pick:** hard cone filter on current track (not a soft score term).
- **Assist gating:** turn-to-final callout at NAV; drawn approach path/marker at FULL.
- **FAF target altitude:** on-slope (glideslope extended to the FAF distance), not a capped
  pattern altitude.

## Data already available (from code map)

- `MissionStartSnapshot.trackDeg` (`mission/types.ts`) is populated from `contact.track` in
  `mission/planning.ts` and flows into `assignMission`, but is **currently unused**.
- ADS-B contacts carry **no filed destination** (`data/types.ts`) — track is the only
  directional signal. Confirmed.
- Centerline/glideslope math exists: `positionAlongApproach`, `glideSlopeAltitudeFt`
  (`mission/guidanceGeometry.ts`); `projectToRunwayFrame` (`mission/runwayGeometry.ts`).

---

## Part 1 — Heading-aware airport pick (hard cone)

**File:** `mission/assignment.ts`, `mission/types.ts`

- New per-profile knob `ranking.headingConeDeg` (default **60**) in `MissionProfile.ranking`.
- In the airport loop (`assignment.ts` ~L122–129), filter candidate airports to those whose
  **bearing from the aircraft** (`initialBearingDeg(snapshot → airport)`, already computed as
  `inboundBearing`) is within `±headingConeDeg` of `snapshot.trackDeg`
  (`headingDeltaDeg` from `geo.ts`).
- Survivors are scored with the **existing** `suitability()` formula — unchanged. No new
  score term.
- **Empty-cone fallback ladder** (never strand the player): try ±`headingConeDeg`; if no
  airport yields a suitable runway, retry at ±`2·headingConeDeg`; if still none, fall back to
  the current unfiltered candidate set (today's behavior). Deterministic from the spawn
  snapshot.
- Runway-**end** selection (`chooseRunwayEnd`) is unchanged.

**Result contract:** `MissionAssignmentResult` shape unchanged. When the fallback reaches the
unfiltered set, behavior is identical to today.

## Part 2 — Turn-to-final / FAF geometry

**File:** `mission/guidanceGeometry.ts`, `mission/types.ts`

- New per-profile knob `guidance.finalApproachFixNm` (default **5.5**).
- New `finalApproachFix(assignment, guidance): { point: GuidancePoint; headingDeg;
  altitudeFt }` — the point on the extended runway centerline at `finalApproachFixNm` from
  the threshold, on the glideslope. Reuses `positionAlongApproach` + `glideSlopeAltitudeFt`.
  `headingDeg` is the runway heading (straight-in intercept; no curved base leg).
- `altitudeFt` = on-slope altitude at the FAF distance.

## Part 3 — Turn-to-final callout (NAV + FULL)

**File:** `mission/assists.ts`, HUD components (`hud/Hud.tsx`, `hud/ImmersiveHudBar.tsx`)

- New `finalTurnCue(own, assignment, profile): { bearingDeg; distanceNm; targetAltFt;
  targetSpeedKt } | null` — bearing/distance from own position to the FAF; `targetAltFt` from
  `finalApproachFix`; `targetSpeedKt` = `profile.approach.targetSpeedKt`.
- **State machine (which cue is live):**
  - Before the FAF (own is farther from threshold than the FAF, i.e. not yet on final) →
    `finalTurnCue` is active; show turn-to-final callout.
  - At/after the FAF (on final) → `finalTurnCue` returns `null`; existing threshold cue
    (`missionNavigationCue`) + #52 approach band take over.
  - Gate uses the same runway-frame projection the band already uses so the handoff is clean.
- Gated as a `navigation` feature (NAV and FULL). HUD line, terminal style, e.g.:
  `TURN FINAL  HDG 043  5.5NM  ALT 2200  SPD 90`. Unknown fields render em-dash.

## Part 4 — Route path + flicker fix

**File:** `globe/MissionRouteLayer.tsx`

- Route polyline becomes a **3-point dogleg**: current position → FAF → threshold (was a
  straight `[start, destination]`). Shown at NAV+ (`features.route`). Once past the FAF the
  dogleg naturally collapses toward a straight final.
- **Flicker fixes** (reporter saw "2 flickering lines" = route + runway outline z-fighting):
  1. Keep the existing `depthFailMaterial` on the route line.
  2. Throttle the per-frame `CallbackProperty` rebuild — skip when the start point moved
     < ~1 m since last build (cache last positions).
  3. Give the **runway outline** the same `depthFailMaterial` so its occluded edge stops
     flickering.
- Acceptance: no visible flicker on a KBFM-type final approach.

## Part 5 — Drawn approach path at FULL

**File:** `globe/ApproachAssistLayer.tsx`

- FULL adds a drawn **FAF / turn marker** (point + label) on top of the existing corridor,
  glide gates, and flare. NAV stays callout-only. Consistent with the assist-gating decision.

---

## Testing (pure-TS units, per sim discipline)

- **Part 1:** an airport dead-ahead is chosen over a better-scoring airport behind the cone;
  an empty cone falls back to today's unfiltered result; `headingConeDeg` respected.
- **Part 2:** `finalApproachFix` point lies on the centerline at `finalApproachFixNm`;
  `altitudeFt` matches `glideSlopeAltitudeFt` at that distance.
- **Part 3:** `finalTurnCue` bearing/distance/alt/speed correct for a known geometry;
  returns `null` at/after the FAF (handoff to threshold cue verified).
- Layers/HUD (`MissionRouteLayer`, `ApproachAssistLayer`, HUD lines) verified by running the
  app on a real contact; no Cesium in the unit-tested `mission/` core.

## Files touched

- `mission/types.ts` — `ranking.headingConeDeg`, `guidance.finalApproachFixNm`.
- `mission/assignment.ts` — cone filter + fallback ladder.
- `mission/guidanceGeometry.ts` — `finalApproachFix`.
- `mission/assists.ts` — `finalTurnCue` + state machine.
- `globe/MissionRouteLayer.tsx` — dogleg route + flicker fix.
- `globe/ApproachAssistLayer.tsx` — FAF marker at FULL.
- `hud/Hud.tsx`, `hud/ImmersiveHudBar.tsx` — TURN FINAL line.
- Parameter files (three profiles) — new knob values.
- Tests under `mission/` for Parts 1–3.

## Out of scope

- Full traffic pattern (downwind/base/final circuit).
- Ranked-mission eligibility changes (issue #87).
- Time compression / skip-to-approach (issue #87).
