# Approach Guidance (Surface + PAPI + Route Clip) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the corridor edge-lines with a flyable tapering glide-slope surface (#24), add real 4-light PAPI at every assist level (#23), clip the mission route line to the remaining path (#50), and wire the already-salvaged approach warnings into the mobile HUD.

**Architecture:** All new geometry/logic is pure TypeScript in `frontend/src/mission/` (no Cesium imports, unit-tested). Cesium rendering stays in thin `frontend/src/globe/*Layer.tsx` components using the entity API + `CallbackProperty` (no per-frame entity churn). Spec: `docs/superpowers/specs/2026-08-12-approach-guidance-design.md`.

**Tech Stack:** Vite · React 18 + TypeScript · CesiumJS (keyless) · vitest. Test runner: `cd frontend && npx vitest run <file>`.

## Global Constraints

- **No new dependencies** (spec §14 approved list; acceptance §9.3).
- **Honest data:** surface/PAPI derive ONLY from the locked mission's frozen assignment + guidance profile. `runwayWidthFt` not > 0 → fall back to `guidance.corridorWidthFt` (a real profile value), never a guess. No PAPI at non-mission airports. Null `hudSnapshot` → PAPI lights render DIMGRAY (unknown), never a fabricated on-slope white/red.
- **Look:** terminal language — surface cyan `Color.CYAN.withAlpha(0.15)`, no glow/gradient; PAPI white `#ffffff` / red `#ff3b30`, 1px black outline; nothing new on the HUD.
- **PAPI thresholds:** `glideSlopeDeg + (−0.5, −0.2, +0.2, +0.5)°`; light is WHITE when the aircraft's elevation angle exceeds its threshold; on-slope = `[true, true, false, false]` (2W2R).
- **Gating:** surface/gates/flare only when `assistFeatures(assist).approachCorridor` (FULL). PAPI mounts OUTSIDE the assist gate — any locked mission, any assist level, `mode !== "ENDED"`.
- **Pure modules must not import Cesium.** Tests must not import Cesium.
- Existing pure API `approachGuidance()` keeps its shape (gates + flare still consumed); only the layer stops drawing `corridorEdges`.
- Commit after every task; suite must be green at every commit.
- All commands run from `frontend/`.

---

### Task 1: `approachSurface()` + `surfaceQuads()` (pure geometry)

**Files:**
- Modify: `frontend/src/mission/guidanceGeometry.ts`
- Test: `frontend/src/mission/guidanceGeometry.test.ts` (extend existing file)

**Interfaces:**
- Consumes: existing `destinationPoint` (from `./geo`), existing private helpers `point()`, `runwayElevationFt()`, constant `FEET_PER_NM`, types `GuidancePoint`, `GuidanceSegment`, `RunwayAssignment`, `MissionProfile["guidance"]`.
- Produces: `approachSurface(assignment: RunwayAssignment, guidance: MissionProfile["guidance"]): GuidanceSegment[]` (cross-sections from threshold d=0 out to d=approachLengthNm, width linearly tapered runway-width→corridor-width) and `surfaceQuads(sections: GuidanceSegment[]): GuidancePoint[][]` (4-corner rings between consecutive sections, `[near.left, far.left, far.right, near.right]`). Task 3 renders these.

- [ ] **Step 1: Write the failing tests** — append to `frontend/src/mission/guidanceGeometry.test.ts`. Reuse the file's existing fixture style; if it has no `RunwayAssignment` fixture, add this one (copied from `hud/approachAlerts.test.ts`):

```typescript
import { describe, expect, it } from "vitest";
import { approachGuidance, approachSurface, surfaceQuads } from "./guidanceGeometry";
import { greatCircleDistanceNm } from "./geo";
import { missionProfileForClass } from "../mission/profiles";
import type { RunwayAssignment } from "./types";

const FEET_PER_NM = 6076.11549;

const assignment: RunwayAssignment = {
  airportIdent: "KTST",
  airportName: "Test Field",
  airportLatDeg: 0,
  airportLonDeg: 0,
  airportElevationFt: 100,
  runwayId: "01/19",
  runwayIdent: "01/19",
  runwayEndIdent: "01",
  runwayHeadingDeg: 0,
  runwayLengthFt: 5000,
  runwayWidthFt: 100,
  runwaySurface: "HARD",
  runwayLighted: true,
  assignedEnd: {
    ident: "01",
    latDeg: 0,
    lonDeg: 0,
    elevationFt: 100,
    headingDeg: 0,
    displacedThresholdFt: 0,
  },
  distanceNm: 8,
  estimatedMinutes: 5,
  suitability: 1,
};

const guidance = missionProfileForClass("c172s").guidance;

function widthFt(section: { left: { latDeg: number; lonDeg: number }; right: { latDeg: number; lonDeg: number } }): number {
  return greatCircleDistanceNm(
    section.left.latDeg, section.left.lonDeg,
    section.right.latDeg, section.right.lonDeg,
  ) * FEET_PER_NM;
}

describe("approachSurface", () => {
  it("tapers linearly from runway width at the threshold to corridor width at the far end", () => {
    const sections = approachSurface(assignment, guidance);
    expect(widthFt(sections[0])).toBeCloseTo(assignment.runwayWidthFt, 0);
    expect(widthFt(sections[sections.length - 1])).toBeCloseTo(guidance.corridorWidthFt, 0);
    const midDistanceNm = guidance.approachLengthNm / 2;
    const expectedMidFt =
      assignment.runwayWidthFt +
      (guidance.corridorWidthFt - assignment.runwayWidthFt) * 0.5;
    // find the section closest to the midpoint and check interpolation there
    const spacingCount = Math.round(midDistanceNm / guidance.gateSpacingNm);
    const mid = sections[spacingCount];
    const midT = (spacingCount * guidance.gateSpacingNm) / guidance.approachLengthNm;
    const expectedAtMidSection =
      assignment.runwayWidthFt +
      (guidance.corridorWidthFt - assignment.runwayWidthFt) * midT;
    expect(widthFt(mid)).toBeCloseTo(expectedAtMidSection, 0);
    expect(expectedMidFt).toBeGreaterThan(assignment.runwayWidthFt); // sanity: taper is real
  });

  it("falls back to constant corridor width when the runway width is missing (0)", () => {
    const noWidth = { ...assignment, runwayWidthFt: 0 };
    const sections = approachSurface(noWidth, guidance);
    expect(widthFt(sections[0])).toBeCloseTo(guidance.corridorWidthFt, 0);
    expect(widthFt(sections[sections.length - 1])).toBeCloseTo(guidance.corridorWidthFt, 0);
  });

  it("lies exactly on the glide slope the gates mark (altitude continuity)", () => {
    const sections = approachSurface(assignment, guidance);
    const slope = Math.tan((guidance.glideSlopeDeg * Math.PI) / 180);
    sections.forEach((section, i) => {
      const distanceNm = Math.min(i * guidance.gateSpacingNm, guidance.approachLengthNm);
      const expected = 100 + slope * distanceNm * FEET_PER_NM;
      expect(section.left.altitudeFt).toBeCloseTo(expected, 6);
      expect(section.right.altitudeFt).toBeCloseTo(expected, 6);
    });
    // gates from the existing guidance ride ON the surface by construction
    const { gates } = approachGuidance(assignment, guidance);
    const gateAltitudes = gates.map((gate) => gate.left.altitudeFt);
    const sectionAltitudes = sections.map((section) => section.left.altitudeFt);
    for (const alt of gateAltitudes) {
      expect(sectionAltitudes.some((sectionAlt) => Math.abs(sectionAlt - alt) < 1e-6)).toBe(true);
    }
  });

  it("handles a legitimately negative runway elevation", () => {
    const belowSea = {
      ...assignment,
      assignedEnd: { ...assignment.assignedEnd, elevationFt: -14 },
    };
    const sections = approachSurface(belowSea, guidance);
    expect(sections[0].left.altitudeFt).toBeCloseTo(-14, 6);
  });

  it("always includes the far edge at exactly approachLengthNm", () => {
    const odd = { ...guidance, approachLengthNm: guidance.gateSpacingNm * 3.5 };
    const sections = approachSurface(assignment, odd);
    const slope = Math.tan((odd.glideSlopeDeg * Math.PI) / 180);
    const last = sections[sections.length - 1];
    expect(last.left.altitudeFt).toBeCloseTo(100 + slope * odd.approachLengthNm * FEET_PER_NM, 6);
  });
});

describe("surfaceQuads", () => {
  it("builds one 4-corner ring per consecutive section pair, wound near-left → far-left → far-right → near-right", () => {
    const sections = approachSurface(assignment, guidance);
    const quads = surfaceQuads(sections);
    expect(quads).toHaveLength(sections.length - 1);
    expect(quads[0]).toEqual([
      sections[0].left, sections[1].left, sections[1].right, sections[0].right,
    ]);
    for (const quad of quads) expect(quad).toHaveLength(4);
  });
});
```

Note: the existing test file may already import some of these names — merge imports rather than duplicating. If it already defines a `RunwayAssignment` fixture, reuse it and adjust field references accordingly (widths/elevations above assume runwayWidthFt=100, elevation 100 ft).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/mission/guidanceGeometry.test.ts`
Expected: FAIL — `approachSurface` / `surfaceQuads` are not exported.

- [ ] **Step 3: Implement** — append to `frontend/src/mission/guidanceGeometry.ts` (after `approachGuidance`):

```typescript
/**
 * Cross-sections of the flyable glide-slope surface (#24): sampled every gateSpacingNm from
 * the threshold (d=0) out to approachLengthNm, altitude on the same slope the gates mark,
 * width tapering linearly from the assigned runway's width at the threshold to the corridor
 * width at the far end. A missing runway width (not > 0) falls back to the constant corridor
 * width — a real profile value, never a fabricated one.
 */
export function approachSurface(
  assignment: RunwayAssignment,
  guidance: MissionProfile["guidance"],
): GuidanceSegment[] {
  const threshold = assignment.assignedEnd;
  const elevationFt = runwayElevationFt(assignment);
  const outbound = assignment.runwayHeadingDeg + 180;
  const leftBearing = assignment.runwayHeadingDeg - 90;
  const rightBearing = assignment.runwayHeadingDeg + 90;
  const thresholdWidthFt =
    assignment.runwayWidthFt > 0 ? assignment.runwayWidthFt : guidance.corridorWidthFt;
  const distances: number[] = [];
  for (let d = 0; d < guidance.approachLengthNm - 1e-9; d += guidance.gateSpacingNm) {
    distances.push(d);
  }
  distances.push(guidance.approachLengthNm);
  return distances.map((distanceNm) => {
    const t = distanceNm / guidance.approachLengthNm;
    const widthFt = thresholdWidthFt + (guidance.corridorWidthFt - thresholdWidthFt) * t;
    const halfWidthNm = widthFt / 2 / FEET_PER_NM;
    const altitudeFt =
      elevationFt + Math.tan(guidance.glideSlopeDeg * Math.PI / 180) * distanceNm * FEET_PER_NM;
    const center = destinationPoint(threshold.latDeg, threshold.lonDeg, outbound, distanceNm);
    return {
      left: point(center, leftBearing, halfWidthNm, altitudeFt),
      right: point(center, rightBearing, halfWidthNm, altitudeFt),
    };
  });
}

/** 4-corner rings between consecutive cross-sections — the renderer draws one polygon each. */
export function surfaceQuads(sections: GuidanceSegment[]): GuidancePoint[][] {
  const quads: GuidancePoint[][] = [];
  for (let i = 0; i + 1 < sections.length; i += 1) {
    quads.push([sections[i].left, sections[i + 1].left, sections[i + 1].right, sections[i].right]);
  }
  return quads;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/mission/guidanceGeometry.test.ts`
Expected: PASS (all pre-existing cases in the file too).

- [ ] **Step 5: Commit**

```bash
git add src/mission/guidanceGeometry.ts src/mission/guidanceGeometry.test.ts
git commit -m "feat(mission): approachSurface + surfaceQuads pure geometry (#24)"
```

---

### Task 2: `mission/papi.ts` (pure PAPI logic)

**Files:**
- Create: `frontend/src/mission/papi.ts`
- Test: `frontend/src/mission/papi.test.ts`

**Interfaces:**
- Consumes: `destinationPoint`, `greatCircleDistanceNm` from `./geo`; `GuidancePoint` from `./guidanceGeometry`; `RunwayAssignment` from `./types`.
- Produces: `papiPosition(assignment: RunwayAssignment): GuidancePoint` · `papiLightPositions(assignment: RunwayAssignment): GuidancePoint[]` (4 lights, 25 ft apart, extending left from the base) · `papiColors(aircraft: { latDeg: number; lonDeg: number; altitudeFt: number }, papi: GuidancePoint, glideSlopeDeg: number): [boolean, boolean, boolean, boolean]` (true = WHITE). Task 4 renders these.

- [ ] **Step 1: Write the failing tests** — `frontend/src/mission/papi.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { papiColors, papiLightPositions, papiPosition } from "./papi";
import { destinationPoint, greatCircleDistanceNm, initialBearingDeg } from "./geo";
import type { RunwayAssignment } from "./types";

const FEET_PER_NM = 6076.11549;

const assignment: RunwayAssignment = {
  airportIdent: "KTST",
  airportName: "Test Field",
  airportLatDeg: 0,
  airportLonDeg: 0,
  airportElevationFt: 100,
  runwayId: "01/19",
  runwayIdent: "01/19",
  runwayEndIdent: "01",
  runwayHeadingDeg: 0,
  runwayLengthFt: 5000,
  runwayWidthFt: 100,
  runwaySurface: "HARD",
  runwayLighted: true,
  assignedEnd: {
    ident: "01",
    latDeg: 0,
    lonDeg: 0,
    elevationFt: 100,
    headingDeg: 0,
    displacedThresholdFt: 0,
  },
  distanceNm: 8,
  estimatedMinutes: 5,
  suitability: 1,
};

describe("papiPosition", () => {
  it("sits abeam the threshold on the left, half runway width + 50 ft out, at runway elevation", () => {
    const papi = papiPosition(assignment);
    const offsetFt =
      greatCircleDistanceNm(0, 0, papi.latDeg, papi.lonDeg) * FEET_PER_NM;
    expect(offsetFt).toBeCloseTo(assignment.runwayWidthFt / 2 + 50, 0);
    // runway heading 0 → left side is bearing 270 (west of the threshold)
    expect(initialBearingDeg(0, 0, papi.latDeg, papi.lonDeg)).toBeCloseTo(270, 0);
    expect(papi.altitudeFt).toBe(100);
  });

  it("uses airportElevationFt when the assigned end has no elevation", () => {
    const noEndElevation = {
      ...assignment,
      assignedEnd: { ...assignment.assignedEnd, elevationFt: null },
    };
    expect(papiPosition(noEndElevation).altitudeFt).toBe(100);
  });
});

describe("papiLightPositions", () => {
  it("returns four lights spread 25 ft apart extending further left, all at runway elevation", () => {
    const lights = papiLightPositions(assignment);
    expect(lights).toHaveLength(4);
    const base = papiPosition(assignment);
    lights.forEach((light, i) => {
      const spreadFt =
        greatCircleDistanceNm(base.latDeg, base.lonDeg, light.latDeg, light.lonDeg) * FEET_PER_NM;
      expect(spreadFt).toBeCloseTo(i * 25, 0);
      expect(light.altitudeFt).toBe(100);
    });
  });
});

describe("papiColors", () => {
  const papi = papiPosition(assignment);
  const GLIDE = 3;

  /** Aircraft on the approach side (runway 01 → approach from the south, bearing 180). */
  function aircraftAtAngle(angleDeg: number, distanceNm = 3) {
    const { latDeg, lonDeg } = destinationPoint(papi.latDeg, papi.lonDeg, 180, distanceNm);
    const altitudeFt =
      papi.altitudeFt + Math.tan((angleDeg * Math.PI) / 180) * distanceNm * FEET_PER_NM;
    return { latDeg, lonDeg, altitudeFt };
  }

  it.each([
    [3 - 0.6, [false, false, false, false]], // 2.4° — four red, well low
    [3 - 0.3, [true, false, false, false]],  // 2.7° — slightly low
    [3 - 0.1, [true, true, false, false]],   // 2.9° — on slope (2W2R)
    [3 + 0.1, [true, true, false, false]],   // 3.1° — on slope (2W2R)
    [3 + 0.3, [true, true, true, false]],    // 3.3° — slightly high
    [3 + 0.6, [true, true, true, true]],     // 3.6° — four white, well high
  ])("elevation angle %f° → %j", (angleDeg, expected) => {
    expect(papiColors(aircraftAtAngle(angleDeg), papi, GLIDE)).toEqual(expected);
  });

  it("works at a negative-elevation runway (legitimate)", () => {
    const below = { ...papi, altitudeFt: -14 };
    const { latDeg, lonDeg } = destinationPoint(below.latDeg, below.lonDeg, 180, 3);
    const altitudeFt = -14 + Math.tan((3 * Math.PI) / 180) * 3 * FEET_PER_NM;
    expect(papiColors({ latDeg, lonDeg, altitudeFt }, below, GLIDE)).toEqual([
      true, true, false, false,
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/mission/papi.test.ts`
Expected: FAIL — module `./papi` does not exist.

- [ ] **Step 3: Implement** — `frontend/src/mission/papi.ts`:

```typescript
/*
 * Real 4-box PAPI (#23): each light flips white/red at its own elevation-angle threshold
 * around the mission's glide slope. World furniture, not an assist — the renderer mounts it
 * at every assist level. Pure: no Cesium, fully table-tested.
 */
import { destinationPoint, greatCircleDistanceNm } from "./geo";
import type { GuidancePoint } from "./guidanceGeometry";
import type { RunwayAssignment } from "./types";

const FEET_PER_NM = 6076.11549;
const LATERAL_CLEARANCE_FT = 50;
const LIGHT_SPACING_FT = 25;

/** Per-light offsets from the glide slope; a light is WHITE above `glideSlopeDeg + offset`. */
export const PAPI_THRESHOLD_OFFSETS_DEG = [-0.5, -0.2, 0.2, 0.5] as const;

function runwayElevationFt(assignment: RunwayAssignment): number {
  return assignment.assignedEnd.elevationFt ?? assignment.airportElevationFt ?? 0;
}

export function papiPosition(assignment: RunwayAssignment): GuidancePoint {
  const leftBearing = assignment.runwayHeadingDeg - 90;
  const offsetNm = (assignment.runwayWidthFt / 2 + LATERAL_CLEARANCE_FT) / FEET_PER_NM;
  const { latDeg, lonDeg } = destinationPoint(
    assignment.assignedEnd.latDeg,
    assignment.assignedEnd.lonDeg,
    leftBearing,
    offsetNm,
  );
  return { latDeg, lonDeg, altitudeFt: runwayElevationFt(assignment) };
}

export function papiLightPositions(assignment: RunwayAssignment): GuidancePoint[] {
  const base = papiPosition(assignment);
  const leftBearing = assignment.runwayHeadingDeg - 90;
  return PAPI_THRESHOLD_OFFSETS_DEG.map((_, index) => {
    const { latDeg, lonDeg } = destinationPoint(
      base.latDeg,
      base.lonDeg,
      leftBearing,
      (index * LIGHT_SPACING_FT) / FEET_PER_NM,
    );
    return { latDeg, lonDeg, altitudeFt: base.altitudeFt };
  });
}

export function papiColors(
  aircraft: { latDeg: number; lonDeg: number; altitudeFt: number },
  papi: GuidancePoint,
  glideSlopeDeg: number,
): [boolean, boolean, boolean, boolean] {
  const horizontalFt =
    greatCircleDistanceNm(aircraft.latDeg, aircraft.lonDeg, papi.latDeg, papi.lonDeg) *
    FEET_PER_NM;
  const angleDeg =
    (Math.atan2(aircraft.altitudeFt - papi.altitudeFt, horizontalFt) * 180) / Math.PI;
  return PAPI_THRESHOLD_OFFSETS_DEG.map(
    (offset) => angleDeg > glideSlopeDeg + offset,
  ) as [boolean, boolean, boolean, boolean];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/mission/papi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mission/papi.ts src/mission/papi.test.ts
git commit -m "feat(mission): pure PAPI position + 4-light color logic (#23)"
```

---

### Task 3: Surface rendering — swap corridor edge-lines for polygon quads

**Files:**
- Modify: `frontend/src/globe/ApproachAssistLayer.tsx`

**Interfaces:**
- Consumes: `approachSurface`, `surfaceQuads` from Task 1; existing `approachGuidance` (gates + flare unchanged); existing `world()` helper in the file.
- Produces: no new exports — visual change only. Gating unchanged (`assistFeatures(assist).approachCorridor`).

- [ ] **Step 1: Implement the swap** — in `frontend/src/globe/ApproachAssistLayer.tsx`:

Replace the import line

```typescript
import { approachGuidance, type GuidancePoint } from "../mission/guidanceGeometry";
```

with

```typescript
import {
  approachGuidance,
  approachSurface,
  surfaceQuads,
  type GuidancePoint,
} from "../mission/guidanceGeometry";
```

Add `PolygonHierarchy` to the `cesium` import. Then replace the corridor edge-lines block

```typescript
    const guidance = approachGuidance(mission.assignment, mission.missionProfile.guidance);
    const entities = guidance.corridorEdges.map((edge) => viewer.entities.add({
      polyline: {
        positions: [world(edge.left), world(edge.right)],
        width: 1,
        material: Color.CYAN.withAlpha(0.45),
      },
    }));
```

with

```typescript
    const guidance = approachGuidance(mission.assignment, mission.missionProfile.guidance);
    // The flyable surface (#24) replaces the two corridor edge polylines: one translucent
    // quad per cross-section pair, lying exactly on the slope the gates mark.
    const sections = approachSurface(mission.assignment, mission.missionProfile.guidance);
    const entities = surfaceQuads(sections).map((quad) => viewer.entities.add({
      polygon: {
        hierarchy: new PolygonHierarchy(quad.map(world)),
        perPositionHeight: true,
        material: Color.CYAN.withAlpha(0.15),
      },
    }));
```

The gates and flare blocks below stay byte-identical (they push into `entities` and ride on the surface by construction).

- [ ] **Step 2: Verify no stragglers**

Run: `grep -n "corridorEdges" src/globe/ApproachAssistLayer.tsx`
Expected: no matches. (`approachGuidance` still returns `corridorEdges` — the pure API is unchanged; only the layer stops drawing them.)

- [ ] **Step 3: Run the full frontend gate**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/globe/ApproachAssistLayer.tsx
git commit -m "feat(globe): tapering glide-slope surface replaces corridor edge lines (#24)"
```

---

### Task 4: `PapiLayer.tsx` + mount at every assist level

**Files:**
- Create: `frontend/src/globe/PapiLayer.tsx`
- Modify: `frontend/src/game/FlightSession.tsx` (imports block ~line 46; mount block ~line 723)

**Interfaces:**
- Consumes: `papiColors`, `papiPosition`, `papiLightPositions` from Task 2; `hudSnapshot` from `../hud/snapshot` (observable: `hudSnapshot.get()` returns `HudSnapshot | null` with `latDeg`, `lonDeg`, `altitudeM`); `mToFt` from `../sim/units`; `useViewer` from `./viewerContext`; `LockedMissionView` from `../mission/contract` (fields used: `mission.assignment`, `mission.missionProfile.guidance.glideSlopeDeg`).
- Produces: `default PapiLayer({ mission }: { mission: LockedMissionView })` — no `assist` prop by design (world furniture).

- [ ] **Step 1: Create the layer** — `frontend/src/globe/PapiLayer.tsx`:

```tsx
/*
 * PAPI (#23) is world furniture, not an assist: it mounts at every assist level, exactly like
 * a real airport, so players who turn assists OFF keep a realistic glide cue. Colors come from
 * pure papiColors() via CallbackProperty reading the live hudSnapshot — no per-frame entity
 * churn. A null snapshot renders DIMGRAY (unknown), never a fabricated white/red.
 */
import { useEffect } from "react";
import { CallbackProperty, Cartesian3, Color, NearFarScalar } from "cesium";
import type { LockedMissionView } from "../mission/contract";
import type { GuidancePoint } from "../mission/guidanceGeometry";
import { papiColors, papiLightPositions, papiPosition } from "../mission/papi";
import { hudSnapshot } from "../hud/snapshot";
import { mToFt } from "../sim/units";
import { useViewer } from "./viewerContext";

const PAPI_WHITE = Color.WHITE;
const PAPI_RED = Color.fromCssColorString("#ff3b30");
const PAPI_UNKNOWN = Color.DIMGRAY;

function world(point: GuidancePoint): Cartesian3 {
  return Cartesian3.fromDegrees(point.lonDeg, point.latDeg, point.altitudeFt * 0.3048);
}

export default function PapiLayer({ mission }: { mission: LockedMissionView }) {
  const bundle = useViewer();

  useEffect(() => {
    const viewer = bundle?.viewer;
    if (viewer === undefined || viewer.isDestroyed()) return;
    const base = papiPosition(mission.assignment);
    const lights = papiLightPositions(mission.assignment);
    const glideSlopeDeg = mission.missionProfile.guidance.glideSlopeDeg;
    const entities = lights.map((light, index) => viewer.entities.add({
      position: world(light),
      point: {
        pixelSize: 8,
        outlineColor: Color.BLACK.withAlpha(0.8),
        outlineWidth: 1,
        // legible from miles out without ballooning up close (near 1 nm → far 30 nm)
        scaleByDistance: new NearFarScalar(1852, 1.25, 55560, 0.6),
        color: new CallbackProperty(() => {
          const snapshot = hudSnapshot.get();
          if (snapshot === null) return PAPI_UNKNOWN;
          const colors = papiColors(
            {
              latDeg: snapshot.latDeg,
              lonDeg: snapshot.lonDeg,
              altitudeFt: mToFt(snapshot.altitudeM),
            },
            base,
            glideSlopeDeg,
          );
          return colors[index] ? PAPI_WHITE : PAPI_RED;
        }, false),
      },
    }));
    return () => {
      if (viewer.isDestroyed()) return;
      for (const entity of entities) viewer.entities.remove(entity);
    };
  }, [bundle?.viewer, mission]);

  return null;
}
```

- [ ] **Step 2: Mount it** — in `frontend/src/game/FlightSession.tsx`, next to the existing layer imports (~line 47):

```typescript
import PapiLayer from "../globe/PapiLayer";
```

and inside the existing locked-mission block (~line 723), FIRST line so it clearly sits outside the assist-gated chrome:

```tsx
      {lockedMission !== null && assist !== null && mode !== "ENDED" && (
        <>
          {/* PAPI is world furniture (#23): renders at EVERY assist level, unlike the
              assist-gated layers below — real airports don't turn their lights off. */}
          <PapiLayer mission={lockedMission} />
          <MissionRouteLayer mission={lockedMission} assist={assist.current} />
          <ApproachAssistLayer mission={lockedMission} assist={assist.current} />
```

(Only the `<PapiLayer …/>` line and its comment are new; everything else in the block stays.)

- [ ] **Step 3: Run the full frontend gate**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. (Broken-arm coverage: `assistFeatures` tests already pin `approachCorridor === false` for OFF/NAV — the surface can't mount there; PAPI has no assist prop at all, and no locked mission → the whole block is unmounted, so neither renders.)

- [ ] **Step 4: Commit**

```bash
git add src/globe/PapiLayer.tsx src/game/FlightSession.tsx
git commit -m "feat(globe): 4-light PAPI at every assist level (#23)"
```

---

### Task 5: Route line clips to the remaining path (#50)

**Files:**
- Create: `frontend/src/globe/missionRoutePath.ts`
- Test: `frontend/src/globe/missionRoutePath.test.ts`
- Modify: `frontend/src/globe/MissionRouteLayer.tsx`

**Interfaces:**
- Consumes: `HudSnapshot` type (only `latDeg`/`lonDeg`/`altitudeM`), `mToFt` from `../sim/units`.
- Produces: `routeStartPoint(snapshot, mission): { latDeg: number; lonDeg: number; altitudeFt: number }` — the live aircraft position, falling back to the mission contact's position when the snapshot is null (pre-spawn). The layer feeds it into a `CallbackProperty` so the cyan route always runs from the aircraft AHEAD to the runway, never behind.

- [ ] **Step 1: Write the failing tests** — `frontend/src/globe/missionRoutePath.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { routeStartPoint } from "./missionRoutePath";

const mission = {
  contact: { lat: 30.5, lon: -88.1, alt_geom: 4500, alt_baro: 4400 },
};

describe("routeStartPoint", () => {
  it("uses the live snapshot position when flying", () => {
    const snapshot = { latDeg: 30.7, lonDeg: -88.0, altitudeM: 914.4 };
    expect(routeStartPoint(snapshot, mission)).toEqual({
      latDeg: 30.7,
      lonDeg: -88.0,
      altitudeFt: 3000,
    });
  });

  it("falls back to the contact position before the sim publishes a snapshot", () => {
    expect(routeStartPoint(null, mission)).toEqual({
      latDeg: 30.5,
      lonDeg: -88.1,
      altitudeFt: 4500,
    });
  });

  it("prefers alt_geom, tolerates the readsb string alt_baro, and never fabricates", () => {
    expect(
      routeStartPoint(null, { contact: { lat: 1, lon: 2, alt_geom: null, alt_baro: 4400 } })
        .altitudeFt,
    ).toBe(4400);
    expect(
      routeStartPoint(null, { contact: { lat: 1, lon: 2, alt_geom: null, alt_baro: "ground" } })
        .altitudeFt,
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/globe/missionRoutePath.test.ts`
Expected: FAIL — module `./missionRoutePath` does not exist.

- [ ] **Step 3: Implement** — `frontend/src/globe/missionRoutePath.ts`:

```typescript
/*
 * #50: on final the full original-position → runway polyline reads as pointing "where I came
 * from". The route must always start at the aircraft's CURRENT position so it only ever shows
 * the remaining path. Pure (no Cesium) so it stays unit-testable; the mission parameter is
 * structural so tests don't need a full LockedMissionView.
 */
import { mToFt } from "../sim/units";

export type RoutePoint = { latDeg: number; lonDeg: number; altitudeFt: number };

export function routeStartPoint(
  snapshot: { latDeg: number; lonDeg: number; altitudeM: number } | null,
  mission: {
    contact: {
      lat: number;
      lon: number;
      alt_geom?: number | null;
      alt_baro?: number | string | null;
    };
  },
): RoutePoint {
  if (snapshot !== null) {
    return {
      latDeg: snapshot.latDeg,
      lonDeg: snapshot.lonDeg,
      altitudeFt: mToFt(snapshot.altitudeM),
    };
  }
  const contact = mission.contact;
  const altitudeFt =
    contact.alt_geom ?? (typeof contact.alt_baro === "number" ? contact.alt_baro : 0);
  return { latDeg: contact.lat, lonDeg: contact.lon, altitudeFt };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/globe/missionRoutePath.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the layer** — in `frontend/src/globe/MissionRouteLayer.tsx`:

Add imports:

```typescript
import { CallbackProperty } from "cesium";           // merge into the existing cesium import
import { hudSnapshot } from "../hud/snapshot";
import { routeStartPoint } from "./missionRoutePath";
```

Delete the now-orphaned `contactAltitudeM` helper (lines 15–18) and the static `start` constant, then replace the `route` entity:

```typescript
    const route = viewer.entities.add({
      polyline: {
        // #50: start at the LIVE aircraft position so the line only ever shows the
        // remaining path — pre-spawn it falls back to the contact's real position.
        positions: new CallbackProperty(() => {
          const start = routeStartPoint(hudSnapshot.get(), mission);
          return [
            Cartesian3.fromDegrees(start.lonDeg, start.latDeg, start.altitudeFt * 0.3048),
            destination,
          ];
        }, false),
        width: 2,
        arcType: ArcType.GEODESIC,
        material: Color.CYAN.withAlpha(0.85),
      },
    });
```

(`destination` is already computed above in the effect and stays.)

- [ ] **Step 6: Run the full frontend gate**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS; tsc confirms nothing else referenced `contactAltitudeM`.

- [ ] **Step 7: Commit**

```bash
git add src/globe/missionRoutePath.ts src/globe/missionRoutePath.test.ts src/globe/MissionRouteLayer.tsx
git commit -m "fix(globe): route line clips to remaining path from live position (#50)"
```

---

### Task 6: Wire the salvaged approach warnings into the HUD

**Files:**
- Modify: `frontend/src/game/FlightSession.tsx` (imports; the `immersiveNavCue` block ~line 690; the `<Hud …/>` props ~line 746)

**Interfaces:**
- Consumes: `approachWarningsFor(snapshot: HudSnapshot, assignment: RunwayAssignment, guidance: MissionProfile["guidance"], assist: AssistMode): string[]` from `../hud/approachAlerts` (salvaged, fully tested, currently imported by nothing). The prop chain `Hud.immersiveApproachWarnings → ImmersiveHudBar.approachWarnings` ALREADY EXISTS with default `[]` — only this computation is missing.
- Produces: `NOT LINED UP` / `HIGH` / `LOW` calls appearing in the immersive HUD warnings row during approach, merged and capped by the existing `prioritizedImmersiveWarnings`.

- [ ] **Step 1: Compute and pass the prop** — in `frontend/src/game/FlightSession.tsx`:

Add the import next to the other hud imports:

```typescript
import { approachWarningsFor } from "../hud/approachAlerts";
```

Directly after the `immersiveNavCue` const (ends ~line 703), add:

```typescript
  const immersiveApproachWarnings =
    lockedMission !== null && snapshot !== null && assist !== null
      ? approachWarningsFor(
          snapshot,
          lockedMission.assignment,
          lockedMission.missionProfile.guidance,
          assist.current,
        )
      : [];
```

Then add the prop to the existing `<Hud …/>` call (after `immersiveNavCue={immersiveNavCue}`):

```tsx
            immersiveApproachWarnings={immersiveApproachWarnings}
```

- [ ] **Step 2: Run the full frontend gate**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — `approachAlerts.test.ts` (salvaged with the module) already pins the call logic: silent outside the approach cone, `NOT LINED UP` precedence, HIGH/LOW tolerance band, OFF-assist silence via `assistFeatures`.

- [ ] **Step 3: Verify the wiring is live**

Run: `grep -rn "approachWarningsFor" src/ --include="*.tsx" --include="*.ts" | grep -v test | grep -v approachAlerts.ts`
Expected: exactly one hit in `game/FlightSession.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/game/FlightSession.tsx
git commit -m "feat(hud): wire salvaged approach calls (NOT LINED UP / HIGH / LOW) into flight"
```

---

### Task 7: Full gate, decision log, deploy, owner look-pass

**Files:**
- Modify: `docs/decisions.md` (repo root, not frontend/)

**Interfaces:**
- Consumes: everything above.
- Produces: live build on fly.voygent.app for the owner's visual sign-off.

- [ ] **Step 1: Full verification gate**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: entire suite green, no type errors, production build succeeds.

- [ ] **Step 2: Append the decision entry** — add to `docs/decisions.md` (follow the file's existing dated-entry format, next CF-number after the last entry):

```markdown
## CF-019 — 2026-08-12 — PAPI renders DIMGRAY on null snapshot; route line live-clipped
PAPI (#23) is world furniture (all assist levels, mounts outside the assist gate). Before the
sim publishes its first hudSnapshot there is no observer position, so light colors are
unknowable — they render DIMGRAY rather than a fabricated on-slope 2W2R (honest-data rule 1).
The mission route line (#50) starts at the live aircraft position via CallbackProperty
(contact position pre-spawn fallback) so guidance never points behind the aircraft. The
approach surface (#24) replaced the corridor edge polylines; approachGuidance() still returns
corridorEdges (pure API unchanged) — only the layer stopped drawing them.
```

- [ ] **Step 3: Commit the decision log**

```bash
git add ../docs/decisions.md
git commit -m "docs(decisions): CF-019 PAPI unknown-state + route clip + surface swap notes"
```

- [ ] **Step 4: Deploy to production**

Run: `npm run deploy:production`
Expected: wrangler reports a new worker version for `voygent-adsb-game-production`; note the version id.

- [ ] **Step 5: Probe the live site**

Run: `curl -s -o /dev/null -w "%{http_code}" https://fly.voygent.app/`
Expected: `200`.

- [ ] **Step 6: Push and hand to the owner**

```bash
git push
```

Then report to the owner with the look-tuning knobs for the live pass (acceptance spec §9):
1. FULL assist on final → tapering translucent surface into the pavement, edge lines gone, gates riding on it, flare unchanged. Knob: surface alpha `0.15` in `ApproachAssistLayer.tsx`.
2. Any assist level incl. OFF → four PAPI boxes beside the threshold, visible from ≥5 nm, 2W2R on slope. Knobs: `pixelSize: 8` and `NearFarScalar(1852, 1.25, 55560, 0.6)` in `PapiLayer.tsx`.
3. On final, the route line no longer trails behind the aircraft.

**STOP — wait for owner sign-off before any further work (project ground rule 5).**
