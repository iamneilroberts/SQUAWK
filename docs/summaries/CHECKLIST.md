# Checklist — #48 graphic control-state indicators

DEPLOYED to fly.voygent.app. Branch `mongols-rich-hud`. Plan `docs/superpowers/plans/2026-08-13-control-state-indicators.md`.
SDD ledger: `.superpowers/sdd/2026-08-13-control-state-indicators/progress.md`.

- [x] Phase 1 — icons on all 3 surfaces (6 TDD tasks + whole-branch review + fix wave). DEPLOYED Version 1340ba86.
- [x] Owner on-device pass → mobile HUD icon row jammed (landscape MENU collision, portrait overlap).
- [x] Phase 2 — mobile redesign: state moved to bottom touch buttons (compact glyphs GEAR/BRK, FLP+/TRM▲ value badges); HUD icon row reverted. Reviewed clean. DEPLOYED Version 61fca26e @ 1e737a9.
- [ ] **Owner on-device pass on Phase 2 mobile buttons (both orientations)**

Deferred (bizjet lead-in): extract shared ControlStateRow across the 3 desktop surfaces + tone-boundary test (review #2/#5); null-flap-glyph hide (#4); EM_DASH literal (#6); TouchControls trimBadgeText double-call (phase-2 minor).

Next after #48 sign-off: bizjet epic (`docs/superpowers/plans/2026-08-13-bizjet-flight-model.md`).

_Updated: 2026-08-13 — mongols-rich-hud @ 1e737a9 (Phase 2 deployed, awaiting on-device sign-off)_
