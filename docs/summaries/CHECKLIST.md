# Checklist — streamline starting + debrief + guide-line fix

_Updated: 2026-08-12 — mongols-rich-hud (labels shipped @a8123c27; this batch in progress)_

Decisions: fly-first/sign-in-later (anonymous instant, unranked v1); default = nearest flyable live
contact; screens per flow-mock (FLY NOW start card + trimmed debrief). No server changes.

## Bundle A — quick wins (low risk)
- [ ] A1. Guide-line flicker → `disableDepthTestDistance: Infinity` on route/runway/gate polylines
- [ ] A2. Suppress RotateCard (portrait "rotate to landscape")
- [ ] A3. Intro card: fit (max-height/overflow-y) + trim to streamlined start card (FLY NOW)

## Bundle B — instant anonymous flight
- [ ] B1. Pure `nearestFlyableContact(contacts, center)` (TDD)
- [ ] B2. Instant mission builder — seed free-flight-style mission from a real Contact + nearest airport (TDD)
- [ ] B3. TAKE CONTROLS / FLY NOW: anonymous → instant flight; authed → ranked path de-frictioned (no bounce)
- [ ] B4. FLY NOW with no selection → auto-pick nearest flyable
- [ ] B5. Debrief (EndCard) simplify: outcome + score + 3 stats, collapse breakdown/versions, SIGN IN for anon

## Bundle C — added mid-build
- [ ] C1. Limit 3 anon flights (client localStorage cap) → 4th requires sign-in
- [ ] C2. IP abuse tripwire (worker: count anon flight-starts by CF-Connecting-IP; fail-open)
- [ ] C3. Top-bar left/right directional pointers → airport bearing (extend NavDirector)

## Ship
- [ ] Gate green → live-verify FREE FLIGHT + instant flight → owner signoff → deploy

Shipped earlier today: #65 mouse-look, 5/user, admin one-tap (@1c765af5); Gulf Coast labels (@a8123c27).
