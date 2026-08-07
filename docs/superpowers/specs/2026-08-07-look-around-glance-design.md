# Design: Look-around (mouse free-look) — issue #9

**Date:** 2026-08-07
**Status:** DESIGN — owner-approved (compact brainstorm). Small feature; this spec doubles as
the implementation brief.

---

## 1. Outcome

While the player **holds `Q`** during FPV flight, the cockpit camera enters **free-look**: the
canvas pointer-locks (cursor hidden) and mouse movement swivels the view — yaw the whole way
around (look over your shoulder for traffic) and pitch up/down (clamped ~±85°). **Releasing `Q`**
exits pointer-lock and the view **eases back to forward** over ~0.3 s.

**Zero control coupling (the whole point):** free-look never touches `ControlVector` or the
physics — the aircraft holds exactly the inputs it had. Look mode changes only the camera's
look direction, layered on top of the existing low-passed cockpit orientation.

---

## 2. Behavior

- **Engage:** `Q` keydown → request pointer lock on the Cesium canvas; begin accumulating mouse
  `movementX/movementY` into a yaw/pitch **look offset**.
- **Look:** yaw offset has **full range** (wraps, so you can face rear); pitch offset is
  **clamped** to ~±85° (never flips over the top). A tuning-knob **sensitivity** maps mouse
  pixels → radians.
- **Release:** `Q` keyup → exit pointer lock; the look offset **eases back to 0** over ~0.3 s
  (same easing spirit as return-to-level), then the view is exactly forward again.
- **Interrupt:** Escape, window blur, or losing pointer lock for any reason exits look mode
  cleanly and eases the offset back — never leaves the view stuck off-axis.
- **Pointer-lock denied** (browser refuses, e.g. no user gesture): fall back to bounded
  `mousemove` deltas so the feature still works, just without infinite travel. Honest
  degradation, no crash.

---

## 3. Shape (testable core vs acceptance-verified wiring)

- **Pure `lookOffset` accumulator** (`globe/lookAround.ts`, new — Cesium-free, unit-tested):
  - `applyMouseDelta(offset, dx, dy, sensitivity) → {yawRad, pitchRad}` — accumulate + clamp
    pitch, wrap yaw.
  - `easeToward(offset, targetZero, dtS, rate) → offset` — ease back to 0 when inactive.
  - State: `{ yawRad, pitchRad, active }`. Deterministic, no DOM.
- **Camera apply** (`globe/fpvCamera.ts`, small change): `update()` gains an optional look
  offset; sets `heading = filteredHeading + yawRad`, `pitch = clamp(filteredPitch + pitchRad)`,
  `roll` unchanged. When the offset is 0 the view is identical to today (regression-safe).
- **Wiring** (`game/FlightSession.tsx` + `globe/cesiumFlightHost.ts`, acceptance-verified per
  the no-jsdom/Cesium convention): `Q` down/up handlers, pointer-lock request/exit, `mousemove`
  listener feeding the accumulator, and passing the offset through `setCamera`. Add `KeyQ` to
  `GAME_KEY_CODES` (preventDefault) and to the `KEYMAP`/ControlsHelp as "hold — look around".

---

## 4. Non-goals

- No padlock/track-a-target, no snap-to-fixed-angles, no view persistence between glances.
- No external/chase view (that is issue #4).
- No mouse-look for *flying* — controls stay keyboard; the mouse only looks while `Q` is held.

---

## 5. Decisions to log (docs/decisions.md)

1. Mouse free-look via pointer lock, engaged only while `Q` is held; bounded-mousemove fallback
   when pointer lock is denied.
2. Ease-back to forward on release (~0.3 s), matching the return-to-level easing feel.
3. Camera-only: the look offset is layered in `fpvCamera`, never in `ControlVector` — flight is
   untouched, and a zero offset reproduces today's view exactly.

---

## 6. Test plan

- **Unit (pure):** `lookAround.test.ts` — mouse deltas accumulate + clamp pitch + wrap yaw;
  sensitivity scales; `easeToward` decays to ~0 and reaches 0 within tolerance; a broken-arm
  case (offset applied vs not) proving the camera would differ.
- **Camera:** `fpvCamera.test.ts` — with a non-zero offset the resulting heading/pitch differ by
  the offset; with zero offset the orientation is byte-identical to today (regression guard).
- **Wiring:** acceptance flight — hold `Q`, look around (incl. rear), release → view eases
  forward; aircraft never deviates while looking; Escape/blur recover cleanly.
