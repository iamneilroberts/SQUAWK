# Enhanced Landing Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guide the player onto a realistic straight-in final — heading-aware airport pick, a final-approach fix (FAF) with turn-to-final callout, a dogleg route line, and a flicker fix — without synthesizing any feed data.

**Architecture:** Pure-TS mission core (`frontend/src/mission/`, no Cesium) gains a cone filter in airport selection, a `finalApproachFix` geometry helper, and a `finalTurnCue` advisory. Cesium layers (`globe/`) and HUD (`hud/`) consume those outputs. Config lives in five profile JSONs + `types.ts`.

**Tech Stack:** Vite · React 18 + TypeScript · CesiumJS · Zustand · Vitest 4.

## Global Constraints

- Guidance-only: advisory instrumentation over the player's synthesized aircraft. Never synthesize, extrapolate, or mock ADS-B feed data (ground rule #1).
- `mission/` core stays free of Cesium imports and fully unit-testable.
- Terminal visual language: cyan nominal / amber-orange targets, monospace, uppercase letterspaced, 1px borders. Unknown fields render em-dash (—).
- No new dependencies.
- Ranked-mission eligibility is NOT changed by this work (owned by issue #87).
- Test command (from `frontend/`): `npx vitest run src/mission`. Full build check: `npm run build`.

---

## File structure

- `frontend/src/mission/types.ts` — add `ranking.headingConeDeg`, `guidance.finalApproachFixNm`.
- `frontend/src/mission/profiles/*.json` (c172s, b738, f5e, biz, tprop) — new knob values.
- `frontend/src/mission/profiles.ts` — validator field-set update.
- `frontend/src/mission/assignment.ts` — cone filter + fallback ladder.
- `frontend/src/mission/guidanceGeometry.ts` — `finalApproachFix`.
- `frontend/src/mission/assists.ts` — `finalTurnCue`.
- `frontend/src/globe/MissionRouteLayer.tsx` — dogleg route + flicker fix.
- `frontend/src/globe/ApproachAssistLayer.tsx` — FAF marker at FULL.
- `frontend/src/game/FlightSession.tsx`, `frontend/src/hud/ImmersiveHudBar.tsx`, `frontend/src/hud/Hud.tsx` — TURN FINAL line.

---

### Task 1: Config foundation — new profile knobs

**Files:**
- Modify: `frontend/src/mission/types.ts:88-101`
- Modify: `frontend/src/mission/profiles/c172s.json`, `b738.json`, `f5e.json`, `biz.json`, `tprop.json`
- Modify: `frontend/src/mission/profiles.ts` (validator field lists)
- Test: existing `frontend/src/mission/profiles.test.ts`

**Interfaces:**
- Produces: `MissionProfile["ranking"].headingConeDeg: number`, `MissionProfile["guidance"].finalApproachFixNm: number`.

- [ ] **Step 1: Add the fields to the types**

In `types.ts`, extend the `ranking` and `guidance` object types:

```ts
  ranking: {
    lengthMarginWeight: number;
    widthMarginWeight: number;
    lightedBonus: number;
    hardSurfaceBonus: number;
    minutePenalty: number;
    headingConeDeg: number;
  };
  guidance: {
    approachLengthNm: number;
    corridorWidthFt: number;
    gateSpacingNm: number;
    glideSlopeDeg: number;
    flareHeightFt: number;
    finalApproachFixNm: number;
  };
```

- [ ] **Step 2: Add values to all five profile JSONs**

In each `frontend/src/mission/profiles/*.json`, add `"headingConeDeg": 60` to the `ranking` block and `"finalApproachFixNm": 5.5` to the `guidance` block. (Same values across all five for v1; they are per-profile knobs and can diverge later.)

- [ ] **Step 3: Update the validator**

Read `profiles.ts` and find where it validates the allowed/required key set for `ranking` and `guidance` (the field-membership check that `profiles.test.ts` exercises). Add `headingConeDeg` to the ranking list and `finalApproachFixNm` to the guidance list so the new keys are accepted/required.

- [ ] **Step 4: Run the profile tests**

Run: `cd frontend && npx vitest run src/mission/profiles.test.ts`
Expected: PASS (all five profiles validate with the new fields).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/mission/types.ts frontend/src/mission/profiles.ts frontend/src/mission/profiles/
git commit -m "feat(mission): add headingConeDeg + finalApproachFixNm profile knobs (#88)"
```

---

### Task 2: Heading-aware airport pick (hard cone + fallback ladder)

**Files:**
- Modify: `frontend/src/mission/assignment.ts:120-130`
- Test: `frontend/src/mission/assignment.test.ts`

**Interfaces:**
- Consumes: `MissionProfile.ranking.headingConeDeg` (Task 1), `snapshot.trackDeg`, `headingDeltaDeg`/`initialBearingDeg` from `geo.ts`.
- Produces: no signature change to `assignMission`; behavior — candidates filtered to airports whose bearing-from-aircraft is within the cone of `trackDeg`, with a 3-tier fallback (cone → 2×cone → unfiltered).

- [ ] **Step 1: Write the failing tests**

Add to `assignment.test.ts` (reuse the existing `snapshot`, `runway`, `airport` helpers; `snapshot.trackDeg` is 90 = due east):

```ts
describe("heading-aware selection", () => {
  it("prefers an airport ahead over a better one behind the cone", () => {
    const profile = missionProfileForClass("C172");
    // ahead (east, along track 090): modest runway; behind (west): excellent long runway
    const ahead = airport("AHEAD", 40, {
      ...destinationPoint(snapshot.latDeg, snapshot.lonDeg, 90, 40),
      runways: [runway({ lengthFt: 3200, widthFt: 75 })],
    });
    const behind = airport("BEHIND", 40, {
      ...destinationPoint(snapshot.latDeg, snapshot.lonDeg, 270, 40),
      runways: [runway({ lengthFt: 9000, widthFt: 150 })],
    });
    const result = assignMission({ snapshot, profile, datasetVersion: "t", airports: [behind, ahead] });
    expect(result.assigned).toBe(true);
    if (result.assigned) expect(result.best.airportIdent).toBe("AHEAD");
  });

  it("falls back to unfiltered ranking when the cone is empty", () => {
    const profile = missionProfileForClass("C172");
    const behind = airport("BEHIND", 40, {
      ...destinationPoint(snapshot.latDeg, snapshot.lonDeg, 270, 40),
      runways: [runway({ lengthFt: 9000, widthFt: 150 })],
    });
    const result = assignMission({ snapshot, profile, datasetVersion: "t", airports: [behind] });
    expect(result.assigned).toBe(true);
    if (result.assigned) expect(result.best.airportIdent).toBe("BEHIND");
  });
});
```

> NOTE: confirm the `airport()` helper accepts lat/lon overrides via its `over` param; the fixture spreads `destinationPoint(...)` (which returns `{ latDeg, lonDeg }`) into it. If the helper computes position from the `distanceNm` arg instead, adjust the fixture to place AHEAD due east / BEHIND due west of the snapshot using that mechanism — the intent is one airport within ±60° of track 090 and one outside it.

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/mission/assignment.test.ts -t "heading-aware"`
Expected: FAIL — "prefers an airport ahead" fails because selection currently ignores track (BEHIND's longer runway wins).

- [ ] **Step 3: Implement the cone filter + fallback ladder**

In `assignment.ts`, replace the single candidate loop (`:120-129`) with a helper that filters by an optional cone, then a 3-tier fallback:

```ts
  const collectCandidates = (coneDeg: number | null): RunwayAssignment[] => {
    const out: RunwayAssignment[] = [];
    for (const airport of options.airports) {
      if (!profile.runway.airportSizes.includes(airport.size)) continue;
      const distanceNm = greatCircleDistanceNm(snapshot.latDeg, snapshot.lonDeg, airport.latDeg, airport.lonDeg);
      if (distanceNm + BOUNDARY_EPSILON < profile.reachability.minDestinationNm || distanceNm > maxDistanceNm + BOUNDARY_EPSILON) continue;
      if (coneDeg !== null) {
        const bearingToAirport = initialBearingDeg(snapshot.latDeg, snapshot.lonDeg, airport.latDeg, airport.lonDeg);
        if (headingDeltaDeg(snapshot.trackDeg, bearingToAirport) > coneDeg + BOUNDARY_EPSILON) continue;
      }
      const estimatedMinutes = distanceNm / planningSpeedKt * 60;
      const best = bestForAirport(airport, snapshot, estimatedMinutes, distanceNm, profile);
      if (best !== null) out.push(best);
    }
    return out;
  };

  const cone = profile.ranking.headingConeDeg;
  let candidates = collectCandidates(cone);
  if (candidates.length === 0) candidates = collectCandidates(cone * 2);
  if (candidates.length === 0) candidates = collectCandidates(null);
  candidates.sort(compareAssignments);
```

Ensure `headingDeltaDeg` and `initialBearingDeg` are imported from `./geo` (add to the existing import if missing).

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/mission/assignment.test.ts`
Expected: PASS (new tests + all existing assignment tests still green — the unfiltered tier reproduces today's behavior).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/mission/assignment.ts frontend/src/mission/assignment.test.ts
git commit -m "feat(mission): heading-aware airport pick with cone filter + fallback (#88)"
```

---

### Task 3: FAF geometry (`finalApproachFix`)

**Files:**
- Modify: `frontend/src/mission/guidanceGeometry.ts`
- Test: `frontend/src/mission/guidanceGeometry.test.ts`

**Interfaces:**
- Consumes: `positionAlongApproach`, `glideSlopeAltitudeFt`, `MissionProfile["guidance"].finalApproachFixNm` (Task 1).
- Produces: `finalApproachFix(assignment: RunwayAssignment, guidance: MissionProfile["guidance"]): { point: GuidancePoint; headingDeg: number; altitudeFt: number }`.

- [ ] **Step 1: Write the failing test**

Add to `guidanceGeometry.test.ts` (reuse whatever `assignment` fixture that file already builds; if none, construct a minimal `RunwayAssignment` as the other geometry tests do):

```ts
describe("finalApproachFix", () => {
  it("sits on the centerline at finalApproachFixNm, on-slope", () => {
    const guidance = { ...baseGuidance, finalApproachFixNm: 5.5, approachLengthNm: 5, glideSlopeDeg: 3 };
    const faf = finalApproachFix(assignment, guidance);
    expect(faf.headingDeg).toBeCloseTo(assignment.runwayHeadingDeg, 6);
    expect(faf.altitudeFt).toBeCloseTo(glideSlopeAltitudeFt(assignment, guidance, 5.5), 6);
    // point matches positionAlongApproach at the same distance
    const ref = positionAlongApproach(assignment, guidance, 5.5).point;
    expect(faf.point.latDeg).toBeCloseTo(ref.latDeg, 9);
    expect(faf.point.lonDeg).toBeCloseTo(ref.lonDeg, 9);
  });
});
```

(Where `baseGuidance`/`assignment` mirror the fixtures already used in this test file; if the file lacks them, copy the guidance object from `c172s.json` and a `RunwayAssignment` from an existing geometry test.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/mission/guidanceGeometry.test.ts -t "finalApproachFix"`
Expected: FAIL — "finalApproachFix is not a function".

- [ ] **Step 3: Implement**

Add to `guidanceGeometry.ts`:

```ts
export function finalApproachFix(
  assignment: RunwayAssignment,
  guidance: MissionProfile["guidance"],
): { point: GuidancePoint; headingDeg: number; altitudeFt: number } {
  const { point, approachHeadingDeg } = positionAlongApproach(assignment, guidance, guidance.finalApproachFixNm);
  return { point, headingDeg: approachHeadingDeg, altitudeFt: point.altitudeFt };
}
```

- [ ] **Step 4: Run the test**

Run: `cd frontend && npx vitest run src/mission/guidanceGeometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/mission/guidanceGeometry.ts frontend/src/mission/guidanceGeometry.test.ts
git commit -m "feat(mission): finalApproachFix geometry helper (#88)"
```

---

### Task 4: Turn-to-final cue (`finalTurnCue`)

**Files:**
- Modify: `frontend/src/mission/assists.ts`
- Test: `frontend/src/mission/assists.test.ts`

**Interfaces:**
- Consumes: `finalApproachFix` (Task 3), `initialBearingDeg`/`greatCircleDistanceNm` from `geo.ts`, `MissionProfile`.
- Produces: `finalTurnCue(own: { latDeg: number; lonDeg: number }, assignment: RunwayAssignment, profile: MissionProfile): { bearingDeg: number; distanceNm: number; targetAltFt: number; targetSpeedKt: number } | null`. Returns `null` once within `finalApproachFixNm` of the threshold (hand off to `missionNavigationCue` + approach band).

- [ ] **Step 1: Write the failing tests**

Add to `assists.test.ts`:

```ts
describe("finalTurnCue", () => {
  const profile = missionProfileForClass("C172");
  it("points to the FAF and carries on-slope alt + approach speed when en route", () => {
    // own well outside the FAF distance, offset to the side of the centerline
    const own = { latDeg: assignment.assignedEnd.latDeg + 0.3, lonDeg: assignment.assignedEnd.lonDeg + 0.3 };
    const cue = finalTurnCue(own, assignment, profile);
    expect(cue).not.toBeNull();
    if (cue) {
      const faf = finalApproachFix(assignment, profile.guidance);
      expect(cue.bearingDeg).toBeCloseTo(initialBearingDeg(own.latDeg, own.lonDeg, faf.point.latDeg, faf.point.lonDeg), 6);
      expect(cue.targetAltFt).toBeCloseTo(faf.altitudeFt, 6);
      expect(cue.targetSpeedKt).toBe(profile.approach.targetSpeedKt);
    }
  });

  it("returns null once inside the FAF distance (on final)", () => {
    // own very close to the threshold
    const own = { latDeg: assignment.assignedEnd.latDeg + 0.001, lonDeg: assignment.assignedEnd.lonDeg + 0.001 };
    expect(finalTurnCue(own, assignment, profile)).toBeNull();
  });
});
```

(Reuse or copy an `assignment` fixture as the other `assists.test.ts` cases do.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/mission/assists.test.ts -t "finalTurnCue"`
Expected: FAIL — "finalTurnCue is not a function".

- [ ] **Step 3: Implement**

Add to `assists.ts` (import `finalApproachFix` from `./guidanceGeometry`, and `MissionProfile` type if not already imported):

```ts
export function finalTurnCue(
  own: { latDeg: number; lonDeg: number },
  assignment: RunwayAssignment,
  profile: MissionProfile,
): { bearingDeg: number; distanceNm: number; targetAltFt: number; targetSpeedKt: number } | null {
  const distanceToThresholdNm = greatCircleDistanceNm(
    own.latDeg, own.lonDeg, assignment.assignedEnd.latDeg, assignment.assignedEnd.lonDeg,
  );
  // Inside the FAF distance we are on (or intercepting) final; hand off to the threshold cue + approach band.
  if (distanceToThresholdNm <= profile.guidance.finalApproachFixNm) return null;
  const faf = finalApproachFix(assignment, profile.guidance);
  return {
    bearingDeg: initialBearingDeg(own.latDeg, own.lonDeg, faf.point.latDeg, faf.point.lonDeg),
    distanceNm: greatCircleDistanceNm(own.latDeg, own.lonDeg, faf.point.latDeg, faf.point.lonDeg),
    targetAltFt: faf.altitudeFt,
    targetSpeedKt: profile.approach.targetSpeedKt,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/mission/assists.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/mission/assists.ts frontend/src/mission/assists.test.ts
git commit -m "feat(mission): finalTurnCue turn-to-final advisory (#88)"
```

---

### Task 5: Route dogleg + flicker fix

**Files:**
- Modify: `frontend/src/globe/MissionRouteLayer.tsx:35-62`

**Interfaces:**
- Consumes: `finalApproachFix` (Task 3), `assistFeatures().route`.
- Produces: route polyline drawn as current position → FAF → threshold; stable (no per-frame z-fight flicker).

- [ ] **Step 1: Make the route a 3-point dogleg through the FAF**

Compute the FAF Cartesian once (like `destination` at `:35-39`), then have the `positions` `CallbackProperty` return `[start, faf, destination]`:

```ts
  const faf = finalApproachFix(assignment, guidance).point;
  const fafCartesian = Cartesian3.fromDegrees(faf.lonDeg, faf.latDeg, faf.altitudeFt);
  // ...
  positions: new CallbackProperty(() => {
    const start = routeStartPoint(hudSnapshot.get(), mission);
    const startCartesian = Cartesian3.fromDegrees(start.lonDeg, start.latDeg, start.altitudeFt);
    if (lastStart && Cartesian3.distance(startCartesian, lastStart) < 1) return lastPositions;
    lastStart = startCartesian;
    lastPositions = [startCartesian, fafCartesian, destination];
    return lastPositions;
  }, false),
```

Declare `let lastStart: Cartesian3 | null = null; let lastPositions: Cartesian3[] = [];` in the effect scope above the entity. This is the sub-pixel throttle: rebuild only when the start moved ≥ 1 m. (Match the exact `routeStartPoint` return shape to the current code; it already yields lat/lon and a usable altitude.)

- [ ] **Step 2: Settle the remaining flicker**

Keep the route line's `depthFailMaterial` (`:57`). Add the same `depthFailMaterial: Color.CYAN.withAlpha(0.35)` (or the runway color at ~0.35 alpha) to the **runway outline** polyline built at `:65-103`, so its terrain-occluded edge stops z-fighting — this is the second of the reporter's "2 flickering lines".

- [ ] **Step 3: Build + run to verify**

Run: `cd frontend && npm run build` (must succeed).
Then run the app (`npm run dev`), take controls of a contact near an airport, fly toward the assigned runway, and confirm: the route bends through the FAF, and neither the route line nor the runway outline flickers on final. See the run skill / project run instructions.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/globe/MissionRouteLayer.tsx
git commit -m "feat(globe): dogleg route through FAF + runway-outline flicker fix (#88)"
```

---

### Task 6: FAF marker at FULL

**Files:**
- Modify: `frontend/src/globe/ApproachAssistLayer.tsx`

**Interfaces:**
- Consumes: `finalApproachFix` (Task 3), `assistFeatures().approachCorridor` (FULL gate, `:29`).

- [ ] **Step 1: Draw a FAF point + label at FULL**

Inside the FULL-gated block, add a small point entity + uppercase label at `finalApproachFix(assignment, guidance).point` (amber-orange target color, matching the flare marker's styling at `ApproachAssistLayer.tsx:53-68`). Label text e.g. `FAF`.

- [ ] **Step 2: Build + run to verify**

Run: `cd frontend && npm run build`, then in the app set assist to FULL and confirm the FAF marker renders on the extended centerline at the corridor's outer end; at NAV it is absent.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/globe/ApproachAssistLayer.tsx
git commit -m "feat(globe): FAF marker at FULL assist (#88)"
```

---

### Task 7: TURN FINAL HUD line

**Files:**
- Modify: `frontend/src/game/FlightSession.tsx:900-916`
- Modify: `frontend/src/hud/ImmersiveHudBar.tsx:169-201`
- Modify: `frontend/src/hud/Hud.tsx` (near `HudDestinationCue`)

**Interfaces:**
- Consumes: `finalTurnCue` (Task 4).
- Produces: a `TURN FINAL  HDG xxx  x.x NM  ALT xxxx  SPD xxx` readout, shown at NAV+ while `finalTurnCue` is non-null.

- [ ] **Step 1: Compute the cue in FlightSession**

Beside `immersiveNavCue` (`:900-916`), compute a `finalTurn` value gated the same way (`instantFlight || assistFeatures(assist.current).destinationCue`, i.e. NAV+), calling `finalTurnCue(snapshot, lockedMission.assignment, lockedMission.missionProfile)`. Pass it to `ImmersiveHudBar` / `NavDirector` and to the desktop HUD alongside `navCue`.

- [ ] **Step 2: Render it in NavDirector (mobile/immersive)**

In `ImmersiveHudBar.tsx` `NavDirector` (`:169-201`), add a conditional `<span className="imm-director-approach">` sibling (same pattern as the `approachBand` branch) that renders when `finalTurn` is non-null:

```tsx
{finalTurn && (
  <span className="imm-director-approach">
    {`TURN FINAL ${Math.round(finalTurn.bearingDeg).toString().padStart(3, "0")}° · ` +
      `${finalTurn.distanceNm.toFixed(1)} NM · ${roundTo10(finalTurn.targetAltFt)} FT · ` +
      `${Math.round(finalTurn.targetSpeedKt)} KT`}
  </span>
)}
```

Add `finalTurn` to `NavDirector`'s props type (mirror how `approachBand`/`descentGuidance` are typed).

- [ ] **Step 3: Render it on the desktop HUD**

In `Hud.tsx`, add a sibling to `HudDestinationCue` (or a new small `HudFinalTurnCue`) that renders the same line using the existing `hud-destination`/`hud-scrim` styling when `finalTurn` is non-null. Keep it terminal-style, uppercase, 1px.

- [ ] **Step 4: Build + run to verify**

Run: `cd frontend && npm run build`, then in the app fly a contact toward its airport at NAV assist and confirm the TURN FINAL line appears with heading/distance to the FAF and target alt/speed, and disappears (handing off to the destination/approach cues) once within the FAF distance.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/FlightSession.tsx frontend/src/hud/ImmersiveHudBar.tsx frontend/src/hud/Hud.tsx
git commit -m "feat(hud): TURN FINAL callout at NAV assist (#88)"
```

---

## Final verification

- [ ] Full unit suite green: `cd frontend && npx vitest run src/mission`
- [ ] Build clean: `cd frontend && npm run build`
- [ ] Manual run: assign, fly, confirm dogleg + TURN FINAL + FAF marker + no flicker; NAV vs FULL gating correct.
- [ ] Append a dated entry to `docs/decisions.md` (per CLAUDE.md rule #4): straight-in FAF, hard cone + fallback ladder, on-slope FAF altitude, callout-at-NAV / drawn-at-FULL.
- [ ] Push branch, open PR closing #88, show it running, then stop for sign-off.
