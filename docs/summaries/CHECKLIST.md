# Checklist — UI triage + speedbrake shipped; #48 icons + bizjet epic next

_Updated: 2026-08-13 (afternoon) — mongols-rich-hud. Live prod @ HEAD 1bebfbf, Version 89be9624._
_Full handoff: shared coord dir → handoffs/pause-2026-08-13-triage-speedbrake-next.md_

Deploy = `cd frontend && npm run deploy:production` then `git push`.
Gate = `cd frontend && npm run typecheck && npm run test:unit && npm run lint` (≤8 warns; 5 pre-existing).
Suite 1286 green. THIS IS LIVE PROD — commit/deploy discipline; owner verifies each deploy on iPhone.

## Done + deployed this session
- [x] #56 provisional card: TAKE CONTROLS pinned above eligible-airports list (Version 51c3f064)
- [x] Bucket A: closed 20 shipped-but-open issues (#56 #69–77 #67 #31 #33 #41 #55 #28 #29 #6 #21 #34)
- [x] #60 NAV/WX docked as compact panel in landscape · #59 44px tap target on bare traffic (Version bb915f2b)
- [x] #51 speedbrake control — B=boards, afterburner→R, mobile BRK button, SPD BRK/BRK OUT HUD (Version 89be9624)
- [x] Filed #79 (prettify controls cheat-sheet)

## Pending (owner's order: #48 first, then bizjet)
- [ ] Owner device-verify Version 89be9624: #60 landscape, #59 far-traffic tap, #51 dive+BRK
- [ ] **#48 graphic control-state indicators (icons for gear/flaps/trim/throttle/speedbrake).**
      Owner asked to brainstorm — START WITH `superpowers:brainstorming`, NOT code. Absorbs the #51 text indicators.
- [ ] **Bizjet epic** — plan READY: docs/superpowers/plans/2026-08-13-bizjet-flight-model.md.
      4 TDD tasks, biz (Citation-class) first, then tprop + heavy. New classes also need a speedbrakeCd0.
- [ ] #57 — confirm center-clear on device, close if good
- [ ] #79 — cheat-sheet prettify
- [ ] Maybe file: landing overrun / stopping-distance (wheel brakes + reversers) if owner wants it
- [ ] Deferred (D): #2 #30 #35 #38 #39 #44 #45 #49 #66 #68 #78 + others
