# Mobile Rich HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the rich mock to the real mobile HUD — functional scrolling IAS/ALT tapes bound to real `HudSnapshot`, per-class tape ranges, glossy attitude ball, UI-002 identity declutter, always-narrow rail, and throttle-state clarity.

**Architecture:** Pure geometry helpers (`tapeTicks`, `tapeStripOffset`, `tapeRangesFor`) computed from props with a fixed window constant — no runtime DOM measurement, so the HUD stays hook-free and testable without jsdom. A `Tape` component renders a prebuilt tick strip translated so the live value sits at a fixed center pointer. Rich styling is CSS scoped under `.imm-hud` (flight surface only); the shared `AttitudeIndicator` SVG is unchanged and gets its glossy look purely from CSS.

**Tech Stack:** Vite · React 18 + TypeScript · Vitest (no jsdom — tests walk the plain-object element tree) · hand-written CSS tokens.

## Global Constraints

- **Honesty (ground rule 1):** tapes bind to real `HudSnapshot`; never re-simulate. Unknown/absent values render as em-dash (`EM_DASH` from `hud/format.ts`), never fabricated.
- **SIM unmistakability (ground rule 2):** keep the amber `SIM` badge on the live rail.
- **No new dependencies** (spec §14 / ground rule 3).
- **SI internally, aviation units only at the display edge:** `snapshot.iasMs`/`altitudeM` are m/s and m; convert with `msToKt`/`mToFt` from `sim/units.ts`. Tape ranges are in display units (kt, ft).
- **Hook-free HUD components:** no `useState`/`useEffect`/`useRef`/`ResizeObserver` in `ImmersiveHudBar.tsx` or `AttitudeIndicator.tsx` — tests call them as plain functions (spec §8).
- **Rich look scoped to flight surfaces only (UI-001):** all new radius/gloss/shadow CSS lives under `.imm-hud`. Do not modify desktop `dashboard/AttitudeIndicator` geometry, `DashboardStrip`, or non-`.imm-*` tokens.
- **Gate every task:** `npm run test:unit && npm run typecheck:app && npm run build && npm run lint` (run from `frontend/`).

---

### Task 1: Tape geometry (pure functions)

**Files:**
- Modify: `frontend/src/hud/ImmersiveHudBar.tsx` (add exports near the top helpers)
- Test: `frontend/src/hud/ImmersiveHudBar.test.tsx` (append a `describe`)

**Interfaces:**
- Produces:
  - `export type TapeRange = { min: number; max: number; step: number; major: number; pxPerUnit: number }`
  - `export const TAPE_WINDOW_PX = 44` (must equal the `.tape-window` height set in Task 7 CSS)
  - `export function tapeTicks(range: TapeRange): { value: number; major: boolean; y: number }[]` — `y = (value - min) * pxPerUnit`, one entry per `step` from `min` to `max` inclusive; `major = value % major === 0`.
  - `export function tapeStripOffset(value: number, range: TapeRange, windowPx?: number): number` — returns the strip `translateY` px = `(clamp(value,min,max) - min) * pxPerUnit - windowPx/2`; `windowPx` defaults to `TAPE_WINDOW_PX`.

- [ ] **Step 1: Write the failing test**

```tsx
import {
  tapeTicks,
  tapeStripOffset,
  TAPE_WINDOW_PX,
  type TapeRange,
} from "./ImmersiveHudBar";

describe("tape geometry", () => {
  const r: TapeRange = { min: 0, max: 200, step: 10, major: 20, pxPerUnit: 1.3 };

  it("builds ticks from min to max with major flags and y offsets", () => {
    const ticks = tapeTicks(r);
    expect(ticks[0]).toEqual({ value: 0, major: true, y: 0 });
    expect(ticks[1]).toEqual({ value: 10, major: false, y: 13 });
    expect(ticks[2]).toEqual({ value: 20, major: true, y: 26 });
    expect(ticks[ticks.length - 1].value).toBe(200);
  });

  it("centers the current value under the pointer", () => {
    // value at min -> strip shifted up by half the window only
    expect(tapeStripOffset(0, r)).toBeCloseTo(-TAPE_WINDOW_PX / 2);
    // value of 100 -> (100-0)*1.3 - 22 = 108
    expect(tapeStripOffset(100, r)).toBeCloseTo(130 - TAPE_WINDOW_PX / 2);
  });

  it("clamps out-of-range values to the strip ends", () => {
    expect(tapeStripOffset(-50, r)).toBeCloseTo(tapeStripOffset(0, r));
    expect(tapeStripOffset(9999, r)).toBeCloseTo(tapeStripOffset(200, r));
  });

  it("is monotonic increasing in value", () => {
    expect(tapeStripOffset(50, r)).toBeLessThan(tapeStripOffset(60, r));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hud/ImmersiveHudBar.test.tsx -t "tape geometry"`
Expected: FAIL — `tapeTicks`/`tapeStripOffset`/`TAPE_WINDOW_PX` not exported.

- [ ] **Step 3: Write minimal implementation**

Add near the top of `ImmersiveHudBar.tsx` (after the type imports, before `immersiveBarFields`):

```tsx
export type TapeRange = { min: number; max: number; step: number; major: number; pxPerUnit: number };

/** Fixed tape viewport height in px. MUST equal the .tape-window height in tokens.css. */
export const TAPE_WINDOW_PX = 44;

export function tapeTicks(range: TapeRange): { value: number; major: boolean; y: number }[] {
  const ticks: { value: number; major: boolean; y: number }[] = [];
  for (let v = range.min; v <= range.max; v += range.step) {
    ticks.push({ value: v, major: v % range.major === 0, y: (v - range.min) * range.pxPerUnit });
  }
  return ticks;
}

export function tapeStripOffset(value: number, range: TapeRange, windowPx: number = TAPE_WINDOW_PX): number {
  const clamped = Math.min(range.max, Math.max(range.min, value));
  return (clamped - range.min) * range.pxPerUnit - windowPx / 2;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hud/ImmersiveHudBar.test.tsx -t "tape geometry"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hud/ImmersiveHudBar.tsx frontend/src/hud/ImmersiveHudBar.test.tsx
git commit -m "feat(hud): pure tape geometry helpers (ticks, strip offset)"
```

---

### Task 2: Per-class tape ranges

**Files:**
- Modify: `frontend/src/hud/ImmersiveHudBar.tsx`
- Test: `frontend/src/hud/ImmersiveHudBar.test.tsx` (append a `describe`)

**Interfaces:**
- Consumes: `TapeRange` (Task 1); `AircraftParams` from `../sim/types` (fields used: `display.asiMinKt`, `display.asiMaxKt`, `limits.serviceCeilingM`).
- Produces: `export function tapeRangesFor(params: { display: { asiMinKt: number; asiMaxKt: number }; limits: { serviceCeilingM: number } }): { ias: TapeRange; alt: TapeRange }`
  - IAS: `min = asiMinKt`, `max = asiMaxKt`; `step`/`major`/`pxPerUnit` from `tapeStepsForSpan`.
  - ALT: `min = 0`, `max = ceil(mToFt(serviceCeilingM) / 1000) * 1000`; steps from the span.

- [ ] **Step 1: Write the failing test**

```tsx
import { tapeRangesFor } from "./ImmersiveHudBar";

describe("tapeRangesFor", () => {
  it("uses the per-class ASI face for the IAS tape (spec §6)", () => {
    const ga = tapeRangesFor({ display: { asiMinKt: 40, asiMaxKt: 180 }, limits: { serviceCeilingM: 4100 } });
    expect(ga.ias.min).toBe(40);
    expect(ga.ias.max).toBe(180);
    // ~13,451 ft ceiling -> rounded up to a clean 14,000 ft top
    expect(ga.alt.min).toBe(0);
    expect(ga.alt.max).toBe(14000);
  });

  it("gives an airliner a far taller altitude tape than a GA type", () => {
    const jet = tapeRangesFor({ display: { asiMinKt: 60, asiMaxKt: 400 }, limits: { serviceCeilingM: 12500 } });
    const ga = tapeRangesFor({ display: { asiMinKt: 40, asiMaxKt: 180 }, limits: { serviceCeilingM: 4100 } });
    expect(jet.alt.max).toBeGreaterThan(ga.alt.max);
    expect(jet.ias.max).toBeGreaterThan(ga.ias.max);
  });

  it("keeps tick spacing sane (major is a positive multiple of step)", () => {
    const r = tapeRangesFor({ display: { asiMinKt: 40, asiMaxKt: 180 }, limits: { serviceCeilingM: 4100 } });
    for (const t of [r.ias, r.alt]) {
      expect(t.step).toBeGreaterThan(0);
      expect(t.major % t.step).toBe(0);
      expect(t.pxPerUnit).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hud/ImmersiveHudBar.test.tsx -t "tapeRangesFor"`
Expected: FAIL — `tapeRangesFor` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `ImmersiveHudBar.tsx` (after Task 1 helpers; add `import { mToFt } from "../sim/units";` to the existing units import):

```tsx
/** Pick a readable step/major/pxPerUnit for a display span, targeting ~10 ticks in the window. */
function tapeStepsForSpan(span: number): { step: number; major: number; pxPerUnit: number } {
  // ~10 unit-values visible across the fixed window; strip is tall enough that pxPerUnit stays > 0.
  const rawStep = span / 20;
  const step = rawStep <= 5 ? 5 : rawStep <= 10 ? 10 : rawStep <= 50 ? 50 : 100;
  const major = step * 2;
  // scale so the full span is ~ (span/step * 10)px tall — 10px between ticks
  const pxPerUnit = 10 / step;
  return { step, major, pxPerUnit };
}

export function tapeRangesFor(params: {
  display: { asiMinKt: number; asiMaxKt: number };
  limits: { serviceCeilingM: number };
}): { ias: TapeRange; alt: TapeRange } {
  const iasSpan = params.display.asiMaxKt - params.display.asiMinKt;
  const iasSteps = tapeStepsForSpan(iasSpan);
  const altMax = Math.ceil(mToFt(params.limits.serviceCeilingM) / 1000) * 1000;
  const altSteps = tapeStepsForSpan(altMax);
  return {
    ias: { min: params.display.asiMinKt, max: params.display.asiMaxKt, ...iasSteps },
    alt: { min: 0, max: altMax, ...altSteps },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hud/ImmersiveHudBar.test.tsx -t "tapeRangesFor"`
Expected: PASS. (If the ALT `major % step` assertion fails because `major` exceeds a coarse step, adjust `major = step * 2` — keep it a clean multiple.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hud/ImmersiveHudBar.tsx frontend/src/hud/ImmersiveHudBar.test.tsx
git commit -m "feat(hud): per-class tape ranges from ASI face + service ceiling"
```

---

### Task 3: Functional Tape component + TapeRail rewrite

**Files:**
- Modify: `frontend/src/hud/ImmersiveHudBar.tsx`
- Test: `frontend/src/hud/ImmersiveHudBar.test.tsx`

**Interfaces:**
- Consumes: `TapeRange`, `tapeTicks`, `tapeStripOffset`, `tapeRangesFor` (Tasks 1–2); `msToKt`, `mToFt` from `sim/units`.
- Produces: `ImmersiveHudBar` gains an optional prop `tapeRange?: { ias: TapeRange; alt: TapeRange } | null`. `TapeRail` renders two functional `Tape`s (IAS left, ALT right). When `tapeRange` is null/absent, tapes render the pointer value only (no ticks) so nothing is fabricated.

- [ ] **Step 1: Write the failing test**

```tsx
import { ktToMs, ftToM } from "../sim/units";
// baseSnapshot(): reuse the existing snapshot factory in this test file (or the shared fixture).

describe("functional tapes", () => {
  const tapeRange = tapeRangesFor({
    display: { asiMinKt: 40, asiMaxKt: 180 }, limits: { serviceCeilingM: 4100 },
  });
  const snap = { ...baseSnapshot(), iasMs: ktToMs(115), altitudeM: ftToM(3200) };

  it("shows the live IAS and ALT under the fixed pointers", () => {
    const tree = ImmersiveHudBar({ snapshot: snap, attitudeStyle: "ball", variant: "tapes", tapeRange });
    const text = collectText(tree);
    expect(text).toContain("115"); // IAS pointer
    expect(text).toContain("3200"); // ALT pointer
  });

  it("translates each strip so the current value sits at the pointer", () => {
    const tree = ImmersiveHudBar({ snapshot: snap, attitudeStyle: "ball", variant: "tapes", tapeRange });
    const transforms = collectAttr(tree, "style")
      ? collectAttr(tree, "className") : []; // placeholder to keep TS happy — see below
    // Assert via the pure helper instead of DOM style objects:
    expect(tapeStripOffset(115, tapeRange.ias)).toBeCloseTo((115 - 40) * tapeRange.ias.pxPerUnit - TAPE_WINDOW_PX / 2);
  });
});
```

> Note: because tests walk plain objects (no jsdom), assert the strip transform through the pure `tapeStripOffset` helper (already covered in Task 1) and assert the *rendered pointer values* through `collectText`. The second `it` above should simply verify `collectText` contains the rounded values for a few snapshots; the transform math is Task 1's contract.

Replace the second `it` with:

```tsx
  it("rounds the pointer values and rebases when the snapshot changes", () => {
    const s2 = { ...baseSnapshot(), iasMs: ktToMs(64.6), altitudeM: ftToM(999.4) };
    const tree = ImmersiveHudBar({ snapshot: s2, attitudeStyle: "ball", variant: "tapes", tapeRange });
    const text = collectText(tree);
    expect(text).toContain("65");   // 64.6 kt -> 65
    expect(text).toContain("999");  // 999.4 ft -> 999
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hud/ImmersiveHudBar.test.tsx -t "functional tapes"`
Expected: FAIL — `tapeRange` prop unsupported / pointer shows static label, not the live rounded value.

- [ ] **Step 3: Write minimal implementation**

Add a `Tape` component and rewrite `TapeRail` in `ImmersiveHudBar.tsx`:

```tsx
function Tape({ side, label, unit, value, range }: {
  side: "left" | "right";
  label: string;
  unit: string;
  value: number;
  range: TapeRange | null;
}) {
  const shown = Math.round(value);
  return (
    <span className="imm-tape" data-side={side}>
      <span className="imm-field-label">{label} · {unit}</span>
      <span className="tape-window">
        {range && (
          <span
            className="tape-strip"
            style={{ height: `${(range.max - range.min) * range.pxPerUnit}px`,
                     transform: `translateY(${tapeStripOffset(value, range)}px)` }}
          >
            {tapeTicks(range).map((t) => (
              <span
                key={t.value}
                className={`tape-tick ${t.major ? "major" : "minor"}`}
                style={{ bottom: `${t.y}px` }}
              >
                {t.major ? <span className="tt-label">{t.value}</span> : null}
              </span>
            ))}
          </span>
        )}
        <span className="tape-ptr">
          <span className="imm-field-value">{range ? shown : EM_DASH}</span>
        </span>
      </span>
    </span>
  );
}
```

Rewrite `TapeRail` to take `tapeRange` and use `Tape`:

```tsx
function TapeRail({ snapshot, attitudeStyle, navCue, tapeRange }: {
  snapshot: HudSnapshot;
  attitudeStyle: AttitudeStyle;
  navCue: ImmersiveHudNavCue | null;
  tapeRange: { ias: TapeRange; alt: TapeRange } | null;
}) {
  return (
    <div className="imm-bar imm-bar-tapes" data-hud-variant="tapes">
      <Tape side="left" label="IAS" unit="KT" value={msToKt(snapshot.iasMs)} range={tapeRange?.ias ?? null} />
      <span className="imm-director">
        <MiniAttitude snapshot={snapshot} attitudeStyle={attitudeStyle} />
        <span className="imm-director-stack">
          <SimIdentity snapshot={snapshot} />
          <NavDirector snapshot={snapshot} navCue={navCue} />
          <span className="imm-director-systems">
            <span>VSI <b>{formatVsiFpm(snapshot.verticalSpeedMs)}</b></span>
            <span>AGL <b>{formatClearanceFt(snapshot.terrainClearanceM)}</b></span>
            <span>FLP <b>{snapshot.flapLabel || EM_DASH}</b></span>
            <span>THR <b>{formatThrottlePct(snapshot.throttle)}</b></span>
          </span>
        </span>
      </span>
      <Tape side="right" label="ALT" unit="FT" value={mToFt(snapshot.altitudeM)} range={tapeRange?.alt ?? null} />
    </div>
  );
}
```

Thread the prop through `ImmersiveHudBar` (add `tapeRange = null` to its props destructure and type, pass to `TapeRail`; `BalancedRail` ignores it). Add `msToKt` to the `sim/units` import.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hud/ImmersiveHudBar.test.tsx`
Expected: PASS (new + all existing tests in the file).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hud/ImmersiveHudBar.tsx frontend/src/hud/ImmersiveHudBar.test.tsx
git commit -m "feat(hud): functional IAS/ALT tapes bound to HudSnapshot"
```

---

### Task 4: UI-002 identity declutter

**Files:**
- Modify: `frontend/src/hud/ImmersiveHudBar.tsx` (`SimIdentity`)
- Modify: `frontend/src/panels/HandoffCard.tsx` (spawn card) and `frontend/src/panels/EndCard.tsx` (debrief) — add callsign + class if not already shown
- Test: `frontend/src/hud/ImmersiveHudBar.test.tsx`; add/extend `frontend/src/panels/HandoffCard.test.tsx` and `frontend/src/panels/EndCard.test.tsx` if they exist (create alongside if not)

**Interfaces:**
- Consumes: `formatClass` (already imported), `HudSnapshot`.
- Produces: `SimIdentity` renders only the `SIM` badge (no callsign/class). Spawn card + debrief show `callsign` and `formatClass(classLabel)`.

- [ ] **Step 1: Write the failing test**

```tsx
describe("UI-002 declutter", () => {
  it("keeps the SIM badge but drops callsign and class from the live rail", () => {
    const snap = { ...baseSnapshot(), callsign: "SIM-4F2A", classLabel: "C172S" };
    const tree = ImmersiveHudBar({ snapshot: snap, attitudeStyle: "ball", variant: "tapes",
      tapeRange: tapeRangesFor({ display: { asiMinKt: 40, asiMaxKt: 180 }, limits: { serviceCeilingM: 4100 } }) });
    const text = collectText(tree).join(" ");
    expect(text).toContain("SIM");
    expect(text).not.toContain("SIM-4F2A");
    expect(text).not.toContain("C172S");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hud/ImmersiveHudBar.test.tsx -t "UI-002"`
Expected: FAIL — callsign/class still rendered by `SimIdentity`.

- [ ] **Step 3: Write minimal implementation**

Simplify `SimIdentity`:

```tsx
function SimIdentity(_: { snapshot: HudSnapshot }) {
  return (
    <span className="imm-bar-sim">
      <span className="hud-sim-badge">SIM</span>
    </span>
  );
}
```

Then, in `HandoffCard.tsx` and `EndCard.tsx`, ensure callsign + class are shown (read the files first; add a line only if absent, e.g. `<span className="hc-ident">{contact.callsign} · {formatClass(params.classLabel)}</span>` matching that file's existing markup/props). Do not fabricate — use the values already passed to those cards.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hud/ImmersiveHudBar.test.tsx -t "UI-002"` then the panels tests.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hud/ImmersiveHudBar.tsx frontend/src/panels/HandoffCard.tsx frontend/src/panels/EndCard.tsx frontend/src/hud/ImmersiveHudBar.test.tsx frontend/src/panels/*.test.tsx
git commit -m "feat(hud): UI-002 declutter — SIM badge stays, identity moves to spawn/debrief"
```

---

### Task 5: Thread tapeRange + narrow through Hud and FlightSession (always-narrow rail)

**Files:**
- Modify: `frontend/src/hud/Hud.tsx`
- Modify: `frontend/src/game/FlightSession.tsx`
- Test: `frontend/src/hud/Hud.test.tsx`

**Interfaces:**
- Consumes: `tapeRangesFor` (Task 2), `ImmersiveHudBar` `tapeRange` prop (Task 3), `originParams`, `narrow` (already computed in `FlightSession`, line ~142).
- Produces: `Hud` gains props `narrow?: boolean` and `tapeRange?: { ias: TapeRange; alt: TapeRange } | null`. `Hud` renders the immersive bar when `immersive || narrow`; `faded` behavior stays gated to `immersive` only.

- [ ] **Step 1: Write the failing test**

```tsx
import Hud from "./Hud";
import { tapeRangesFor } from "./ImmersiveHudBar";
// use the file's existing snapshot factory + tree walkers

describe("always-narrow rail", () => {
  const tapeRange = tapeRangesFor({ display: { asiMinKt: 40, asiMaxKt: 180 }, limits: { serviceCeilingM: 4100 } });

  it("renders the immersive bar on a narrow flight even when not immersive", () => {
    const tree = Hud({ snapshot: baseSnapshot(), attribution: "x", immersive: false, narrow: true, tapeRange });
    expect(classNamesIn(tree)).toContain("imm-hud");
  });

  it("does NOT fade the bar when narrow but not immersive", () => {
    const tree = Hud({ snapshot: baseSnapshot(), attribution: "x", immersive: false, narrow: true, faded: true, tapeRange });
    expect(classNamesIn(tree)).not.toContain("hud-faded");
  });

  it("keeps the desktop layout when neither immersive nor narrow", () => {
    const tree = Hud({ snapshot: baseSnapshot(), attribution: "x", immersive: false, narrow: false });
    expect(classNamesIn(tree)).not.toContain("imm-hud");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hud/Hud.test.tsx -t "always-narrow"`
Expected: FAIL — `Hud` has no `narrow` prop; narrow non-immersive still renders desktop tree.

- [ ] **Step 3: Write minimal implementation**

In `Hud.tsx`: add `narrow = false` and `tapeRange = null` to the props type + destructure. Change the branch guard and the root class, and pass `tapeRange` to `ImmersiveHudBar`:

```tsx
const showBar = immersive || narrow;
const rootClass =
  "hud-root" + (showBar ? " hud-immersive" : "") + (immersive && faded ? " hud-faded" : "");
// ...
if (showBar) {
  return (
    <div className={rootClass}>
      <ImmersiveHudBar
        snapshot={snapshot}
        attitudeStyle={attitudeStyle}
        variant={immersiveVariant}
        onVariantChange={onImmersiveVariantChange}
        navCue={immersiveNavCue}
        approachWarnings={immersiveApproachWarnings}
        tapeRange={tapeRange}
      />
      <div className="hud-attribution">{attribution}</div>
    </div>
  );
}
```

In `FlightSession.tsx` (the `<Hud .../>` mount, ~line 742): pass `narrow={narrow}` and `tapeRange={originParams ? tapeRangesFor(originParams) : null}`. Import `tapeRangesFor` from `../hud/ImmersiveHudBar`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hud/Hud.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hud/Hud.tsx frontend/src/game/FlightSession.tsx frontend/src/hud/Hud.test.tsx
git commit -m "feat(hud): render the compact rail on every narrow flight + thread tape range"
```

---

### Task 6: Throttle-state clarity

**Files:**
- Modify: `frontend/src/input/TouchControls.tsx`
- Test: `frontend/src/input/TouchControls.test.tsx` (create if absent)

**Interfaces:**
- Consumes: existing `TouchControls` props (`onThrottle`, `initialThrottle`, …). Read the file first for exact prop names and current throttle markup.
- Produces: the throttle shows an amber fill proportional to the value, a visible numeric `%`, and distinct end-stop markers. Add a pure helper `export function throttleFillPct(throttle: number): number` returning `clamp(round(throttle*100),0,100)` so the state is unit-testable without jsdom.

- [ ] **Step 1: Write the failing test**

```tsx
import { throttleFillPct } from "./TouchControls";

describe("throttle state", () => {
  it("maps throttle 0..1 to a clamped 0..100 fill", () => {
    expect(throttleFillPct(0)).toBe(0);
    expect(throttleFillPct(0.5)).toBe(50);
    expect(throttleFillPct(1)).toBe(100);
    expect(throttleFillPct(1.4)).toBe(100);
    expect(throttleFillPct(-0.2)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/input/TouchControls.test.tsx`
Expected: FAIL — `throttleFillPct` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `TouchControls.tsx`:

```tsx
export function throttleFillPct(throttle: number): number {
  return Math.min(100, Math.max(0, Math.round(throttle * 100)));
}
```

Use it in the throttle render: set the fill element height to `${throttleFillPct(value)}%`, show `${throttleFillPct(value)}%` as text, and add top/bottom end-stop marks (CSS in Task 7). Read the file for the current throttle markup and wire the helper into the existing fill/label, adding a `%` label and end-stop marker elements if missing.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/input/TouchControls.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/input/TouchControls.tsx frontend/src/input/TouchControls.test.tsx
git commit -m "feat(input): unmistakable touch-throttle state (fill + numeric % + end stops)"
```

---

### Task 7: Rich styling (CSS, scoped to .imm-hud)

**Files:**
- Modify: `frontend/src/styles/tokens.css` (the `.imm-*` block)
- No unit test — CSS. Verified by build + visual check.

**Interfaces:**
- Consumes: markup/classNames produced by Tasks 3–6 (`.imm-tape`, `.tape-window`, `.tape-strip`, `.tape-tick`, `.tape-ptr`, `.imm-sim-pill`/`.imm-bar-sim`, `.imm-bar-adi`).
- Produces: no code interface — the CSS `.tape-window` height MUST equal `TAPE_WINDOW_PX` (44px) from Task 1.

- [ ] **Step 1: Add the tape + rich CSS**

In `tokens.css`, scoped under `.imm-hud`, add (ported from the mock lines 118–181 with LORAN tokens):

```css
.imm-hud .imm-bar-tapes {
  display: grid;
  grid-template-columns: clamp(56px,16vw,86px) minmax(0,1fr) clamp(60px,17vw,92px);
  gap: 6px; padding: 6px 8px; min-height: 66px;
}
.imm-hud .imm-tape {
  position: relative; align-self: stretch; overflow: hidden; padding: 3px;
  display: grid; grid-template-rows: auto 1fr; gap: 2px;
  border: 1px solid rgba(150, 205, 220, 0.3); border-radius: 9px;
  background: linear-gradient(180deg, rgba(40,56,66,0.5), rgba(10,16,22,0.55));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
}
.imm-hud .tape-window { position: relative; width: 100%; height: 44px; overflow: hidden; } /* == TAPE_WINDOW_PX */
.imm-hud .tape-strip { position: absolute; left: 0; right: 0; bottom: 0; will-change: transform; }
.imm-hud .tape-tick { position: absolute; height: 1px; background: rgba(210,222,228,0.55); }
.imm-hud .tape-tick.major { width: 13px; background: rgba(230,238,242,0.8); }
.imm-hud .tape-tick.minor { width: 7px; }
.imm-hud .imm-tape[data-side="left"] .tape-tick { left: 3px; }
.imm-hud .imm-tape[data-side="right"] .tape-tick { right: 3px; }
.imm-hud .tape-tick .tt-label { position: absolute; top: -5px; font-size: 7px; color: #d7e2e7; opacity: 0.8; }
.imm-hud .imm-tape[data-side="left"] .tape-tick .tt-label { left: 16px; }
.imm-hud .imm-tape[data-side="right"] .tape-tick .tt-label { right: 16px; text-align: right; }
.imm-hud .tape-ptr { position: absolute; top: 50%; left: 3px; right: 3px; transform: translateY(-50%);
  z-index: 2; display: flex; justify-content: center; pointer-events: none; }
.imm-hud .tape-ptr .imm-field-value {
  min-width: 42px; padding: 3px 4px; text-align: center; font-size: 15px;
  border: 1px solid rgba(120,200,214,0.6); border-radius: 6px;
  background: linear-gradient(180deg, rgba(10,18,24,0.9), rgba(4,8,11,0.95));
  box-shadow: inset 0 0 6px rgba(95,215,224,0.12);
}
.imm-hud .tape-window::after { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 1px;
  background: rgba(255,176,0,0.55); z-index: 1; }
```

- [ ] **Step 2: Add rich panel + glossy ADI + amber pill (CSS-only ball gloss)**

```css
.imm-hud .imm-bar {
  border: 1px solid rgba(150,205,220,0.28); border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(30,44,54,0.62) 0%, rgba(8,13,18,0.82) 60%),
    rgba(6,10,14,0.4);
  box-shadow: 0 6px 18px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06);
  backdrop-filter: blur(3px);
}
.imm-hud .imm-bar-sim { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px;
  border: 1px solid var(--amber); border-radius: 999px;
  background: linear-gradient(180deg, rgba(255,176,0,0.22), rgba(255,176,0,0.08));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.15); }
/* glossy highlight over the shared ADI without touching its SVG */
.imm-hud .imm-bar-adi { position: relative; }
.imm-hud .imm-bar-adi::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  background: radial-gradient(60% 60% at 38% 26%,
    rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.06) 45%, rgba(255,255,255,0) 100%);
}
```

- [ ] **Step 3: Add throttle end-stop + fill CSS (Task 6 hooks)**

Add the fill/`%`/end-stop styles matching the elements Task 6 introduced (amber fill, high-contrast `%`, 0/100 tick marks). Keep it under the touch-controls scope, not global.

- [ ] **Step 4: Build + visual verify**

Run: `cd frontend && npm run build`
Then run the app and confirm on a narrow viewport (real Cesium terrain): tapes scroll past the amber pointer, ball looks glossy, panels rounded/translucent, SIM pill amber, touch stick/throttle/buttons uncovered, desktop dashboard visually unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles/tokens.css
git commit -m "style(hud): rich flight-surface look — rounded/translucent panels, glossy ball, amber pill, tape CSS"
```

---

### Task 8: Full-gate verification + running check

**Files:** none (verification only).

- [ ] **Step 1: Run the whole gate**

Run: `cd frontend && npm run test:unit && npm run typecheck:app && npm run build && npm run lint`
Expected: all pass; test count ≥ the pre-existing ~1,150 plus the new tests.

- [ ] **Step 2: Run against real Cesium terrain**

Start the app (dev server + backend per repo README), fly a mission on a narrow viewport, confirm the tapes read live sim values (climb → ALT ticks scroll; throttle up → IAS ticks scroll), the SIM badge shows with no callsign/class on the rail, and callsign/class appear on the spawn card + debrief.

- [ ] **Step 3: Update the checklist + decisions**

Mark the mobile-rich-HUD items done in `docs/summaries/CHECKLIST.md`; append a dated `docs/decisions.md` entry noting the CSS-only glossy-ADI approach and the fixed `TAPE_WINDOW_PX`↔`.tape-window` height coupling.

- [ ] **Step 4: Commit**

```bash
git add docs/summaries/CHECKLIST.md docs/decisions.md
git commit -m "docs: mark mobile rich HUD done; record glossy-ADI + tape-window decisions"
```

---

## Self-Review

**Spec coverage:**
- Functional tapes → Tasks 1, 3, 7. ✓
- Per-class ranges → Task 2. ✓
- Rich styling scoped to `.imm-hud` → Task 7. ✓
- UI-002 declutter → Task 4. ✓
- Always-narrow rail → Task 5. ✓
- Throttle clarity → Task 6. ✓
- Verify on Cesium + gate → Task 8. ✓
- NOT-in-scope items (browser cockpit, contrast audit, onboarding, binaries, funnel) → absent by design. ✓

**Type consistency:** `TapeRange`, `tapeTicks`, `tapeStripOffset`, `TAPE_WINDOW_PX`, `tapeRangesFor`, `throttleFillPct` used with identical signatures across Tasks 1–7. `Tape` value is display units (kt/ft); ranges are display units. `Hud` props `narrow`/`tapeRange` match `FlightSession` mount. ✓

**Placeholder scan:** the Task 3 Step 1 draft has a deliberately-discarded first `it` (flagged and replaced inline with the note about walking plain objects). No `TBD`/`TODO`/"handle edge cases". Panel edits (Task 4) and throttle markup (Task 6) say "read the file first" because exact existing markup must be matched — the *helper* and *assertions* are fully specified. ✓
