# Spawn Chooser Implementation Plan (Feature 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 4-way spawn chooser at takeover — pure-real, lined-up-in-place (face FAF), one-turn base leg, on-final — where the two repositioning modes teleport the SIM aircraft and mark the flight unranked (client-side, no backend).

**Architecture:** Extend #90's `spawnHeadingDeg` seam in the pure `takeover/spawn.ts` to full position/altitude/speed overrides; a new pure `mission/spawnPlacement.ts` computes the base-leg + on-final points from existing geometry; a 4-valued preference replaces #90's boolean; `FlightSession` branches the spawn build on the mode and short-circuits `onEnd` to a local unranked debrief for repositioned flights; `HandoffCard` gets a 4-option selector.

**Tech Stack:** Vite · React 18 + TS · Zustand · Vitest 4.

## Global Constraints

- Only the SIM aircraft is repositioned; the genuine aircraft's ghost stays on the live feed. No ADS-B feed data synthesized (ground rule #1).
- Every reposition is disclosed on the handoff card ADJUSTMENTS list (position/altitude/speed/heading), same rule the spawn builder already applies.
- `mission/` and `takeover/spawn.ts` stay Cesium-free, pure, unit-testable.
- No new dependencies. No server/worker/signing changes (unranked is client-side).
- Ranked semantics: `real` + `faceApproach` stay ranked (position untouched); `base` + `final` are unranked.
- Test command (from `frontend/`): `npx vitest run src/mission src/takeover`. Full suite: `npm run test:unit`. Build: `npm run build`.

---

## File structure

- `mission/types.ts`, `mission/profiles/*.json`, `mission/profiles.ts` — base-leg knobs.
- `mission/spawnPlacement.ts` (new, + test) — `onFinalPlacement`, `baseLegPlacement`.
- `takeover/spawn.ts` (+ test) — position/altitude/speed/vertical-rate overrides + disclosures.
- `takeover/spawnModePreference.ts` (new, replaces `headingToFafPreference.ts`) (+ test).
- `state/store.ts` — `repositioned` flag.
- `game/FlightSession.tsx` — spawnMode state, branch both build sites, unranked `onEnd` short-circuit.
- `takeover/instantMission.ts`, `App.tsx` — swap the pref (mechanical).
- `panels/HandoffCard.tsx` — 4-option selector + UNRANKED note.
- `debrief/*` (EndCard/types) — repositioned unranked disclosure.

---

### Task 1: Base-leg guidance knobs

**Files:** `mission/types.ts:95-101` · `mission/profiles/{c172s,b738,f5e,biz,tprop}.json` · `mission/profiles.ts` · test: `profiles.test.ts`

**Interfaces:**
- Produces: `MissionProfile["guidance"].baseLegOffsetNm: number`, `.baseLegOffsetDeg: number`.

- [ ] **Step 1: Add the fields to the guidance type**

In `types.ts`, append to the `guidance` object type (after `finalApproachFixNm`):
```ts
    finalApproachFixNm: number;
    baseLegOffsetNm: number;
    baseLegOffsetDeg: number;
```

- [ ] **Step 2: Add values to all five profile JSONs**

Add to each profile's `guidance` block: `"baseLegOffsetNm": 3, "baseLegOffsetDeg": 45` (same for all five v1; tunable).

- [ ] **Step 3: Update the validator**

In `profiles.ts`, find the `guidance` field-name list (sibling to the `rankingNames` list from #88/#90) and add `"baseLegOffsetNm"` and `"baseLegOffsetDeg"`; ensure the finite-positive/non-negative assert loop covers them (offset NM positive, offset deg non-negative).

- [ ] **Step 4: Run the profile tests**

Run: `cd frontend && npx vitest run src/mission/profiles.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/mission/types.ts frontend/src/mission/profiles.ts frontend/src/mission/profiles/
git commit -m "feat(mission): base-leg entry guidance knobs"
```

---

### Task 2: Reposition placement geometry

**Files:** `mission/spawnPlacement.ts` (new) · test: `mission/spawnPlacement.test.ts`

**Interfaces:**
- Consumes: `finalApproachFix`, `positionAlongApproach`, `glideSlopeAltitudeFt` (guidanceGeometry.ts); `destinationPoint`, `initialBearingDeg` (geo.ts); `MissionProfile`, `RunwayAssignment`.
- Produces: `type Placement = { latDeg: number; lonDeg: number; altitudeFt: number; headingDeg: number; speedKt: number }`; `onFinalPlacement(assignment, profile): Placement`; `baseLegPlacement(assignment, profile): Placement`.

- [ ] **Step 1: Write the failing tests**

Create `spawnPlacement.test.ts` (reuse a `RunwayAssignment` fixture like `guidanceGeometry.test.ts` builds; profile via `missionProfileForClass("c172s")`):
```ts
import { describe, expect, it } from "vitest";
import { onFinalPlacement, baseLegPlacement } from "./spawnPlacement";
import { finalApproachFix, glideSlopeAltitudeFt } from "./guidanceGeometry";
import { greatCircleDistanceNm, headingDeltaDeg, initialBearingDeg } from "./geo";
import { missionProfileForClass } from "./profiles";
// ...assignment fixture (copy from guidanceGeometry.test.ts)...

describe("onFinalPlacement", () => {
  it("sits at the FAF, on-slope, runway heading, approach speed", () => {
    const profile = missionProfileForClass("c172s");
    const p = onFinalPlacement(assignment, profile);
    const faf = finalApproachFix(assignment, profile.guidance);
    expect(p.latDeg).toBeCloseTo(faf.point.latDeg, 9);
    expect(p.lonDeg).toBeCloseTo(faf.point.lonDeg, 9);
    expect(p.altitudeFt).toBeCloseTo(faf.altitudeFt, 6);
    expect(p.headingDeg).toBeCloseTo(assignment.runwayHeadingDeg, 6);
    expect(p.speedKt).toBe(profile.approach.targetSpeedKt);
  });
});

describe("baseLegPlacement", () => {
  it("is offset from the FAF and points at it", () => {
    const profile = missionProfileForClass("c172s");
    const p = baseLegPlacement(assignment, profile);
    const faf = finalApproachFix(assignment, profile.guidance);
    // offset ~baseLegOffsetNm from the FAF
    const d = greatCircleDistanceNm(p.latDeg, p.lonDeg, faf.point.latDeg, faf.point.lonDeg);
    expect(d).toBeGreaterThan(0.5);
    // heading points at the FAF
    const toFaf = initialBearingDeg(p.latDeg, p.lonDeg, faf.point.latDeg, faf.point.lonDeg);
    expect(headingDeltaDeg(p.headingDeg, toFaf)).toBeLessThan(1);
    expect(p.speedKt).toBe(profile.approach.targetSpeedKt);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/mission/spawnPlacement.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `spawnPlacement.ts`:
```ts
import { destinationPoint, initialBearingDeg } from "./geo";
import { finalApproachFix } from "./guidanceGeometry";
import type { MissionProfile, RunwayAssignment } from "./types";

export type Placement = {
  latDeg: number; lonDeg: number; altitudeFt: number; headingDeg: number; speedKt: number;
};

export function onFinalPlacement(assignment: RunwayAssignment, profile: MissionProfile): Placement {
  const faf = finalApproachFix(assignment, profile.guidance);
  return {
    latDeg: faf.point.latDeg,
    lonDeg: faf.point.lonDeg,
    altitudeFt: faf.altitudeFt,
    headingDeg: faf.headingDeg,
    speedKt: profile.approach.targetSpeedKt,
  };
}

export function baseLegPlacement(assignment: RunwayAssignment, profile: MissionProfile): Placement {
  const faf = finalApproachFix(assignment, profile.guidance);
  // A base-leg entry: offset from the FAF along the outbound reciprocal, swung out by the base angle,
  // so that flying toward the FAF and one turn rolls onto final.
  const outbound = faf.headingDeg + 180;
  const entry = destinationPoint(
    faf.point.latDeg, faf.point.lonDeg,
    outbound + profile.guidance.baseLegOffsetDeg,
    profile.guidance.baseLegOffsetNm,
  );
  return {
    latDeg: entry.latDeg,
    lonDeg: entry.lonDeg,
    altitudeFt: faf.altitudeFt,
    headingDeg: initialBearingDeg(entry.latDeg, entry.lonDeg, faf.point.latDeg, faf.point.lonDeg),
    speedKt: profile.approach.targetSpeedKt,
  };
}
```

- [ ] **Step 4: Run the tests** — `cd frontend && npx vitest run src/mission/spawnPlacement.test.ts` → PASS; also `npx vitest run src/mission` green.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/mission/spawnPlacement.ts frontend/src/mission/spawnPlacement.test.ts
git commit -m "feat(mission): base-leg + on-final spawn placement geometry"
```

---

### Task 3: Spawn position/altitude/speed overrides

**Files:** `takeover/spawn.ts` (+ `spawn.test.ts`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildSpawnState`/`buildLockedMissionSpawn` opts gain `spawnPositionOverride?: { latDeg: number; lonDeg: number }`, `spawnAltitudeFtOverride?: number`, `spawnSpeedKtOverride?: number`, `spawnVerticalRateFpmOverride?: number` (all in addition to the existing `spawnHeadingDeg?`). Each applied via `??` and disclosed.

- [ ] **Step 1: Write the failing test**

Add to `spawn.test.ts` (reuse the file's `contact`/`params` fixtures):
```ts
describe("full spawn override", () => {
  it("moves position/altitude/speed and discloses each", () => {
    const over = buildSpawnState(contact, params, {
      terrainHeightM: null,
      spawnPositionOverride: { latDeg: contact.lat + 0.2, lonDeg: contact.lon + 0.2 },
      spawnAltitudeFtOverride: 2500,
      spawnSpeedKtOverride: 90,
      spawnHeadingDeg: 90,
    });
    const fields = over.adjustments.map((a) => a.field);
    expect(fields).toContain("POSITION");
    expect(fields).toContain("ALTITUDE");
    expect(fields).toContain("SPEED");
    // altitude actually applied (state carries metres; ~2500 ft)
    expect(over.state.altitudeM).toBeCloseTo(2500 * 0.3048, 0);
  });
  it("omitting overrides is unchanged", () => {
    const base = buildSpawnState(contact, params, { terrainHeightM: null });
    expect(base.adjustments.some((a) => ["POSITION","ALTITUDE","SPEED"].includes(a.field))).toBe(false);
  });
});
```
(Confirm the `SpawnResult.state` exposes `altitudeM`; if the field name differs, assert via `hprFromQuat`/position or the derived readouts the file already exposes.)

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/takeover/spawn.test.ts -t "full spawn override"` → FAIL.

- [ ] **Step 3: Implement**

In `buildSpawnState` (and add the same opt keys to both opts types), replace the position/altitude/speed/vertical-rate sources with override-aware versions and disclose each:
```ts
  // position
  const spawnLatDeg = opts.spawnPositionOverride?.latDeg ?? contact.lat;
  const spawnLonDeg = opts.spawnPositionOverride?.lonDeg ?? contact.lon;
  if (opts.spawnPositionOverride) {
    adjustments.push({ field: "POSITION",
      from: `${contact.lat.toFixed(3)},${contact.lon.toFixed(3)}`,
      to: `${spawnLatDeg.toFixed(3)},${spawnLonDeg.toFixed(3)}`,
      reason: "Repositioned onto the approach for takeover setup (unranked)." });
  }
  const latRad = degToRad(spawnLatDeg);
  const lonRad = degToRad(spawnLonDeg);
```
Apply the same `?? default` + disclosure pattern for `altitudeM` (from `spawnAltitudeFtOverride` via `ftToM`), `snapshotKt`/`tasMs` (from `spawnSpeedKtOverride`), and `verticalSpeedMs` (from `spawnVerticalRateFpmOverride`). Reuse the exact unit helpers already imported in the file (`ftToM`/`mToFt`, `ktToMs`/`msToKt`, `fpmToMs`). Keep the existing HEADING block. The `position = geodeticToEcef(latRad, lonRad, altitudeM)` line then uses the overridden values with no further change.

- [ ] **Step 4: Run the tests** — `npx vitest run src/takeover/spawn.test.ts` → PASS (new + all existing spawn tests, since omitting overrides is unchanged).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/takeover/spawn.ts frontend/src/takeover/spawn.test.ts
git commit -m "feat(takeover): position/altitude/speed spawn overrides with disclosures"
```

---

### Task 4: Spawn-mode preference (replaces heading-to-FAF pref)

**Files:** `takeover/spawnModePreference.ts` (new) · test · (old `headingToFafPreference.ts` stays until Task 6 swaps its consumers, then is deleted there)

**Interfaces:**
- Produces: `type SpawnMode = "real" | "faceApproach" | "base" | "final"`; `readSpawnMode(storage | null): SpawnMode` (default `"faceApproach"`, with migration); `writeSpawnMode(storage, mode): void`; `SPAWN_MODE_STORAGE_KEY = "adsb.spawn-mode.v1"`; `isRepositionMode(mode): boolean` (true for `base`/`final`).

- [ ] **Step 1: Write the failing test**

Create `spawnModePreference.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readSpawnMode, writeSpawnMode, isRepositionMode, SPAWN_MODE_STORAGE_KEY } from "./spawnModePreference";

function mem(init: Record<string,string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), _m: m };
}
describe("spawnModePreference", () => {
  it("defaults to faceApproach when unset or null", () => {
    expect(readSpawnMode(null)).toBe("faceApproach");
    expect(readSpawnMode(mem())).toBe("faceApproach");
  });
  it("round-trips each mode", () => {
    const s = mem();
    for (const mode of ["real","faceApproach","base","final"] as const) {
      writeSpawnMode(s, mode); expect(readSpawnMode(s)).toBe(mode);
    }
  });
  it("migrates the old heading-to-FAF key", () => {
    expect(readSpawnMode(mem({ "adsb.handoff-heading-to-faf.v1": "off" }))).toBe("real");
    expect(readSpawnMode(mem({ "adsb.handoff-heading-to-faf.v1": "on" }))).toBe("faceApproach");
  });
  it("flags reposition modes", () => {
    expect(isRepositionMode("base")).toBe(true);
    expect(isRepositionMode("final")).toBe(true);
    expect(isRepositionMode("real")).toBe(false);
    expect(isRepositionMode("faceApproach")).toBe(false);
  });
  it("returns default when getItem throws", () => {
    expect(readSpawnMode({ getItem: () => { throw new Error("x"); } })).toBe("faceApproach");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/takeover/spawnModePreference.test.ts` → FAIL.

- [ ] **Step 3: Implement**
```ts
export const SPAWN_MODE_STORAGE_KEY = "adsb.spawn-mode.v1";
const LEGACY_KEY = "adsb.handoff-heading-to-faf.v1";
export type SpawnMode = "real" | "faceApproach" | "base" | "final";
const MODES: SpawnMode[] = ["real", "faceApproach", "base", "final"];

export function isRepositionMode(mode: SpawnMode): boolean {
  return mode === "base" || mode === "final";
}
export function readSpawnMode(storage: Pick<Storage, "getItem"> | null): SpawnMode {
  if (storage === null) return "faceApproach";
  try {
    const v = storage.getItem(SPAWN_MODE_STORAGE_KEY);
    if (v && (MODES as string[]).includes(v)) return v as SpawnMode;
    const legacy = storage.getItem(LEGACY_KEY);       // migrate #90's boolean
    if (legacy === "off") return "real";
    return "faceApproach";
  } catch { return "faceApproach"; }
}
export function writeSpawnMode(storage: Pick<Storage, "setItem">, mode: SpawnMode): void {
  storage.setItem(SPAWN_MODE_STORAGE_KEY, mode);
}
```

- [ ] **Step 4: Run the tests** — `npx vitest run src/takeover/spawnModePreference.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/takeover/spawnModePreference.ts frontend/src/takeover/spawnModePreference.test.ts
git commit -m "feat(takeover): 4-way spawn-mode preference with #90 migration"
```

---

### Task 5: Unranked flagging for repositioned flights

**Files:** `state/store.ts` · `game/FlightSession.tsx:475-525` · `debrief/types.ts` + `debrief/EndCard.tsx`

**Interfaces:**
- Consumes: `isRepositionMode` (Task 4).
- Produces: store `repositioned: boolean` + setter; `onEnd` short-circuits repositioned flights to a local unranked debrief.

- [ ] **Step 1: Add the store flag**

In `state/store.ts`, beside the existing `freeFlight`/`instantFlight` flags (store.ts:~139), add `repositioned: boolean` (default `false`) and a setter (mirror the existing flag's action). Reset it to `false` where `freeFlight`/`instantFlight` are reset on mission start.

- [ ] **Step 2: Short-circuit onEnd**

In `FlightSession.tsx` `onEnd` (`:475-525`), read `repositioned` from the store (next to `freeFlight`/`instantFlight` at `:100-103`) and add a branch BEFORE the ranked submit path (mirror the `freeFlight` branch at `:477`):
```tsx
      if (repositioned) {
        // Repositioned spawn skipped part of the route — local, unranked, never submitted.
        setDebrief({ status: "unavailable", message: "REPOSITIONED — LOCAL AND UNRANKED. NO RESULT SUBMITTED." });
        return;
      }
```
Place it after the `freeFlight`/`instantFlight`/`tutorial` checks (any of those already short-circuit; this covers a normal locked mission that was repositioned). If a dedicated debrief status reads cleaner than reusing `"unavailable"`, add a `"repositioned"` status to `debrief/types.ts` and a matching disclosure line in `EndCard.tsx` (mirroring the instant/tutorial `LOCAL AND UNRANKED` banner at EndCard.tsx:136-147).

- [ ] **Step 3: Build + verify**

Run: `cd frontend && npx tsc --noEmit` (clean) and `npm run build` (succeeds). If a store unit test exists for flags, add one asserting `repositioned` resets on mission start; otherwise verify by the build + the run in Task 6.

- [ ] **Step 4: Commit**
```bash
git add frontend/src/state/store.ts frontend/src/game/FlightSession.tsx frontend/src/debrief/
git commit -m "feat(flight): repositioned flights are local + unranked (no result submitted)"
```

---

### Task 6: Chooser UI + wire spawn modes

**Files:** `game/FlightSession.tsx` · `panels/HandoffCard.tsx` · `takeover/instantMission.ts` · `App.tsx` · delete `takeover/headingToFafPreference.ts`

No unit test (React/integration); verify with `tsc` + `npm run build` + `npm run test:unit`. Pure pieces (Tasks 2–4) are already unit-tested.

**Interfaces:**
- Consumes: `SpawnMode`/`readSpawnMode`/`writeSpawnMode`/`isRepositionMode` (Task 4), `onFinalPlacement`/`baseLegPlacement` (Task 2), the spawn overrides (Task 3), the `repositioned` store flag (Task 5).

- [ ] **Step 1: FlightSession — replace faceApproach with spawnMode**

Swap the `faceApproach` boolean state + ref (`FlightSession.tsx:118-128`) for `spawnMode` state (init `readSpawnMode(window.localStorage guard)`) + `spawnModeRef` + a `setSpawnMode` callback that persists via `writeSpawnMode` and updates state. Delete the `headingToFafPreference` import.

- [ ] **Step 2: FlightSession — branch both spawn-build sites**

At the initial COUNTDOWN effect (`:382-400`, using `spawnModeRef.current`) and the decoupled reaction effect (`:602-625`, using `spawnMode`), replace the `spawnHeadingDeg`-only computation with a mode branch that builds the override opts and sets the store `repositioned` flag:
```tsx
      const mode = spawnModeRef.current; // (spawnMode in the reaction effect)
      let overrideOpts: Partial<Parameters<typeof buildLockedMissionSpawn>[3]> = {};
      if (!freeFlight) {
        if (mode === "faceApproach") {
          const faf = finalApproachFix(lockedMission.assignment, lockedMission.missionProfile.guidance);
          overrideOpts = { spawnHeadingDeg: initialBearingDeg(contact.lat, contact.lon, faf.point.latDeg, faf.point.lonDeg) };
        } else if (mode === "base" || mode === "final") {
          const place = mode === "final"
            ? onFinalPlacement(lockedMission.assignment, lockedMission.missionProfile)
            : baseLegPlacement(lockedMission.assignment, lockedMission.missionProfile);
          overrideOpts = {
            spawnPositionOverride: { latDeg: place.latDeg, lonDeg: place.lonDeg },
            spawnAltitudeFtOverride: place.altitudeFt,
            spawnSpeedKtOverride: place.speedKt,
            spawnHeadingDeg: place.headingDeg,
            ...(mode === "final" ? { initialGearDown: true, initialFlapDetent: params.flaps.length - 1 } : {}),
          };
        }
      }
      setRepositioned(!freeFlight && (mode === "base" || mode === "final"));
      const built = buildLockedMissionSpawn(contact, lockedMission.classId, params, {
        terrainHeightM: preload.terrainHeightM, ...overrideOpts,
        ...(tutorial === null ? {} : { initialFlapDetent: params.flaps.length - 1, initialGearDown: true }),
      });
      setSpawn(built);
```
Import `onFinalPlacement`/`baseLegPlacement` from `../mission/spawnPlacement`, keep `finalApproachFix`/`initialBearingDeg`. Preserve the ref-vs-state distinction between the two effects (the reaction effect keeps `spawnMode` as its only dep, per #90's fix).

- [ ] **Step 3: HandoffCard — 4-option selector**

Replace the props `faceApproach`/`onToggleFaceApproach` with `spawnMode: SpawnMode` + `onSpawnModeChange: (m: SpawnMode) => void`. Swap the checkbox (`HandoffCard.tsx:79-84`) for a 4-button segmented control (reuse `handoff-row` styling), and show an UNRANKED note when `isRepositionMode(spawnMode)`:
```tsx
{!freeFlight && (
  <div className="handoff-row handoff-spawnmode">
    <span className="label">SPAWN</span>
    <span className="spawnmode-opts">
      {(["real","faceApproach","base","final"] as const).map((m) => (
        <button key={m} type="button" className={spawnMode === m ? "sel" : ""}
          onClick={() => onSpawnModeChange(m)}>
          {{real:"REAL",faceApproach:"LINE UP",base:"1 TURN",final:"ON FINAL"}[m]}
        </button>
      ))}
    </span>
  </div>
)}
{!freeFlight && isRepositionMode(spawnMode) && (
  <div className="handoff-note">REPOSITIONED · LOCAL & UNRANKED</div>
)}
```
Add minimal CSS for `.handoff-spawnmode` buttons in the card's stylesheet (small monospace, amber selected, 1px). Pass `spawnMode`/`onSpawnModeChange` from `FlightSession.tsx`'s `<HandoffCard>` render (`:1080-1086`).

- [ ] **Step 4: instantMission + App — swap the pref (mechanical)**

`instantMission.ts` currently takes `faceApproach?: boolean`; change it to `spawnMode?: SpawnMode` and, inside, build the same `overrideOpts` (faceApproach heading, or base/final placement) before `buildLockedMissionSpawn`. In `App.tsx` (both `buildInstantMission` call sites) pass `spawnMode: readSpawnMode(window.localStorage)` instead of `faceApproach: …`. (Instant flight is already unranked, so no `repositioned` flag needed there.) Delete `takeover/headingToFafPreference.ts` and its test once no imports remain (grep to confirm).

- [ ] **Step 5: Verify**

Run: `cd frontend && npx tsc --noEmit` (clean), `npm run build` (succeeds), `npm run test:unit` (full suite green — confirms the deleted pref + swapped consumers didn't break `HandoffCard.test.tsx` etc.; update any test that referenced `faceApproach`/`onToggleFaceApproach`).

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(takeover): 4-way spawn chooser (real/line-up/one-turn/on-final) + unranked note"
```

---

## Final verification

- [ ] Units: `cd frontend && npx vitest run src/mission src/takeover` green.
- [ ] Full suite: `npm run test:unit` green (catches HandoffCard/pref consumers).
- [ ] Build: `npm run build` clean.
- [ ] Manual (owner, prod): all four options selectable on the card; `1 TURN`/`ON FINAL` reposition the SIM aircraft (ghost stays put), show the reposition adjustments + UNRANKED note, and end in a local unranked debrief with no result submitted; `REAL`/`LINE UP` still rank normally; changing the choice doesn't restart the countdown.
- [ ] Append a dated entry to `docs/decisions.md`: 4-way chooser, reposition via spawn overrides, client-side unranked (no backend), base-leg geometry, #87 skip-core shipped.
- [ ] Push branch, open PR, deploy to prod for the owner live pass, stop for sign-off.

## Out of scope

- Curved corridor ribbon + menu toggle (Feature 2).
- Time compression / non-reposition #87 scope.
- Server-side ranked schema changes.
