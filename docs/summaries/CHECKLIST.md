# Checklist

_Updated: 2026-08-12 11:05 — mongols-rich-hud (tip 3bbf43e pushed + DEPLOYED, live worker 497721cb)_

Source handoff: `<coord>/handoffs/pause-2026-08-12-mongols-live-iteration.md`

## Today's shipped wave (all deployed to fly.voygent.app)
- [x] Approach guidance #24 surface + #23 PAPI + #50 route clip (worker dd46de1d); #54 PAPI order fix
- [x] PIN sign-in #40 — owner-verified on-device, CLOSED (worker 2b408015, migration 0005 live)
- [x] NAV/WX overlay ✕ close fix (worker 9d37b341)
- [x] #32/#31/#33 batch (3bbf43e, worker 497721cb) — debrief sticky-footer+z45, touch-button dark plate, traffic-card narrow clamp — AWAITING owner on-device confirm of #32
- [x] Full issue triage: closed shipped #10/#11/#16/#25/#13; 42 open grouped A–G; filed #55/#56/#57

## Group A remaining (mobile funnel)
- [ ] #55 contacts show mission-eligibility before selection + #41 on-demand ADS-B fetch on briefing open (pair)
- [ ] #57 flight declutter: DCLTR toggle + relocate HUD/controls to edges + nearest-few traffic labels
- [ ] #56 provisional-mission card portrait · #34 quick-start width · #28 browse bottom block · #21 handoff dialog portrait

## Older checklist
- [x] Rich HUD port + NAV/WX + PWA pipeline + declutter wave → all deployed to fly.voygent.app
- [x] Push branch to origin (synced @ ae2101c)
- [x] #27 NAV/WX overlay verified by owner — closed
- [x] Weather feed fixed (55fdca4: /api/metar/:icao ported to Worker; verified real KMOB METAR)
- [x] Approach-guidance spec WRITTEN + committed (888f27a: docs/superpowers/specs/2026-08-12-approach-guidance-design.md) — owner approved
- [x] Worktree crawl ledger: salvage committed ae2101c; ais parked @ origin/ais 50d85e7

## Do now
- [x] PIN SIGN-IN SHIPPED (#40, d3b7d30..78a7638, worker 2b408015, migration 0005 live): emailed 6-digit code typed in-place — no browser handoff. Smoke: verify-code wrong code → 401 clean. AWAITING OWNER PHONE TEST (§7.1) → close #40.
- [x] BUILD SHIPPED: approach guidance (#24 surface + #23 PAPI + #50 route clip + approach-warnings wiring) — 7 commits ae2101c..cd676ab, 1191 tests green, opus48 final review APPROVED, deployed worker dd46de1d — AWAITING OWNER LOOK-PASS (surface on final; PAPI at all assist levels; route no longer trails behind)
- [x] #54 FIXED + CLOSED (d56b724, deployed worker 135d0cd1): offsets reversed, spec §3.2 amended — real PAPI order, red pair inboard
- [ ] #32 debrief window can't be closed on mobile (traps the player — highest bug)
- [ ] Plane types: verify GA/airliner/fighter all offer missions with daytime traffic (adsbdb mapping breadth; related #30 helicopters, #29 free-flight spawn)
- [ ] TRIAGE owner feature batch #35–#49 (#38+#39 major direction; #35+#49 spec together; #40+#41 best quick wins)
- [ ] Mobile bug batch: #31 touch-button contrast · #33 ✕-overlap audit · #34 cards too wide portrait · #26 top-right layout · #28 browse bottom block

## Later
- [ ] #25 white-screen: confirm quiet with protections off, then close
- [ ] Daytime test flight (GA/airliner eligibility)
- [ ] Reconcile mongols ← mongols-rich-hud (ff) on owner sign-off
- [ ] Prune-safe worktrees (per crawl ledger): burmese, koreans, malay, shu, ais-testing, glass-dash, gltf-models (check its untracked .env first); hindustanis/vikings stale CHECKLIST edits → checkout --
- [ ] #22 ghost-plane director · #21 portrait handoff card clipped · #20 wacky callsign · anonymous quota guard · Task 17/18 public-readiness gates
- [ ] Owner question pending: nginx no-cache on old adsb.voygent.app stack (low priority)
