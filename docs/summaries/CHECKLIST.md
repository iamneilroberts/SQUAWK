# Checklist — #48 control-state indicators + mobile polish

DEPLOYED to fly.voygent.app @ 6522177 (Version c432c4c2). Branch mongols-rich-hud.
SDD ledger: `.superpowers/sdd/2026-08-13-control-state-indicators/progress.md`.

- [x] Phase 1 — desktop icons on 3 surfaces (6 TDD tasks + review + fix). Version 1340ba86.
- [x] Phase 2 — mobile state moved to touch buttons (HUD icon row reverted). Version 61fca26e.
- [x] Phase 3 — MENU→bottom-left; HUD systems line trimmed to VSI/AGL. Version f08fc681.
- [x] Phase 4 — MENU above throttle (clears SIGN IN); shorter portrait throttle; HUD A/C toggle hidden during warnings. Version ef892aef.
- [x] LEVEL button (#5) — disappearing beginner return-to-level (appears off-level >~10°, taps existing KeyL). Version c432c4c2.
- [x] Closed on owner device-verify: #60 #59 #57.
- [ ] **Owner final on-device pass: LEVEL button + Phase 4 (MENU/throttle/toggle). Then close #48 + #7.**

Deferred (bizjet lead-in): extract shared ControlStateRow across 3 desktop surfaces + tone-boundary test; null-flap-glyph hide; EM_DASH literal; TouchControls trimBadgeText double-call.

Next after #48 sign-off: bizjet epic (`docs/superpowers/plans/2026-08-13-bizjet-flight-model.md`).

_Updated: 2026-08-13 — mongols-rich-hud @ 6522177 (all mobile polish + LEVEL deployed, awaiting final sign-off)_
