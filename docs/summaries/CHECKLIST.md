# Checklist

_Updated: 2026-08-12 08:41 — mongols-rich-hud (tip cd676ab pushed + DEPLOYED, live worker dd46de1d)_

Source handoff: `<coord>/handoffs/pause-2026-08-12-mongols-live-iteration.md`

## Checklist
- [x] Rich HUD port + NAV/WX + PWA pipeline + declutter wave → all deployed to fly.voygent.app
- [x] Push branch to origin (synced @ ae2101c)
- [x] #27 NAV/WX overlay verified by owner — closed
- [x] Weather feed fixed (55fdca4: /api/metar/:icao ported to Worker; verified real KMOB METAR)
- [x] Approach-guidance spec WRITTEN + committed (888f27a: docs/superpowers/specs/2026-08-12-approach-guidance-design.md) — owner approved
- [x] Worktree crawl ledger: salvage committed ae2101c; ais parked @ origin/ais 50d85e7

## Do now
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
