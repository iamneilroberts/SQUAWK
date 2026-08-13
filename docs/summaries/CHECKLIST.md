# Bizjet flight-model epic — checklist

Branch `bizjet` off `mongols-rich-hud` (9882e86 == live prod). #48 SHIPPED + closed.
Plan: `docs/superpowers/plans/2026-08-13-bizjet-flight-model.md`
Spec: `docs/superpowers/specs/2026-08-13-multi-aircraft-type-flight-models-design.md`

## Lead-in: deferred #48 cleanups (DONE @ f221cc1)
- [x] #1 Extracted shared `ControlStateCells.tsx` + tone-threshold test (throttle>0.92→amber, NEUTRAL→dim, speedbrake gating)
- [x] #2 Null-flap-glyph: pass raw nullable detent → flapDroopEnd known()-guard hides droop on null
- [x] #3 EM_DASH: control-state rows use shared constant (other unrelated `"—"` literals left as-is)
- [x] #4 `TouchControls.tsx`: hoisted double `trimBadgeText(snapshot?.trim)` to a const

## Bizjet epic (SDD, fresh subagent per task, review between)
- [x] Task 1: `params/biz.json` + `loadBiz` + envelope test — plus owner-approved per-class turbofan corner (`4d6ff5c`+`c1c0a25`). Plausible: M0.769 @ FL430, 2949 fpm SL climb, real 45,000 ft ceiling.
- [x] Task 2: mission profile + EFIS dashboard profile + model dims (`e46fe72`, string-keyed)
- [x] Task 3: `AircraftClassId` union flip + all consumers + biz-types resolution + worker validators (`809dec9`+`e3d3316`)
- [x] Task 4: decision log + full gate + FINAL REVIEW + DEPLOYED (Version 3a56c4f9, mongols-rich-hud @ 21b14d5, pushed). Prod smoke green incl. /api/leaderboards?class=biz 200.
- [ ] Owner device-verify: find a live Citation/Gulfstream contact → takeover-eligible, cruises ~M0.78, twinjet silhouette, debrief records a `biz` mission
- [ ] tprop + heavy archetypes (same pattern, after biz) — future plans

_Updated: 2026-08-13 — bizjet (Tasks 1–3 shipped; Task 4 gate green, deploying)_
