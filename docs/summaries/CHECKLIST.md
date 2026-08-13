# Bizjet flight-model epic — checklist

Branch `bizjet` off `mongols-rich-hud` (9882e86 == live prod). #48 SHIPPED + closed.
Plan: `docs/superpowers/plans/2026-08-13-bizjet-flight-model.md`
Spec: `docs/superpowers/specs/2026-08-13-multi-aircraft-type-flight-models-design.md`

## Lead-in: deferred #48 cleanups (do first)
- [ ] #1 Extract shared `ControlStateRow` across `ControlState.tsx` + `Hud.tsx` HudControlRow + add tone-threshold test (throttle>0.92→amber, NEUTRAL→dim)
- [ ] #2 Null-flap-glyph: gate flap droop on `known(flapDetentIndex)`
- [ ] #3 EM_DASH: replace hardcoded `"—"` with shared `EM_DASH` constant (3 rows)
- [ ] #4 `TouchControls.tsx`: hoist double `trimBadgeText(snapshot?.trim)` call to a const

## Bizjet epic (SDD, fresh subagent per task, review between)
- [ ] Task 1: `params/biz.json` + `loadBiz()`/`case "biz"` in `sim/params.ts` + `sim/biz-envelope.test.ts` (include `aero.speedbrakeCd0`; cruise ~M0.78 @ FL430; source every non-GA number)
- [ ] Tasks 2–4: compiler-guided `AircraftClassId` union flip + fill consumers
- [ ] tprop + heavy archetypes (same pattern, after biz)
- [ ] Owner device-verify + deploy each phase

_Updated: 2026-08-13 — bizjet_
