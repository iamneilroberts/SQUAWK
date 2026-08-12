# Checklist

_Updated: 2026-08-12 13:05 — mongols-rich-hud (tip 6bba51d; Task 2/3 built+committed, gate green; #55+#58 still NOT deployed — live worker still 535a8637; awaiting deploy sign-off)_

Source handoff: `<coord>/handoffs/pause-2026-08-12-mobile-funnel-deferred.md`

## Checklist
- [x] #58 Task 1 — altitude floor + NaN guard + endSession idempotency (287f0c1, 812d488, reviewed, 1214 green)
- [x] #55 eligibility dimming (ba2bfd8, reviewed clean) — committed, not deployed
- [x] #58 Task 2 — mobile MENU/abort button (f49e3b9; shared pauseFlight handler → PauseOverlay; 1214 green, typecheck clean)
- [x] #58 Task 3 — top-right control row below the HUD bar (d66fe9a; row→safe-area+88px, mission controls→128px; build clean) + CF-021 (6bba51d)
- [ ] **#58 Task 4 — deploy** (deploy:production, probe, push; ships #55+#58; owner verify crash-ends + MENU→QUIT + toggles clear bar; close #58 + #26 layout half) ← AWAITING SIGN-OFF
- [ ] #41 on-demand fetch (Group A; scouted — refreshNow on poller, fire on select + range-change)
- [ ] #56 portrait mission card · #34 quick-start width · #28 browse bottom-block · #21 handoff dialog portrait
- [ ] Confirm-and-close on owner device: #32 debrief ✕ · #31 button contrast · #33 traffic-card · #57 DCLTR+labels
- [ ] Group B (landing): #22 #52 #5 #3 #1 · Group C (roster): #51(bug) #8 #30 #29 #2 #53
- [ ] Group D (desktop): #35 #44 #45 #47 #49 #9 #46 · E (LORAN): #38 #39 #37 · F (data): #42 #43 #19 #18 #20 #14 · G (HUD): #6 #7 #48
- [ ] Untracked: commit or rm the 3 docs/superpowers/plans/2026-08-12-*.md
