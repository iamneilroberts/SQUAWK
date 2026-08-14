# Takeover Approach-Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make taking control set the player up for a sane approach — a sweet-spot-distance airport pick, spawn pointed at the FAF (default-on, remembered), and the destination distance on the handoff card.

**Architecture:** Pure-TS mission core (`mission/assignment.ts`) gains a distance-band penalty; a new localStorage pref module + a `spawnHeadingDeg` override on the pure spawn builder (`takeover/spawn.ts`); the FAF bearing is computed at the spawn call sites (`game/FlightSession.tsx`, `takeover/instantMission.ts`); `panels/HandoffCard.tsx` gets a checkbox + a destination row.

**Tech Stack:** Vite · React 18 + TypeScript · Zustand · Vitest 4.

## Global Constraints

- Only the player's SIM aircraft is synthesized; the genuine aircraft's ghost keeps its real live track. No ADS-B feed data synthesized or extrapolated (ground rule #1).
- Heading rotation is disclosed on the handoff card ADJUSTMENTS list.
- `mission/` and `takeover/spawn.ts` stay Cesium-free, pure, unit-testable.
- No new dependencies.
- Ranked-mission eligibility is NOT changed. Free flight and RE-SYNC never get the heading override.
- Test command (from `frontend/`): `npx vitest run src/mission src/takeover`. Build check: `npm run build`.

---

## File structure

- `mission/types.ts` — three new `ranking` band knobs.
- `mission/profiles/*.json` (5) + `mission/profiles.ts` — band values + validator.
- `mission/assignment.ts` (+ test) — band penalty in `suitability`.
- `takeover/headingToFafPreference.ts` (new) + test — persisted default-on toggle.
- `takeover/spawn.ts` (+ test) — `spawnHeadingDeg` override + disclosure.
- `game/FlightSession.tsx`, `takeover/instantMission.ts`, `panels/HandoffCard.tsx` — wiring + UI.

---

### Task 1: Distance-band config knobs

**Files:**
- Modify: `frontend/src/mission/types.ts:88-95`
- Modify: `frontend/src/mission/profiles/{c172s,b738,f5e,biz,tprop}.json`
- Modify: `frontend/src/mission/profiles.ts:60`
- Test: existing `frontend/src/mission/profiles.test.ts`

**Interfaces:**
- Produces: `MissionProfile["ranking"]` gains `preferredBandMinNm`, `preferredBandMaxNm`, `outsideBandPenaltyWeight` (all `number`).

- [ ] **Step 1: Extend the ranking type**

In `types.ts`, add to the `ranking` object type (after `headingConeDeg`):

```ts
    headingConeDeg: number;
    preferredBandMinNm: number;
    preferredBandMaxNm: number;
    outsideBandPenaltyWeight: number;
```

- [ ] **Step 2: Add values to all five profile JSONs**

Add these three keys to each profile's `ranking` block:

- `c172s.json`: `"preferredBandMinNm": 8, "preferredBandMaxNm": 25, "outsideBandPenaltyWeight": 1.0`
- `tprop.json`: `"preferredBandMinNm": 15, "preferredBandMaxNm": 60, "outsideBandPenaltyWeight": 0.5`
- `biz.json`: `"preferredBandMinNm": 30, "preferredBandMaxNm": 120, "outsideBandPenaltyWeight": 0.3`
- `f5e.json`: `"preferredBandMinNm": 30, "preferredBandMaxNm": 120, "outsideBandPenaltyWeight": 0.3`
- `b738.json`: `"preferredBandMinNm": 40, "preferredBandMaxNm": 150, "outsideBandPenaltyWeight": 0.25`

- [ ] **Step 3: Update the validator**

In `profiles.ts:60`, extend `rankingNames`:

```ts
  const rankingNames = ["lengthMarginWeight", "widthMarginWeight", "lightedBonus", "hardSurfaceBonus", "minutePenalty", "headingConeDeg", "preferredBandMinNm", "preferredBandMaxNm", "outsideBandPenaltyWeight"] as const;
```

(The existing `assertFiniteNonNegative` loop over `rankingNames` covers the new keys — all three are ≥ 0.)

- [ ] **Step 4: Run the profile tests**

Run: `cd frontend && npx vitest run src/mission/profiles.test.ts`
Expected: PASS (all five profiles validate with the new fields).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/mission/types.ts frontend/src/mission/profiles.ts frontend/src/mission/profiles/
git commit -m "feat(mission): sweet-spot distance-band ranking knobs"
```

---

### Task 2: Distance-band penalty in suitability

**Files:**
- Modify: `frontend/src/mission/assignment.ts:57-66`
- Test: `frontend/src/mission/assignment.test.ts`

**Interfaces:**
- Consumes: `ranking.preferredBandMinNm/MaxNm/outsideBandPenaltyWeight` (Task 1).
- Produces: `suitability(runway, estimatedMinutes, distanceNm, profile)` — new `distanceNm` param; score reduced when the airport is outside the band.

- [ ] **Step 1: Write the failing test**

Add to `assignment.test.ts` (reuse the existing `snapshot`/`runway`/`airport` helpers; `snapshot.trackDeg` is 90 = due east, `groundSpeedKt` 120):

```ts
describe("sweet-spot distance band", () => {
  it("prefers an in-band airport over an equally-good too-close one", () => {
    const profile = missionProfileForClass("c172s"); // band [8,25], weight 1.0
    // both due east (in the 60° cone), equal runways; CLOSE (6 NM) is below the band min,
    // BAND (15 NM) is inside it. Without the band, minutePenalty would pick CLOSE.
    const close = airport("CLOSE", 6, { ...destinationPoint(snapshot.latDeg, snapshot.lonDeg, 90, 6) });
    const band = airport("BAND", 15, { ...destinationPoint(snapshot.latDeg, snapshot.lonDeg, 90, 15) });
    const result = assignMission({ snapshot, profile, datasetVersion: "t", airports: [close, band] });
    expect(result.assigned).toBe(true);
    if (result.assigned) expect(result.best.airportIdent).toBe("BAND");
  });

  it("prefers an in-band airport over an equally-good too-far one", () => {
    const profile = missionProfileForClass("c172s");
    const band = airport("BAND", 15, { ...destinationPoint(snapshot.latDeg, snapshot.lonDeg, 90, 15) });
    const far = airport("FAR", 50, { ...destinationPoint(snapshot.latDeg, snapshot.lonDeg, 90, 50) });
    const result = assignMission({ snapshot, profile, datasetVersion: "t", airports: [band, far] });
    expect(result.assigned).toBe(true);
    if (result.assigned) expect(result.best.airportIdent).toBe("BAND");
  });
});
```

> NOTE: confirm the `airport()` helper takes lat/lon via its `over` param (the #88 band tests used the same `destinationPoint(...)` spread). If it derives position from the `distanceNm` arg instead, adapt so CLOSE=6 NM / BAND=15 NM / FAR=50 NM sit due east of the snapshot (in the cone). Intent: CLOSE below band-min, BAND inside, FAR above band-max, equal runways.

- [ ] **Step 2: Run to verify the too-close test fails**

Run: `cd frontend && npx vitest run src/mission/assignment.test.ts -t "too-close"`
Expected: FAIL — without the band, CLOSE (6 NM) wins on the existing `minutePenalty`.

- [ ] **Step 3: Add the band penalty**

In `assignment.ts`, change `suitability` to take `distanceNm` and subtract the band penalty:

```ts
function suitability(runway: Runway & { lengthFt: number; widthFt: number }, estimatedMinutes: number, distanceNm: number, profile: MissionProfile): number {
  const lengthMargin = clamp((runway.lengthFt - profile.runway.minLengthFt) / profile.runway.minLengthFt, 0, 2);
  const widthMargin = clamp((runway.widthFt - profile.runway.minWidthFt) / profile.runway.minWidthFt, 0, 2);
  const bandPenalty =
    distanceNm < profile.ranking.preferredBandMinNm
      ? (profile.ranking.preferredBandMinNm - distanceNm) * profile.ranking.outsideBandPenaltyWeight
      : distanceNm > profile.ranking.preferredBandMaxNm
        ? (distanceNm - profile.ranking.preferredBandMaxNm) * profile.ranking.outsideBandPenaltyWeight
        : 0;
  const score = lengthMargin * profile.ranking.lengthMarginWeight +
    widthMargin * profile.ranking.widthMarginWeight +
    (runway.lighted ? profile.ranking.lightedBonus : 0) +
    (runway.surface === "HARD" ? profile.ranking.hardSurfaceBonus : 0) -
    estimatedMinutes * profile.ranking.minutePenalty -
    bandPenalty;
  return round(score, 6);
}
```

Update the one call site in `bestForAirport` (assignment.ts:101) to pass `distanceNm` (already a param of `bestForAirport`):

```ts
      suitability: suitability(runway as Runway & { lengthFt: number; widthFt: number }, estimatedMinutes, distanceNm, profile),
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/mission/assignment.test.ts`
Expected: PASS (new tests + all existing assignment tests — the band is 0 inside the range, so in-range picks are unchanged).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/mission/assignment.ts frontend/src/mission/assignment.test.ts
git commit -m "feat(mission): sweet-spot distance-band penalty in airport scoring"
```

---

### Task 3: Heading-to-FAF preference module

**Files:**
- Create: `frontend/src/takeover/headingToFafPreference.ts`
- Test: `frontend/src/takeover/headingToFafPreference.test.ts`

**Interfaces:**
- Produces: `shouldFaceApproach(storage: Pick<Storage,"getItem"> | null): boolean` (default **true**); `setFaceApproach(storage: Pick<Storage,"setItem">, enabled: boolean): void`; `HEADING_TO_FAF_STORAGE_KEY`.

- [ ] **Step 1: Write the failing test**

Create `headingToFafPreference.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldFaceApproach, setFaceApproach, HEADING_TO_FAF_STORAGE_KEY } from "./headingToFafPreference";

function memStore(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    _m: m,
  };
}

describe("headingToFafPreference", () => {
  it("defaults to true when unset or storage is null", () => {
    expect(shouldFaceApproach(null)).toBe(true);
    expect(shouldFaceApproach(memStore())).toBe(true);
  });
  it("round-trips a false then true setting", () => {
    const s = memStore();
    setFaceApproach(s, false);
    expect(s._m.get(HEADING_TO_FAF_STORAGE_KEY)).toBe("off");
    expect(shouldFaceApproach(s)).toBe(false);
    setFaceApproach(s, true);
    expect(shouldFaceApproach(s)).toBe(true);
  });
  it("returns true when getItem throws", () => {
    const throwing = { getItem: () => { throw new Error("blocked"); } };
    expect(shouldFaceApproach(throwing)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/takeover/headingToFafPreference.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (mirrors `briefing/quickStartState.ts`)**

Create `headingToFafPreference.ts`:

```ts
export const HEADING_TO_FAF_STORAGE_KEY = "adsb.handoff-heading-to-faf.v1";

export type StorageReader = Pick<Storage, "getItem">;
export type StorageWriter = Pick<Storage, "setItem">;

/** Default ON: only an explicit "off" disables it. */
export function shouldFaceApproach(storage: StorageReader | null): boolean {
  if (storage === null) return true;
  try {
    return storage.getItem(HEADING_TO_FAF_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setFaceApproach(storage: StorageWriter, enabled: boolean): void {
  storage.setItem(HEADING_TO_FAF_STORAGE_KEY, enabled ? "on" : "off");
}
```

- [ ] **Step 4: Run the test**

Run: `cd frontend && npx vitest run src/takeover/headingToFafPreference.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/takeover/headingToFafPreference.ts frontend/src/takeover/headingToFafPreference.test.ts
git commit -m "feat(takeover): persisted default-on heading-to-FAF preference"
```

---

### Task 4: Spawn heading override

**Files:**
- Modify: `frontend/src/takeover/spawn.ts:40-64,159`
- Test: `frontend/src/takeover/spawn.test.ts`

**Interfaces:**
- Consumes: nothing new (a plain optional param).
- Produces: `buildSpawnState`/`buildLockedMissionSpawn` accept `opts.spawnHeadingDeg?: number`; when provided, the spawn heading/velocity use it and a `HEADING` `SpawnAdjustment` is added.

- [ ] **Step 1: Write the failing test**

Add to `spawn.test.ts` (reuse the file's existing contact + params fixtures; import `hprFromQuat` from `../sim/quat` and `radToDeg` from `../mission/geo` or `../sim/units` as the file already does — match existing imports):

```ts
describe("spawnHeadingDeg override", () => {
  it("points attitude at the override heading and discloses it", () => {
    const base = buildSpawnState(contact, params, { terrainHeightM: null });
    const over = buildSpawnState(contact, params, { terrainHeightM: null, spawnHeadingDeg: 42 });
    const baseHdg = radToDeg(hprFromQuat(base.state.attitude, base.state.position).headingRad);
    const overHdg = radToDeg(hprFromQuat(over.state.attitude, over.state.position).headingRad);
    expect(((overHdg % 360) + 360) % 360).toBeCloseTo(42, 3);
    expect(overHdg).not.toBeCloseTo(baseHdg, 1); // assumes fixture contact.track !== 42
    expect(over.adjustments.some((a) => a.field === "HEADING")).toBe(true);
    expect(base.adjustments.some((a) => a.field === "HEADING")).toBe(false);
  });
});
```

> NOTE: pick the override value (42) so it differs from the fixture `contact.track`; if the fixture track is 42, use a different number. Match the file's existing degree-conversion import (`radToDeg`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/takeover/spawn.test.ts -t "spawnHeadingDeg"`
Expected: FAIL — `spawnHeadingDeg` ignored; no HEADING adjustment.

- [ ] **Step 3: Implement**

Add `spawnHeadingDeg?: number` to BOTH opts types (spawn.ts:44-54 `buildLockedMissionSpawn` and spawn.ts:59-64 `buildSpawnState`). In `buildLockedMissionSpawn`, `opts` is forwarded to `buildSpawnState` unchanged, so no other change there.

In `buildSpawnState`, replace the heading line (spawn.ts:159) and add the disclosure:

```ts
  const liveTrackDeg = contact.track ?? 0;
  const headingDeg = opts.spawnHeadingDeg ?? liveTrackDeg;
  const headingRad = degToRad(headingDeg);
  if (opts.spawnHeadingDeg !== undefined && Math.abs(normalizeHeading(opts.spawnHeadingDeg) - normalizeHeading(liveTrackDeg)) > 0.5) {
    adjustments.push({
      field: "HEADING",
      from: `${Math.round(normalizeHeading(liveTrackDeg)).toString().padStart(3, "0")} LIVE`,
      to: `${Math.round(normalizeHeading(headingDeg)).toString().padStart(3, "0")} TO APPROACH`,
      reason: "Pointed at the approach fix for takeover setup (HEADING → APPROACH toggle).",
    });
  }
```

Import `normalizeHeading` from `../mission/geo` if not already imported in `spawn.ts` (check the existing import block first; use whatever heading-normalize helper the file/geo module already exposes).

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/takeover/spawn.test.ts`
Expected: PASS (new test + all existing spawn tests — omitting `spawnHeadingDeg` is unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/takeover/spawn.ts frontend/src/takeover/spawn.test.ts
git commit -m "feat(takeover): optional spawnHeadingDeg override with disclosure"
```

---

### Task 5: Wire the toggle, FAF bearing, and card (UI)

**Files:**
- Modify: `frontend/src/game/FlightSession.tsx:112,320-370,554-562,1017-1020`
- Modify: `frontend/src/takeover/instantMission.ts:81-107`
- Modify: `frontend/src/panels/HandoffCard.tsx`

No unit test (React/integration); verify with a clean `tsc` + build. The pure pieces it depends on (Tasks 2–4) are already unit-tested.

**Interfaces:**
- Consumes: `shouldFaceApproach`/`setFaceApproach` (Task 3), `spawnHeadingDeg` (Task 4), `finalApproachFix` (`mission/guidanceGeometry.ts`, from #88), `initialBearingDeg` (`mission/geo.ts`).

- [ ] **Step 1: instantMission — apply the override when facing the approach**

In `takeover/instantMission.ts`, add `faceApproach?: boolean` to `InstantMissionOptions` (default treated as `true`). Compute the bearing and pass it into the spawn (the pure function stays pure — it reads the flag from `opts`, not from storage):

```ts
  const assignment = airportAssignment(contact, airport);
  const faceApproach = opts.faceApproach ?? true;
  const spawnHeadingDeg = faceApproach
    ? (() => {
        const faf = finalApproachFix(assignment, profile.guidance);
        return initialBearingDeg(contact.lat, contact.lon, faf.point.latDeg, faf.point.lonDeg);
      })()
    : undefined;
  const spawn = buildLockedMissionSpawn(contact, classId, params, { terrainHeightM: null, spawnHeadingDeg });
```

Import `finalApproachFix` from `../mission/guidanceGeometry` and `initialBearingDeg` from `../mission/geo`. The `startInstantFlight` store action / caller that builds the instant mission should read `shouldFaceApproach(window.localStorage)` and pass it as `opts.faceApproach` (locate the caller of `buildInstantMission` and thread the flag; if the caller has no storage access, default `true` is correct).

- [ ] **Step 2: FlightSession — toggle state + persistence**

Add near the other `useState` (around FlightSession.tsx:112), importing the pref module:

```tsx
  const [faceApproach, setFaceApproachState] = useState(() =>
    shouldFaceApproach(typeof window === "undefined" ? null : window.localStorage));
  const toggleFaceApproach = useCallback((enabled: boolean) => {
    try { setFaceApproach(localStorage, enabled); } catch { /* storage unavailable — apply for this session */ }
    setFaceApproachState(enabled);
  }, []);
```

- [ ] **Step 3: FlightSession — compute the FAF bearing in the spawn effect**

In the COUNTDOWN spawn effect (FlightSession.tsx:320-370), before `buildLockedMissionSpawn`, compute the override — only for real/tutorial missions (NOT free flight), when the toggle is on:

```tsx
      const spawnHeadingDeg =
        faceApproach && freeFlight === null
          ? (() => {
              const faf = finalApproachFix(lockedMission.assignment, lockedMission.missionProfile.guidance);
              return initialBearingDeg(contact.lat, contact.lon, faf.point.latDeg, faf.point.lonDeg);
            })()
          : undefined;
      const built = buildLockedMissionSpawn(
        contact,
        lockedMission.classId,
        params,
        {
          terrainHeightM: preload.terrainHeightM,
          spawnHeadingDeg,
          ...(tutorial === null
            ? {}
            : { initialFlapDetent: params.flaps.length - 1, initialGearDown: true }),
        },
      );
      setSpawn(built);
```

Add `faceApproach` to the effect dependency array (FlightSession.tsx:554-562) so toggling rebuilds the spawn and the card's HEADING readout updates live. Import `finalApproachFix` (`../mission/guidanceGeometry`) and `initialBearingDeg` (`../mission/geo`).

> Do NOT touch the RE-SYNC re-spawn at FlightSession.tsx:661-668 — it must keep the live track (no `spawnHeadingDeg`).

- [ ] **Step 4: FlightSession — pass new props to HandoffCard**

Update the render (FlightSession.tsx:1017-1020):

```tsx
      {mode === "COUNTDOWN" && lockedMission && (
        <HandoffCard contact={lockedMission.contact} spawn={spawn} params={originParams}
          matched={originResolution?.matched ?? false} countdown={countdown} note={note}
          assignment={lockedMission.assignment}
          faceApproach={faceApproach} onToggleFaceApproach={toggleFaceApproach} />
      )}
```

- [ ] **Step 5: HandoffCard — checkbox + destination row**

In `panels/HandoffCard.tsx`, extend the props type:

```tsx
  assignment,
  faceApproach,
  onToggleFaceApproach,
}: {
  contact: Contact;
  spawn: SpawnResult | null;
  params: ClassParams | null;
  matched: boolean;
  countdown: number | null;
  note: string;
  assignment: RunwayAssignment | null;
  faceApproach: boolean;
  onToggleFaceApproach: (enabled: boolean) => void;
}) {
```

Add a DESTINATION `Row` after the HEADING row:

```tsx
      <Row label="DESTINATION" value={assignment === null ? EM_DASH : `${assignment.airportIdent} RWY ${assignment.runwayEndIdent} · ${assignment.distanceNm.toFixed(1)} NM`} />
```

Add the checkbox between the disclosure block and the ADJUSTMENTS title (terminal style, reusing existing classes; a plain `<label>` is fine):

```tsx
      <label className="handoff-row handoff-toggle">
        <span className="label">HEADING → APPROACH</span>
        <input type="checkbox" checked={faceApproach} onChange={(e) => onToggleFaceApproach(e.target.checked)} />
      </label>
```

Import `RunwayAssignment` from the mission types. If `handoff-toggle` needs any styling it can reuse `handoff-row`; add a minimal rule to the card's CSS only if the checkbox is visually broken.

- [ ] **Step 6: Verify build**

Run: `cd frontend && npx tsc --noEmit` → clean.
Run: `cd frontend && npm run build` → succeeds.
Run: `cd frontend && npx vitest run src/mission src/takeover` → all green (Tasks 2–4 unchanged).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/game/FlightSession.tsx frontend/src/takeover/instantMission.ts frontend/src/panels/HandoffCard.tsx
git commit -m "feat(takeover): spawn facing the FAF (default-on toggle) + destination on handoff card"
```

---

## Final verification

- [ ] Units green: `cd frontend && npx vitest run src/mission src/takeover`
- [ ] Build clean: `cd frontend && npm run build`
- [ ] Manual run (owner, traffic-enabled env): take a contact — spawn points at the FAF; handoff card shows DESTINATION distance + a checked HEADING → APPROACH box; unchecking it rebuilds the spawn to the live track (HEADING readout changes) and adds/removes the HEADING adjustment; the assigned airport lands in the sweet-spot distance band.
- [ ] Append a dated entry to `docs/decisions.md`: sweet-spot band (per-profile knobs + weights), spawn-heading-to-FAF default-on toggle, #87 spawn seam + ranked-neutral boundary.
- [ ] Push branch, open PR, show it running, stop for sign-off.

## Out of scope

- Full skip-to-approach reposition and time compression (issue #87).
- Ranked-mission eligibility changes.
- Applying the override to free flight or RE-SYNC.
