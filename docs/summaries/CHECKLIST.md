# Checklist

_Updated: 2026-08-12 00:15 — mongols-rich-hud (15 commits live at fly.voygent.app; guidance spec pending final approval)_

Source handoff: `<coord>/handoffs/pause-2026-08-12-mongols-live-iteration.md`
(Prior mongols 18-task execution checklist superseded — Tasks 1-16 done, 17/18 deferred to public-readiness; see the plan doc.)

## Checklist
- [x] Task 1 readiness assessment → mongols already live+public at fly.voygent.app
- [x] Privacy model decided (public demo funnel, magic-link at take-controls; keep auth)
- [x] Frugal ADS-B + home lock (47bcdf6) → deployed
- [x] Rich HUD port (a90516f) → deployed
- [x] Mobile NAV/WX combo (6fab5a1) → deployed
- [x] PWA build-id updates + boot watchdog (449eb9a/8fc56d7) → deployed
- [x] White-screen root-caused (iOS fingerprint protection) + owner unblocked
- [x] Declutter wave (auto-hide any narrow flight, nav pointer e6801f4, z-fixes, API chip 9397ea4)
- [x] Push branch to origin (synced @ 9397ea4)
- [ ] Approach-guidance spec (decisions all captured in handoff; get final "design approved" → spec → writing-plans → build #24+#23)
- [ ] #27 verify NAV/WX chip tap opens overlay (FLYING && narrow only)
- [ ] #26 portrait top-right layout pass (FULL under THR)
- [ ] #28 compact mobile BROWSE bottom block
- [ ] #25 white-screen: confirm quiet, close
- [ ] Daytime eligibility test (GA/airliner missions offered?)
- [ ] Reconcile mongols ← mongols-rich-hud (ff) on owner sign-off
- [ ] LATER: #22 ghost plane · #21 · #20 · anonymous quota guard · Task 17/18 gates
