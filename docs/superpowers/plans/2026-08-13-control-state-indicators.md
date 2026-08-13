# Graphic Control-State Indicators (#48) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the text-only control-state readouts with small vector "mini-instrument" indicators (throttle lever, flap droop, trim needle + center gate, gear strut/wheel, speedbrake boards) across the desktop glass strip, desktop HUD bottom, and mobile rails.

**Architecture:** One pure geometry module (`ControlIconMath.ts`, unit-tested without a DOM, mirroring `dashboard/gaugeMath.ts`) drives one hook-free presentational component (`ControlIcon.tsx`, walked as a plain function like `AttitudeIndicator.tsx`/`ControlState.tsx`). A tiny `ControlIconCell` wraps icon + label + optional value so all three surfaces share layout. Class differences are data (gear `fixed` vs animated `gearPosition`; speedbrake cell gated on a `hasSpeedbrake` snapshot flag) — no `class===` branches.

**Tech Stack:** Vite · React 18 + TypeScript · Vitest · hand-written inline SVG · CSS tokens in `styles/tokens.css`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-13-control-state-indicators-design.md`. Approved idiom + geometry source of truth: mock `https://claude.ai/code/artifact/432c000e-859a-44c6-8515-fbc6dc4393dc`.

## Global Constraints

- **Live prod branch** (`mongols-rich-hud` → fly.voygent.app): commit per task; do NOT deploy until owner sign-off.
- **Gate green every task:** `cd frontend && npm run typecheck && npm run test:unit && npm run lint`. Lint ≤ 8 warnings; 5 pre-existing — **add none**. Suite baseline 1286 green.
- **No new dependencies** (spec §14 / CLAUDE.md — ask before adding any).
- **Visual language:** strokes only, `fill:none` beyond the established faint gauge tints; colors are `var(--cyan) #5fd7e0` (nominal) and `var(--amber) #ffb000` (warning/active) ONLY; track/detent marks reuse the existing `.gauge-tick`/`.gauge-race` grey (`var(--grid)`) — invent no new token; monospace uppercase letterspaced labels.
- **Honesty rule:** an unknown reading is `null` → the view hides that glyph / shows em-dash, never a fabricated zero.
- **Data-not-branches:** behavior comes from snapshot fields (`gear`, `gearPosition`, `hasSpeedbrake`, `flapDetentIndex`, `flapDetentCount`), never a class-name switch.
- **Surgical diffs:** touch only what each task needs; don't reformat neighbors.

---

### Task 1: `ControlIconMath.ts` — pure geometry

**Files:**
- Create: `frontend/src/hud/controls/ControlIconMath.ts`
- Test: `frontend/src/hud/controls/ControlIconMath.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module, plain numbers in/out).
- Produces:
  - `TRIM_FULL_SCALE: number` (= 0.30)
  - `throttleKnobY(throttle: number | null): number | null`
  - `throttleWarn(throttle: number | null): boolean`
  - `flapDroopEnd(index: number | null, count: number | null): { x: number; y: number; active: boolean } | null`
  - `trimNeedle(trim: number | null): { y: number; neutral: boolean; pegged: boolean } | null`
  - `gearGlyph(gear: "fixed" | "retractable" | null, gearPosition: number | null): { wheelY: number; strutTopY: number; transit: boolean; fixed: boolean } | null`
  - `speedbrakeOut(speedbrake: boolean | null | undefined): boolean`

Geometry is in a 40×38 SVG viewBox. Hinge/track constants come from the approved mock.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/hud/controls/ControlIconMath.test.ts
import { describe, it, expect } from "vitest";
import {
  TRIM_FULL_SCALE, throttleKnobY, throttleWarn, flapDroopEnd,
  trimNeedle, gearGlyph, speedbrakeOut,
} from "./ControlIconMath";

describe("ControlIconMath", () => {
  it("throttle knob rides the track and is monotonic; unknown is null", () => {
    expect(throttleKnobY(null)).toBeNull();
    expect(throttleKnobY(0)).toBeCloseTo(32);   // bottom of track at idle
    expect(throttleKnobY(1)).toBeCloseTo(6);     // top at full
    expect(throttleKnobY(0.5)!).toBeGreaterThan(throttleKnobY(0.9)!); // higher throttle = smaller y
  });

  it("throttle warns only near the top", () => {
    expect(throttleWarn(0.8)).toBe(false);
    expect(throttleWarn(0.95)).toBe(true);
    expect(throttleWarn(null)).toBe(false);
  });

  it("flap trailing edge droops further with detent; clean is level and inactive", () => {
    const clean = flapDroopEnd(0, 5)!;
    const full = flapDroopEnd(4, 5)!;
    expect(clean.active).toBe(false);
    expect(clean.y).toBeCloseTo(17);            // level with the chord at detent 0
    expect(full.active).toBe(true);
    expect(full.y).toBeGreaterThan(clean.y);     // trailing edge lower (larger y) at full
    expect(flapDroopEnd(null, null)).toBeNull();
    expect(flapDroopEnd(1, 1)!.y).toBeCloseTo(17); // count 1 → no droop, never divide by zero
  });

  it("trim needle offsets from the center gate and flags neutral / pegged", () => {
    expect(trimNeedle(0)!.neutral).toBe(true);
    expect(trimNeedle(0)!.y).toBeCloseTo(19);         // on the gate
    expect(trimNeedle(TRIM_FULL_SCALE)!.y).toBeCloseTo(7);   // nose-up pegs high (small y)
    expect(trimNeedle(-TRIM_FULL_SCALE)!.y).toBeCloseTo(31); // nose-down pegs low
    expect(trimNeedle(0.5)!.pegged).toBe(true);       // beyond full-scale
    expect(trimNeedle(0.1)!.neutral).toBe(false);
    expect(trimNeedle(null)).toBeNull();
  });

  it("gear wheel extends with position; transit only mid-travel; fixed is flagged", () => {
    expect(gearGlyph("fixed", 1)!.fixed).toBe(true);
    const up = gearGlyph("retractable", 0)!;
    const down = gearGlyph("retractable", 1)!;
    const mid = gearGlyph("retractable", 0.5)!;
    expect(down.wheelY).toBeGreaterThan(up.wheelY);   // down = wheel lower
    expect(up.transit).toBe(false);
    expect(down.transit).toBe(false);
    expect(mid.transit).toBe(true);
    expect(gearGlyph(null, null)).toBeNull();
  });

  it("speedbrake out is a plain boolean, absent reads stowed", () => {
    expect(speedbrakeOut(true)).toBe(true);
    expect(speedbrakeOut(false)).toBe(false);
    expect(speedbrakeOut(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hud/controls/ControlIconMath.test.ts`
Expected: FAIL — cannot resolve `./ControlIconMath`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/hud/controls/ControlIconMath.ts
/*
 * Pure geometry for the control-state mini-instruments (#48). No React, no SVG strings, no
 * snapshot type: plain numbers in, plain numbers out, so the shapes are testable without a
 * renderer — same discipline as dashboard/gaugeMath.ts. Coordinates live in a 40x38 viewBox.
 *
 * Honesty rule: an unknown reading returns null; the view hides that glyph rather than drawing
 * a fabricated zero.
 */

/** Trim value that pegs the needle at the end-stop. Legibility knob, tuned on-device (spec §"tuning knobs"). */
export const TRIM_FULL_SCALE = 0.3;

const known = (v: number | null | undefined): v is number =>
  v !== null && v !== undefined && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// throttle lever: a knob sliding a vertical track from y=32 (idle) to y=6 (full).
const THR_TOP = 6, THR_BOT = 32;
export function throttleKnobY(throttle: number | null): number | null {
  if (!known(throttle)) return null;
  return THR_BOT - clamp(throttle, 0, 1) * (THR_BOT - THR_TOP);
}
export function throttleWarn(throttle: number | null): boolean {
  return known(throttle) && throttle > 0.92;
}

// flap trailing edge hinged at (27,17), length 11, drooping down to 58deg at full detent.
const FLAP_HINGE_X = 27, FLAP_HINGE_Y = 17, FLAP_LEN = 11, FLAP_MAX_DEG = 58;
export function flapDroopEnd(
  index: number | null,
  count: number | null,
): { x: number; y: number; active: boolean } | null {
  if (!known(index) || !known(count)) return null;
  const frac = count > 1 ? clamp(index, 0, count - 1) / (count - 1) : 0;
  const rad = (frac * FLAP_MAX_DEG * Math.PI) / 180;
  return {
    x: FLAP_HINGE_X + FLAP_LEN * Math.cos(rad),
    y: FLAP_HINGE_Y + FLAP_LEN * Math.sin(rad),
    active: index > 0,
  };
}

// trim needle: apex slides above/below the fixed center gate at y=19; +trim (nose-up) = smaller y.
const TRIM_CENTER_Y = 19, TRIM_SWING = 12, TRIM_NEUTRAL_EPS = 0.005;
export function trimNeedle(
  trim: number | null,
): { y: number; neutral: boolean; pegged: boolean } | null {
  if (!known(trim)) return null;
  const n = clamp(trim / TRIM_FULL_SCALE, -1, 1);
  return {
    y: TRIM_CENTER_Y - n * TRIM_SWING,
    neutral: Math.abs(trim) < TRIM_NEUTRAL_EPS,
    pegged: Math.abs(trim / TRIM_FULL_SCALE) > 1,
  };
}

// gear: wheel slides from y=15 (tucked up) to y=28 (extended down) with gearPosition.
const GEAR_UP_Y = 15, GEAR_DOWN_Y = 28, GEAR_STRUT_TOP = 14;
export function gearGlyph(
  gear: "fixed" | "retractable" | null,
  gearPosition: number | null,
): { wheelY: number; strutTopY: number; transit: boolean; fixed: boolean } | null {
  if (gear === "fixed") {
    return { wheelY: GEAR_DOWN_Y, strutTopY: GEAR_STRUT_TOP, transit: false, fixed: true };
  }
  if (gear !== "retractable" || !known(gearPosition)) return null;
  const p = clamp(gearPosition, 0, 1);
  return {
    wheelY: GEAR_UP_Y + p * (GEAR_DOWN_Y - GEAR_UP_Y),
    strutTopY: GEAR_STRUT_TOP,
    transit: p > 0 && p < 1,
    fixed: false,
  };
}

export function speedbrakeOut(speedbrake: boolean | null | undefined): boolean {
  return speedbrake === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hud/controls/ControlIconMath.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hud/controls/ControlIconMath.ts frontend/src/hud/controls/ControlIconMath.test.ts
git commit -m "feat(hud): pure control-icon geometry module (#48)"
```

---

### Task 2: Snapshot fields + flightLoop wiring

**Files:**
- Modify: `frontend/src/hud/snapshot.ts` (add 3 optional fields to `HudSnapshot`)
- Modify: `frontend/src/game/flightLoop.ts:143` (populate them in the snapshot build)
- Test: `frontend/src/game/flapDetentSnapshot.test.ts` (create — a focused mapping test)

**Interfaces:**
- Consumes: existing `controls.flapDetent: number`, `params.flaps: FlapDetent[]`, `params.aero.speedbrakeCd0: number`.
- Produces on `HudSnapshot`: `flapDetentIndex?: number`, `flapDetentCount?: number`, `hasSpeedbrake?: boolean`. Optional (like `afterburner?`/`speedbrake?`) so existing snapshot fixtures need no rework; absent → clean flaps / no airbrake.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/game/flapDetentSnapshot.test.ts
import { describe, it, expect } from "vitest";
import { buildFlapDetentFields } from "./flightLoop";

describe("flap detent + speedbrake snapshot fields (#48)", () => {
  it("surfaces the live detent index, the class detent count, and airbrake presence", () => {
    const params = { flaps: [{ label: "UP" }, { label: "10" }, { label: "20" }], aero: { speedbrakeCd0: 0.05 } };
    const controls = { flapDetent: 2 };
    expect(buildFlapDetentFields(params as never, controls as never)).toEqual({
      flapDetentIndex: 2, flapDetentCount: 3, hasSpeedbrake: true,
    });
  });
  it("reports no airbrake when speedbrakeCd0 is 0 (C172)", () => {
    const params = { flaps: [{ label: "UP" }, { label: "FULL" }], aero: { speedbrakeCd0: 0 } };
    const controls = { flapDetent: 0 };
    expect(buildFlapDetentFields(params as never, controls as never)).toEqual({
      flapDetentIndex: 0, flapDetentCount: 2, hasSpeedbrake: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/game/flapDetentSnapshot.test.ts`
Expected: FAIL — `buildFlapDetentFields` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/hud/snapshot.ts`, add to the `HudSnapshot` type (next to `flapLabel`), copying the optional-field comment style already used for `afterburner`/`speedbrake`:

```ts
  /** Live flap detent index (0 = clean) and the class's total detent count, for the #48 flap glyph.
   *  Optional like afterburner/speedbrake so existing fixtures need no rework; absent reads as clean. */
  flapDetentIndex?: number;
  flapDetentCount?: number;
  /** Class has an airbrake (aero.speedbrakeCd0 > 0). Gates the #48 speedbrake glyph; absent reads false. */
  hasSpeedbrake?: boolean;
```

In `frontend/src/game/flightLoop.ts`, add a tiny exported helper near the top-level (module scope, not inside the loop) and use it in the snapshot literal. Import types as already imported in that file (`ClassParams`, `ControlVector`):

```ts
// exported so the mapping is unit-testable without spinning the 60 Hz loop (#48).
export function buildFlapDetentFields(
  params: ClassParams,
  controls: ControlVector,
): { flapDetentIndex: number; flapDetentCount: number; hasSpeedbrake: boolean } {
  return {
    flapDetentIndex: controls.flapDetent,
    flapDetentCount: params.flaps.length,
    hasSpeedbrake: params.aero.speedbrakeCd0 > 0,
  };
}
```

Then in the snapshot object (currently line ~143, right after `flapLabel: params.flaps[controls.flapDetent].label,`) spread the helper:

```ts
      flapLabel: params.flaps[controls.flapDetent].label,
      ...buildFlapDetentFields(params, controls),
```

(If `ControlVector`/`ClassParams` are not already imported in `flightLoop.ts`, add them to the existing `import type { … } from "../sim/types";` line — check first; do not duplicate the import.)

- [ ] **Step 4: Run test + typecheck**

Run: `cd frontend && npx vitest run src/game/flapDetentSnapshot.test.ts && npm run typecheck`
Expected: PASS (2 tests) and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hud/snapshot.ts frontend/src/game/flightLoop.ts frontend/src/game/flapDetentSnapshot.test.ts
git commit -m "feat(hud): surface flap detent index/count + hasSpeedbrake on the snapshot (#48)"
```

---

### Task 3: `ControlIcon` + `ControlIconCell` components + CSS

**Files:**
- Create: `frontend/src/hud/controls/ControlIcon.tsx`
- Create: `frontend/src/hud/controls/ControlIconCell.tsx`
- Modify: `frontend/src/styles/tokens.css` (append a `.control-icon*` block)
- Test: `frontend/src/hud/controls/ControlIcon.test.tsx`

**Interfaces:**
- Consumes: `ControlIconMath` (Task 1).
- Produces:
  - `ControlIcon({ kind, snapshot, size? })` where `kind: "throttle" | "flaps" | "trim" | "gear" | "speedbrake"`, `snapshot: HudSnapshot | null`, `size?: number` (px, default 40). Hook-free; returns an `<svg>` element tree. Amber stroke class (`ci-am`) on warning states, cyan (`ci-cy`) otherwise; grey (`ci-gr`) for track/detent.
  - `ControlIconCell({ kind, snapshot, label, value?, valueTone? })` — a flex column: `<ControlIcon>` + uppercase `label` + optional `value` line (`valueTone: "cyan" | "amber" | "dim"`, default cyan). Hook-free.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/hud/controls/ControlIcon.test.tsx
import { describe, it, expect } from "vitest";
import ControlIcon from "./ControlIcon";
import type { HudSnapshot } from "../snapshot";
import { ktToMs, ftToM, degToRad } from "../../sim/units";

/** No jsdom: React elements are plain objects — collect every className in the returned tree. */
function collectClasses(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) collectClasses(c, out); return out; }
  const props = (node as { props?: { className?: unknown; children?: unknown } }).props;
  if (props && typeof props.className === "string") out.push(props.className);
  if (props && "children" in props) collectClasses(props.children, out);
  return out;
}

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500), verticalSpeedMs: 0,
  headingRad: 0, pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  latDeg: 30, lonDeg: -88, aoaRad: degToRad(3), loadFactor: 1,
  throttle: 0.6, trim: 0, flapLabel: "0", gear: "fixed", stalled: false, overspeed: false,
  gLimited: false, terrainClearanceM: ftToM(2000), terrainUnverified: false, simRate: 1,
  airtimeS: 0, classLabel: "C172S", callsign: "SIM-A1B2C3", modelNote: "M",
  machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false, lightPhase: "day",
  ...o,
});

describe("ControlIcon", () => {
  it("draws every kind without throwing and returns an svg", () => {
    for (const kind of ["throttle", "flaps", "trim", "gear", "speedbrake"] as const) {
      const el = ControlIcon({ kind, snapshot: snap() });
      expect((el as { type?: unknown }).type).toBe("svg");
    }
  });
  it("throttle goes amber near full power", () => {
    expect(collectClasses(ControlIcon({ kind: "throttle", snapshot: snap({ throttle: 0.5 }) })).some(c => c.includes("ci-am"))).toBe(false);
    expect(collectClasses(ControlIcon({ kind: "throttle", snapshot: snap({ throttle: 0.98 }) })).some(c => c.includes("ci-am"))).toBe(true);
  });
  it("trim needle is amber off the detent, cyan on it", () => {
    expect(collectClasses(ControlIcon({ kind: "trim", snapshot: snap({ trim: 0 }) })).some(c => c.includes("ci-am"))).toBe(false);
    expect(collectClasses(ControlIcon({ kind: "trim", snapshot: snap({ trim: 0.2 }) })).some(c => c.includes("ci-am"))).toBe(true);
  });
  it("gear goes amber in transit", () => {
    expect(collectClasses(ControlIcon({ kind: "gear", snapshot: snap({ gear: "retractable", gearPosition: 0.5 }) })).some(c => c.includes("ci-am"))).toBe(true);
  });
  it("speedbrake boards are amber when out", () => {
    expect(collectClasses(ControlIcon({ kind: "speedbrake", snapshot: snap({ speedbrake: true }) })).some(c => c.includes("ci-am"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hud/controls/ControlIcon.test.tsx`
Expected: FAIL — cannot resolve `./ControlIcon`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/hud/controls/ControlIcon.tsx
/*
 * The #48 control-state mini-instruments. Hook-free like AttitudeIndicator so the tests walk
 * the returned element tree without jsdom. All geometry comes from ControlIconMath; this file
 * only turns numbers into strokes. Cyan = nominal, amber = warning/active, grey = track/detent
 * — the only three stroke roles (spec visual language). fill:none throughout.
 */
import type { HudSnapshot } from "../snapshot";
import {
  throttleKnobY, throttleWarn, flapDroopEnd, trimNeedle, gearGlyph, speedbrakeOut,
} from "./ControlIconMath";

export type ControlIconKind = "throttle" | "flaps" | "trim" | "gear" | "speedbrake";

const CY = "ci-cy", AM = "ci-am", GR = "ci-gr";
const r = (n: number): number => Math.round(n * 100) / 100;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 40 38" className="control-icon" role="img" aria-hidden="true">
      {children}
    </svg>
  );
}

export default function ControlIcon({
  kind, snapshot,
}: { kind: ControlIconKind; snapshot: HudSnapshot | null; size?: number }) {
  if (kind === "throttle") {
    const y = throttleKnobY(snapshot?.throttle ?? null);
    const acc = throttleWarn(snapshot?.throttle ?? null) ? AM : CY;
    return (
      <Frame>
        <line className={GR} x1="20" y1="6" x2="20" y2="32" />
        <line className={GR} x1="15" y1="6" x2="20" y2="6" />
        <line className={GR} x1="15" y1="19" x2="18" y2="19" />
        <line className={GR} x1="15" y1="32" x2="20" y2="32" />
        {y !== null && <line className={acc} x1="11" y1={r(y)} x2="29" y2={r(y)} />}
        {y !== null && <rect className={acc} x="17.5" y={r(y - 2.5)} width="5" height="5" />}
      </Frame>
    );
  }
  if (kind === "flaps") {
    const end = flapDroopEnd(snapshot?.flapDetentIndex ?? 0, snapshot?.flapDetentCount ?? 1);
    return (
      <Frame>
        <line className={CY} x1="7" y1="17" x2="27" y2="17" />
        <line className={GR} x1="27" y1="17" x2="38" y2="17" />
        {end && <line className={end.active ? AM : CY} x1="27" y1="17" x2={r(end.x)} y2={r(end.y)} />}
        <circle className="ci-cyf" cx="27" cy="17" r="1.3" />
      </Frame>
    );
  }
  if (kind === "trim") {
    const n = trimNeedle(snapshot?.trim ?? null);
    return (
      <Frame>
        <line className={GR} x1="20" y1="6" x2="20" y2="32" />
        <line className={GR} x1="17.5" y1="9" x2="20" y2="9" />
        <line className={GR} x1="17.5" y1="29" x2="20" y2="29" />
        <line className={CY} x1="12" y1="19" x2="16.5" y2="19" />
        <line className={CY} x1="23.5" y1="19" x2="28" y2="19" />
        {n && (
          <polygon
            className={n.neutral ? "ci-cyf" : "ci-amf"}
            points={`20,${r(n.y)} 15.5,${r(n.y - 3)} 15.5,${r(n.y + 3)}`}
          />
        )}
      </Frame>
    );
  }
  if (kind === "gear") {
    const g = gearGlyph(snapshot?.gear ?? null, snapshot?.gearPosition ?? null);
    const acc = g?.transit ? AM : CY;
    return (
      <Frame>
        <line className={GR} x1="9" y1="13" x2="31" y2="13" />
        <path className={`${GR} ci-dash`} d="M15 13 h10 v3 h-10 z" />
        {g && <line className={acc} x1="20" y1={r(g.strutTopY)} x2="20" y2={r(g.wheelY - 4)} />}
        {g && <circle className={acc} cx="20" cy={r(g.wheelY)} r="3.6" />}
      </Frame>
    );
  }
  // speedbrake
  const out = speedbrakeOut(snapshot?.speedbrake);
  return (
    <Frame>
      <path className={CY} d="M8 22 Q20 16 34 20" />
      {out ? (
        <>
          <line className={AM} x1="19" y1="18.4" x2="24" y2="9" />
          <line className={AM} x1="24" y1="9" x2="27" y2="10" />
        </>
      ) : (
        <line className={GR} x1="18" y1="18.6" x2="26" y2="17.4" />
      )}
    </Frame>
  );
}
```

```tsx
// frontend/src/hud/controls/ControlIconCell.tsx
/*
 * One control-state cell: the #48 mini-instrument, its uppercase label, and (for the
 * quantitative controls) a value line. Shared by the desktop glass strip, the desktop HUD
 * bottom, and the mobile rails so all three lay out identically. Hook-free.
 */
import type { HudSnapshot } from "../snapshot";
import ControlIcon, { type ControlIconKind } from "./ControlIcon";

export default function ControlIconCell({
  kind, snapshot, label, value, valueTone = "cyan",
}: {
  kind: ControlIconKind;
  snapshot: HudSnapshot | null;
  label: string;
  value?: string | null;
  valueTone?: "cyan" | "amber" | "dim";
}) {
  return (
    <div className="control-icon-cell">
      <ControlIcon kind={kind} snapshot={snapshot} />
      <span className="control-icon-label">{label}</span>
      {value != null && value !== "" && (
        <span className={`control-icon-value tone-${valueTone}`}>{value}</span>
      )}
    </div>
  );
}
```

Append to `frontend/src/styles/tokens.css` (end of file):

```css
/* ---- #48 control-state mini-instruments ------------------------------------------- */
.control-icon { display: block; width: 40px; height: 38px; overflow: visible; }
.control-icon line, .control-icon path, .control-icon polygon, .control-icon circle { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.control-icon .ci-cy { stroke: var(--cyan); stroke-width: 1.4; }
.control-icon .ci-am { stroke: var(--amber); stroke-width: 1.4; }
.control-icon .ci-gr { stroke: var(--grid); stroke-width: 1; }
.control-icon .ci-cyf { fill: var(--cyan); stroke: none; }
.control-icon .ci-amf { fill: var(--amber); stroke: none; }
.control-icon .ci-dash { stroke-dasharray: 2 2; }
.control-icon-cell { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; }
.control-icon-label { font-size: 8.5px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--text); opacity: 0.55; white-space: nowrap; }
.control-icon-value { font-size: 10.5px; letter-spacing: 0.03em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.control-icon-value.tone-cyan { color: var(--cyan); }
.control-icon-value.tone-amber { color: var(--amber); }
.control-icon-value.tone-dim { color: var(--text); opacity: 0.5; }
```

(If `tokens.css` has no `--grid`/`--cyan`/`--amber` you are wrong file — they are defined at its top per the spec; reuse, don't redefine.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hud/controls/ControlIcon.test.tsx && npm run typecheck`
Expected: PASS (5 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hud/controls/ControlIcon.tsx frontend/src/hud/controls/ControlIconCell.tsx frontend/src/hud/controls/ControlIcon.test.tsx frontend/src/styles/tokens.css
git commit -m "feat(hud): control-icon SVG component + shared cell + styles (#48)"
```

---

### Task 4: Desktop glass control strip (`ControlState.tsx`)

**Files:**
- Modify: `frontend/src/dashboard/ControlState.tsx` (swap the 4 text spans for icon cells; add the gated speedbrake cell)
- Modify: `frontend/src/dashboard/ControlState.test.tsx` (assert cells + gating; keep the honesty test)

**Interfaces:**
- Consumes: `ControlIconCell` (Task 3), the new snapshot fields (Task 2), existing `format.ts` helpers.
- Produces: the same `.control-state` container, now holding `ControlIconCell`s. Order: THR, FLP, TRIM, GEAR, and SPD BRK **only when `snapshot.hasSpeedbrake`**.

- [ ] **Step 1: Write the failing test** (extend the existing file — replace its body)

```tsx
import { describe, it, expect } from "vitest";
import ControlState from "./ControlState";
import type { HudSnapshot } from "../hud/snapshot";
import { ktToMs, ftToM, degToRad } from "../sim/units";

function collect(node: unknown, out: { text: string[]; labels: string[] } = { text: [], labels: [] }) {
  if (node == null || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") { out.text.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collect(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof type === "function") return collect((type as (p: unknown) => unknown)(props), out);
  if (props?.kind) out.labels.push(String(props.kind)); // ControlIcon(Cell) kind
  if (props && "children" in props) collect(props.children, out);
  return out;
}

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500), verticalSpeedMs: 0,
  headingRad: 0, pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  latDeg: 30, lonDeg: -88, aoaRad: degToRad(3), loadFactor: 1,
  throttle: 0.6, trim: 0, flapLabel: "0", gear: "fixed", stalled: false, overspeed: false,
  gLimited: false, terrainClearanceM: ftToM(2000), terrainUnverified: false, simRate: 1,
  airtimeS: 0, classLabel: "C172S", callsign: "SIM-A1B2C3", modelNote: "M",
  machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false, lightPhase: "day",
  ...o,
});

describe("ControlState (#48 graphic)", () => {
  it("renders throttle/flaps/trim/gear icon cells with their values", () => {
    const r = collect(ControlState({ snapshot: snap({ throttle: 0.6, trim: 0.25, flapLabel: "10", flapDetentIndex: 1, flapDetentCount: 5 }) }));
    expect(r.labels).toEqual(expect.arrayContaining(["throttle", "flaps", "trim", "gear"]));
    expect(r.text.join(" ")).toContain("60%");
    expect(r.text.join(" ")).toContain("10");
    expect(r.text.join(" ")).toContain("NOSE UP 25%");
  });
  it("adds a speedbrake cell only when the class has an airbrake", () => {
    expect(collect(ControlState({ snapshot: snap({ hasSpeedbrake: true }) })).labels).toContain("speedbrake");
    expect(collect(ControlState({ snapshot: snap({ hasSpeedbrake: false }) })).labels).not.toContain("speedbrake");
  });
  it("still em-dashes an unknown snapshot rather than inventing a value (honesty rule)", () => {
    expect(collect(ControlState({ snapshot: null })).text.join(" ")).toContain("—");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/dashboard/ControlState.test.tsx`
Expected: FAIL — no `kind` props yet (labels empty).

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/dashboard/ControlState.tsx
/*
 * The cockpit control-state readout (#7/#48): throttle, flaps, trim, gear — and speedbrake for
 * classes that have one — as LORAN mini-instruments (ControlIconCell). Value strings still come
 * from hud/format.ts so this panel can never disagree with the HUD; unknown reads as an em-dash.
 * Hook-free so the test walks the returned tree without jsdom.
 */
import type { HudSnapshot } from "../hud/snapshot";
import { formatThrottlePct, formatFlaps, formatTrim } from "../hud/format";
import ControlIconCell from "../hud/controls/ControlIconCell";

export default function ControlState({ snapshot }: { snapshot: HudSnapshot | null }) {
  const throttle = snapshot?.throttle ?? null;
  const trim = snapshot?.trim ?? null;
  const flapLabel = snapshot?.flapLabel ?? null;
  const trimText = formatTrim(trim);
  return (
    <div className="control-state">
      <ControlIconCell kind="throttle" snapshot={snapshot} label="THR"
        value={formatThrottlePct(throttle)} valueTone={throttle != null && throttle > 0.92 ? "amber" : "cyan"} />
      <ControlIconCell kind="flaps" snapshot={snapshot} label="FLP"
        value={flapLabel ?? "—"} />
      <ControlIconCell kind="trim" snapshot={snapshot} label="TRM"
        value={trimText} valueTone={trimText === "NEUTRAL" ? "dim" : "cyan"} />
      <ControlIconCell kind="gear" snapshot={snapshot} label="GEAR" />
      {snapshot?.hasSpeedbrake && (
        <ControlIconCell kind="speedbrake" snapshot={snapshot} label="SPD BRK"
          value={snapshot?.speedbrake ? "OUT" : null} valueTone="amber" />
      )}
    </div>
  );
}
```

Note: `formatFlaps` is no longer used here (label shown bare beside the icon); remove it from the import if lint flags it as unused. The gear cell is icon-only (label + glyph carry state: FIXED shows the static wheel, UP/DOWN/transit from `gearPosition`).

- [ ] **Step 4: Run test + gate**

Run: `cd frontend && npx vitest run src/dashboard/ControlState.test.tsx && npm run typecheck && npm run lint`
Expected: PASS (3 tests), typecheck clean, lint adds no warnings.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/dashboard/ControlState.tsx frontend/src/dashboard/ControlState.test.tsx
git commit -m "feat(dashboard): graphic control-state icons on the glass strip + gated speedbrake (#48)"
```

---

### Task 5: Desktop HUD bottom strip (`Hud.tsx`)

**Files:**
- Modify: `frontend/src/hud/Hud.tsx` (`.hud-bottom`, ~lines 169-175) — swap THR/FLP/GEAR/SPDBRK text spans for icon cells; ADD the missing trim cell.
- Test: `frontend/src/hud/HudBottom.test.tsx` (create — focused walk test; do NOT try to render the whole Hud if it reads the store)

**Interfaces:**
- Consumes: `ControlIconCell`, snapshot fields, `format.ts`.
- Produces: `.hud-bottom` now holds icon cells (THR, FLP, TRM, GEAR, + SPD BRK when `hasSpeedbrake`). `lightPhase` span stays as-is.

**Note on testing:** `Hud.tsx` may consume the snapshot via a hook. Do NOT import and call `Hud` in the test if so. Instead, extract the bottom strip into a small hook-free sub-component `HudControlRow({ snapshot })` inside `Hud.tsx` (exported) and test THAT — same pattern as `ControlState`. This keeps the strip walkable and the change surgical.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/hud/HudBottom.test.tsx
import { describe, it, expect } from "vitest";
import { HudControlRow } from "./Hud";
import type { HudSnapshot } from "./snapshot";
import { ktToMs, ftToM, degToRad } from "../sim/units";

function kinds(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) kinds(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof type === "function") return kinds((type as (p: unknown) => unknown)(props), out);
  if (props?.kind) out.push(String(props.kind));
  if (props && "children" in props) kinds(props.children, out);
  return out;
}
const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500), verticalSpeedMs: 0,
  headingRad: 0, pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0, latDeg: 30, lonDeg: -88,
  aoaRad: degToRad(3), loadFactor: 1, throttle: 0.6, trim: 0, flapLabel: "0", gear: "fixed",
  stalled: false, overspeed: false, gLimited: false, terrainClearanceM: ftToM(2000),
  terrainUnverified: false, simRate: 1, airtimeS: 0, classLabel: "C172S", callsign: "SIM-A1",
  modelNote: "M", machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false,
  lightPhase: "day", ...o,
});

describe("HUD bottom control row (#48)", () => {
  it("shows throttle, flaps, trim and gear icon cells (trim added)", () => {
    expect(kinds(HudControlRow({ snapshot: snap() }))).toEqual(expect.arrayContaining(["throttle", "flaps", "trim", "gear"]));
  });
  it("shows the speedbrake cell only for airbrake classes", () => {
    expect(kinds(HudControlRow({ snapshot: snap({ hasSpeedbrake: true }) }))).toContain("speedbrake");
    expect(kinds(HudControlRow({ snapshot: snap({ hasSpeedbrake: false }) }))).not.toContain("speedbrake");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hud/HudBottom.test.tsx`
Expected: FAIL — `HudControlRow` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/hud/Hud.tsx`, add the exported hook-free row component (near the other local components), reusing the same value logic as `ControlState`:

```tsx
export function HudControlRow({ snapshot }: { snapshot: HudSnapshot | null }) {
  const throttle = snapshot?.throttle ?? null;
  const trimText = formatTrim(snapshot?.trim ?? null);
  return (
    <>
      <ControlIconCell kind="throttle" snapshot={snapshot} label="THR"
        value={formatThrottlePct(throttle)} valueTone={throttle != null && throttle > 0.92 ? "amber" : "cyan"} />
      <ControlIconCell kind="flaps" snapshot={snapshot} label="FLP" value={snapshot?.flapLabel ?? "—"} />
      <ControlIconCell kind="trim" snapshot={snapshot} label="TRM" value={trimText}
        valueTone={trimText === "NEUTRAL" ? "dim" : "cyan"} />
      <ControlIconCell kind="gear" snapshot={snapshot} label="GEAR" />
      {snapshot?.hasSpeedbrake && (
        <ControlIconCell kind="speedbrake" snapshot={snapshot} label="SPD BRK"
          value={snapshot?.speedbrake ? "OUT" : null} valueTone="amber" />
      )}
    </>
  );
}
```

Then replace the `.hud-bottom` inner spans (the THR/FLP/GEAR/SPD BRK spans at ~169-175) with `<HudControlRow snapshot={snapshot} />`, keeping the `formatLightPhase` span. Add imports at the top of `Hud.tsx`: `import ControlIconCell from "./controls/ControlIconCell";` and ensure `formatTrim`, `formatThrottlePct` are imported (they may not be — add to the existing `../format` import; check first). Remove now-unused imports (`formatFlaps`, `formatGear`) if lint flags them.

- [ ] **Step 4: Run test + gate**

Run: `cd frontend && npx vitest run src/hud/HudBottom.test.tsx && npm run typecheck && npm run lint`
Expected: PASS (2 tests), typecheck clean, no new lint warnings.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hud/Hud.tsx frontend/src/hud/HudBottom.test.tsx
git commit -m "feat(hud): graphic control icons on the desktop HUD bottom + trim added (#48)"
```

---

### Task 6: Mobile immersive rails (`ImmersiveHudBar.tsx`) + decisions.md + full gate

**Files:**
- Modify: `frontend/src/hud/ImmersiveHudBar.tsx` (both rails: the "balanced" rail ~186-188 and the "tapes" `imm-director-systems` block ~244-249) — replace FLP/THR/BRK text with icon cells; ADD gear + trim.
- Modify: `docs/decisions.md` (append the #48 entry)
- Test: `frontend/src/hud/ImmersiveControlRow.test.tsx` (create — extract + test a hook-free row, same pattern as Task 5)

**Interfaces:**
- Consumes: `ControlIconCell`, snapshot fields, `format.ts`.
- Produces: an exported hook-free `ImmersiveControlRow({ snapshot })` used by both rails: THR, FLP, TRM, GEAR, + SPD BRK when `hasSpeedbrake`. Mobile now shows the gear + trim it lacked.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/hud/ImmersiveControlRow.test.tsx
import { describe, it, expect } from "vitest";
import { ImmersiveControlRow } from "./ImmersiveHudBar";
import type { HudSnapshot } from "./snapshot";
import { ktToMs, ftToM, degToRad } from "../sim/units";

function kinds(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) kinds(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof type === "function") return kinds((type as (p: unknown) => unknown)(props), out);
  if (props?.kind) out.push(String(props.kind));
  if (props && "children" in props) kinds(props.children, out);
  return out;
}
const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500), verticalSpeedMs: 0,
  headingRad: 0, pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0, latDeg: 30, lonDeg: -88,
  aoaRad: degToRad(3), loadFactor: 1, throttle: 0.6, trim: 0, flapLabel: "0", gear: "retractable",
  stalled: false, overspeed: false, gLimited: false, terrainClearanceM: ftToM(2000),
  terrainUnverified: false, simRate: 1, airtimeS: 0, classLabel: "F5E", callsign: "SIM-A1",
  modelNote: "M", machNumber: 0, machOverspeed: false, gearPosition: 1, gearOverspeed: false,
  lightPhase: "day", ...o,
});

describe("mobile immersive control row (#48)", () => {
  it("now includes gear and trim (were missing on mobile)", () => {
    const k = kinds(ImmersiveControlRow({ snapshot: snap() }));
    expect(k).toEqual(expect.arrayContaining(["throttle", "flaps", "trim", "gear"]));
  });
  it("gates the speedbrake cell on hasSpeedbrake", () => {
    expect(kinds(ImmersiveControlRow({ snapshot: snap({ hasSpeedbrake: true }) }))).toContain("speedbrake");
    expect(kinds(ImmersiveControlRow({ snapshot: snap({ hasSpeedbrake: false }) }))).not.toContain("speedbrake");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hud/ImmersiveControlRow.test.tsx`
Expected: FAIL — `ImmersiveControlRow` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/hud/ImmersiveHudBar.tsx`, add the exported hook-free row (mirror Task 5's `HudControlRow` body exactly — same cells, same value logic) named `ImmersiveControlRow`. Then use `<ImmersiveControlRow snapshot={snapshot} />` in place of the FLP/THR/BRK `CompactField`s in the balanced rail (~186-188) and in place of the FLP/THR/BRK `<span>`s in the `imm-director-systems` block (~244-249). Keep VSI/AGL where they are. Add the import `import ControlIconCell from "./controls/ControlIconCell";` and any missing `formatTrim`/`formatThrottlePct` import; drop now-unused `CompactField`/format imports only if lint flags them.

Then append to `docs/decisions.md`:

```markdown
## 2026-08-13 — #48 graphic control-state indicators

Idiom A "mini-instruments" (owner-approved via interactive mock): throttle lever, flap trailing-edge
droop, trim needle against a fixed center gate, gear strut+wheel, speedbrake boards. One pure geometry
module (`hud/controls/ControlIconMath.ts`) + one hook-free SVG component (`ControlIcon`) + shared
`ControlIconCell`, applied to all three surfaces (glass strip, desktop HUD bottom, mobile rails; mobile
gains gear+trim). Class differences are data: gear `fixed` → static wheel vs `gearPosition`-animated;
speedbrake cell gated on the new `hasSpeedbrake` snapshot flag (`aero.speedbrakeCd0 > 0`) — no class
branches. Trim needle full-scale is `TRIM_FULL_SCALE = 0.30` (legibility knob, tune on-device). Snapshot
gained `flapDetentIndex?`/`flapDetentCount?`/`hasSpeedbrake?` (optional, honest defaults). Icon+value for
throttle/trim/flaps; icon + minimal caption for gear (label carries state) and speedbrake ("OUT" when
deployed).
```

- [ ] **Step 4: Run the FULL gate**

Run: `cd frontend && npm run typecheck && npm run test:unit && npm run lint`
Expected: typecheck clean; all unit tests pass (baseline 1286 + the new ones); lint ≤ 8 warnings, none newly added.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hud/ImmersiveHudBar.tsx frontend/src/hud/ImmersiveControlRow.test.tsx docs/decisions.md
git commit -m "feat(hud): graphic control icons on mobile rails (+ gear/trim) & decisions log (#48)"
```

---

## Self-Review

**Spec coverage:**
- Five glyphs (throttle/flaps/trim/gear/speedbrake) — Tasks 1 (math) + 3 (draw). ✓
- Icon+value vs icon-only split — Tasks 4/5/6 (value only on throttle/flaps/trim; gear label-only; speedbrake "OUT"). ✓
- All three surfaces — Tasks 4 (glass), 5 (HUD bottom), 6 (mobile). Mobile gains gear+trim. ✓
- One snapshot addition (`flapDetentIndex`/`flapDetentCount`) + `hasSpeedbrake` gate — Task 2. ✓
- Data-not-branches (gear fixed/animated; speedbrake gated on `speedbrakeCd0>0`) — Tasks 1/3/4/5/6, no `class===`. ✓
- Pure math + component split mirroring gaugeMath/AttitudeIndicator; unit-tested without DOM — Tasks 1/3. ✓
- Trim full-scale knob (`TRIM_FULL_SCALE`) flagged — Task 1. ✓
- Visual language (cyan/amber/grid only, fill:none, uppercase labels) — Task 3 CSS. ✓
- decisions.md entry — Task 6. ✓
- Gate green each task — every task Step 4. ✓
- Out of scope (touch throttle lever, idioms B/C, #79) — untouched. ✓

**Placeholder scan:** none — every step has concrete code or exact commands.

**Type consistency:** `ControlIconKind` used identically in Tasks 3/4/5/6; `buildFlapDetentFields` signature matches its test; snapshot field names (`flapDetentIndex`/`flapDetentCount`/`hasSpeedbrake`) consistent across Tasks 2→6; value-tone logic (`throttle>0.92 → amber`, `NEUTRAL → dim`) identical in glass/HUD/mobile rows.

**Known adaptation points (flagged, not placeholders):** exact line numbers in `Hud.tsx`/`ImmersiveHudBar.tsx` may drift; the plan says which spans to replace and to extract a hook-free row rather than test a store-reading component. Import add/remove is lint-driven ("remove if flagged").
