# Checklist — #48 graphic control-state indicators

CODE-COMPLETE on `mongols-rich-hud` @ 867d604. Gate green (typecheck, 1303 tests, lint 5 pre-existing/0 added).
Plan `docs/superpowers/plans/2026-08-13-control-state-indicators.md`. SDD ledger:
`.superpowers/sdd/2026-08-13-control-state-indicators/progress.md`.
Live prod branch — NOT yet deployed. Waiting on owner on-device sign-off before `npm run deploy:production`.

- [x] Task 1 — `ControlIconMath.ts` pure geometry + unit tests
- [x] Task 2 — snapshot fields (flapDetentIndex/flapDetentCount/hasSpeedbrake) + flightLoop wiring
- [x] Task 3 — `ControlIcon` + `ControlIconCell` components + CSS
- [x] Task 4 — desktop glass strip (`ControlState.tsx`) + gated speedbrake
- [x] Task 5 — desktop HUD bottom (`Hud.tsx`) + trim added (1 fix round: tightened flap assertion)
- [x] Task 6 — mobile rails (`ImmersiveHudBar.tsx`, +gear/trim) + decisions.md
- [x] Final whole-branch review (opus4.8) → 1 fix wave (mobile grid hoist/clip) → re-review clean
- [ ] **Owner on-device pass on BOTH mobile rails, then deploy**

Deferred (do at bizjet lead-in): extract shared ControlStateRow across 3 surfaces + add value-tone boundary test (final review #2/#5); null-flap-glyph hide (#4); EM_DASH literal (#6).

Next after #48: bizjet epic (`docs/superpowers/plans/2026-08-13-bizjet-flight-model.md`).

_Updated: 2026-08-13 — mongols-rich-hud @ 867d604 (code-complete, awaiting deploy sign-off)_
