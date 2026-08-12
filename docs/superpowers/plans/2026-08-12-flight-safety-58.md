# Flight Safety — never trap the player (#58) + top-right layout (#26)

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** A crashed/underground/runaway flight always ENDS, and the player always has a manual way out on mobile — plus stop the top-right toggles covering the HUD bar readouts.

**Root cause (scout):** ground-collision (`flightLoop.ts` → `endSession` → `fire("IMPACT")`) is the ONLY path to ENDED, gated on `ground.collisionArmed`; when terrain is UNVERIFIED/disarmed that's false forever, so the plane falls through the ground with no end and mobile has no manual abort.

## Global Constraints

- Honest data: don't fabricate terrain. The fallback ends the flight on an absolute impossibility (altitude far below any real terrain), not a guessed ground height.
- The manual abort reuses the EXISTING machine path (`fire("PAUSE")` → PauseOverlay's RESUME/QUIT, or a direct `QUIT` from FLYING) — do not invent a new mode transition.
- Deterministic sim unchanged in the normal case: the floor fallback must not fire during any legitimate flight (pick a floor no real mission reaches — well below sea level).
- No new dependencies. Suite green per commit. Existing tests extended, never weakened.

---

### Task 1: Terrain-independent crash-end floor (#58 root fix)

**Files:**
- Modify: `frontend/src/game/flightLoop.ts` (add an absolute-altitude-floor end condition next to the existing collision check ~225-230)
- Test: `frontend/src/game/flightLoop.test.ts` (or wherever the loop's end conditions are tested)

**Interfaces:** none new — reuses `endSession()`.

**Steps (TDD):**
- [ ] Read `flightLoop.ts` ~130-240 (the snapshot build, `terrainClearanceM`, the `collisionArmed` collision `if`, and `endSession()`), and `world/terrain.ts` (`collisionArmed`, `disarm`), and how the loop is tested (flightLoop.test.ts).
- [ ] Add a constant `const ABSOLUTE_FLOOR_M = -500;` with a comment: no real mission terrain is 500 m below the ellipsoid; passing it means the aircraft has fallen through unverified/absent terrain — treat as a crash regardless of `collisionArmed`.
- [ ] Write a failing test: with terrain unverified (collisionArmed false / sample heightM null) and `state.altitudeM` driven below `ABSOLUTE_FLOOR_M`, the loop calls `endSession` (the onEnd/end hook fires). And a guard test: a normal low-altitude flight at/above the floor with unverified terrain does NOT end. Run, confirm fail.
- [ ] Implement: after the existing collision `if`, add `if (state.altitudeM < ABSOLUTE_FLOOR_M) endSession();` (or fold into one end decision). Ensure it runs even when `collisionArmed` is false. Keep `endSession` idempotent (it likely already guards double-end — verify).
- [ ] Full gate `npx vitest run && npx tsc --noEmit`.
- [ ] Commit `fix(sim): absolute altitude floor ends a flight that falls through unverified terrain (#58)`.

### Task 2: Manual abort on mobile (#58 safety valve)

**Files:**
- Modify: `frontend/src/layout/ImmersiveControl.tsx` (add a MENU/PAUSE button in the narrow-FLYING cluster that fires PAUSE) OR `frontend/src/input/TouchControls.tsx` — implementer picks the one already rendering during narrow FLYING; wire it to the same handler the desktop Escape uses
- Modify: `frontend/src/game/FlightSession.tsx` (expose the pause trigger to the touch control if needed — the Escape handler ~501-511 calls `loopRef.current?.pause()` + `fire("PAUSE")`; reuse that exact sequence)
- Modify: `frontend/src/styles/tokens.css` (button style/position)
- Test: component/store test if the pause trigger is a testable handler; otherwise rely on tsc + the machine test already covering PAUSE→QUIT

**Interfaces:** reuses `fire("PAUSE")` and the existing PauseOverlay (RESUME + QUIT TO BROWSE). Confirm PauseOverlay renders on narrow (not desktop-gated).

**Steps:**
- [ ] Read the Escape→pause handler (`FlightSession.tsx:501-518`), `leaveToBrowse`/`onQuit` (~237-246, 820), `PauseOverlay.tsx` (confirm it renders on mobile and has RESUME + QUIT), and the narrow-FLYING render branch (`FlightSession.tsx:796-808`).
- [ ] Add a MENU button (label "MENU" or a pause glyph) to the narrow-FLYING touch UI that triggers the SAME pause sequence as Escape (`loopRef.current?.pause()` + `fire("PAUSE")`). The existing PauseOverlay then gives RESUME (back to flight) and QUIT TO BROWSE (exit). Place it clear of the flight controls and the top-right toggles.
- [ ] Verify on the machine: PAUSE from FLYING → PAUSED; PauseOverlay's QUIT → BROWSE; RESUME → FLYING. (machine.test covers the transitions; just confirm the button wires to them.)
- [ ] Full gate.
- [ ] Commit `feat(mobile): MENU button opens pause (resume/quit) — the missing mobile abort (#58)`.

### Task 3: Top-right toggles clear of the HUD bar (#26)

**Files:**
- Modify: `frontend/src/styles/tokens.css` (`.immersive-toggle`, `.immersive-toggle-active`, `.declutter-toggle` ~1419-1450)

**Steps:**
- [ ] Read the three rules. In narrow flight the full-width immersive HUD bar occupies the top ~90px; the toggles at `top:8px` overlap its ALT/FLP/THR readouts (owner: DCLTR over ALT, FULL/EXIT over FLP).
- [ ] Reposition the toggle cluster (FULL/EXIT + DCLTR + the new MENU) to sit BELOW the bar in narrow flight — e.g. `top: max(96px, calc(env(safe-area-inset-top) + 88px))` — so they clear ALT/FLP/THR. Keep them right-aligned and non-overlapping with each other (lay out with consistent right offsets or a small flex row). Desktop/non-narrow positioning unchanged.
- [ ] Full gate (CSS-only; ensure no test asserts the old offsets).
- [ ] Commit `fix(mobile): drop FULL/EXIT/DCLTR/MENU below the HUD bar so they don't cover ALT/FLP (#26)`.

### Task 4: Deploy

- [ ] Append `docs/decisions.md` CF-021: the absolute-floor crash-end + mobile MENU/abort + why terrain-disarm no longer traps. Commit.
- [ ] `npm run deploy:production`; probe 200; note version. Push. Owner on-device: crash/underground now ends; MENU→QUIT works on mobile; toggles clear the bar. Then close #58 (and the layout half of #26).

## Self-Review
Task 1's floor is the terrain-independent guarantee; Task 2 is the human safety valve — both must ship together so neither the physics bug nor a future one can trap a player. The floor value (-500 m) must be below every real mission's terrain; confirm no mission spawns/lands below it. Also ships the already-committed #55 eligibility (ba2bfd8) on the same deploy.
