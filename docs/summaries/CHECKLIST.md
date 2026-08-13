# Checklist — streamline starting + debrief (big phase)

_Updated: 2026-08-12 — mongols-rich-hud. Phase-1 fixes DEPLOYED @ e880f5bc. Big phase started._

Decisions: fly-first/sign-in-later (anonymous instant, UNRANKED v1); signed-in users get the
existing ranked prepare/lock path de-frictioned; default = nearest flyable live contact; screens per
flow-mock (FLY NOW start card + trimmed debrief); 3 anon flights then require sign-in + IP tripwire.

## DONE + DEPLOYED (Version e880f5bc)
- [x] Guide line steady — depthFailMaterial on route/runway/gate polylines (f646be9)
- [x] Portrait rotate modal removed; fading AppModeHint + APP button off flight screen (3e7c302)
- [x] Intro card fits (max-height/overflow-y) (f646be9)

## DONE (not yet wired/deployed)
- [x] B1. `takeover/pickFlyable.ts` nearestFlyableContact (3eee033)

## TODO — instant anonymous flight
- [x] B2. Instant mission builder — `takeover/instantMission.ts:buildInstantMission(contact, airports,
      opts?, lockedAt?)` → SIM unranked LockedMissionView from a REAL Contact (class via resolveClass,
      alt_geom/track via shared spawn) + nearest airport (world index) as destination. Pure, TDD, 8
      tests. Throws on unsupported contact / no airports. NOT yet wired into the store/flow (B3).
- [~] B3. TAKE CONTROLS rewire — CORE DONE (fbc9424 store, 874c151 wiring). Anon `takeControls` →
      buildInstantMission(selected contact) → startInstantFlight; no prepare/lock/sign-in/bounce.
      New store flag `instantFlight`; FlightSession `local = freeFlight||instantFlight` guards all
      server lease/keepalive/submit; instant ends with a local unranked message (scored EndCard = B5).
      REMAINING (B3c): redesign `briefing/QuickStartNotice.tsx` into the "FLY NOW" start card. Also
      LIVE-VERIFY a full one-click anon flight in Chrome before deploy.
- [ ] B4. FLY NOW / TAKE CONTROLS with no selection → nearestFlyableContact.
- [ ] B5. Debrief simplify `panels/EndCard.tsx`: outcome + score + 3 stats up top; collapse
      ScoreBreakdown (:39-51) + Versions (:53-66) behind a ▸details; anon runs show SIGN IN TO RANK.

## TODO — anon abuse controls (NEEDS DECISION on tripwire mechanism)
- [ ] C1. Client cap: localStorage anon-flight count; 4th → require sign-in (block instant path).
- [ ] C2. IP tripwire (worker): count anon flight-starts by CF-Connecting-IP, fail-open. Mechanism TBD
      (Rate Limit binding vs KV counter vs DO). Client beacons on anon flight start; over-threshold →
      require sign-in. Does NOT gate the current flight on the network (optimistic + fail-open).

## TODO — HUD
- [ ] C3. Top-bar left/right directional pointers → airport bearing. Extend `hud/ImmersiveHudBar.tsx`
      NavDirector (imm-director-arrow, ~:142-166) — relative bearing to mission.assignment airport.

## KEY MAP (from explorer)
- Mode machine: `game/machine.ts:13` (BROWSE/COUNTDOWN/FLYING/PAUSED/ENDED); store `state/store.ts`
  `fire()` + `startLockedMission`(:338)/`startTutorial`(:357)/`startFreeFlight`(:378).
- takeControls: `App.tsx:312`; sign-in gate :314-326 (saveProvisionalBriefing + setSignInOpen).
- Bounce root cause: magic-link reload captured pre-mount `main.tsx:6` → resets in-memory state;
  sessionStorage only reseeds the SELECTION not the flow. Anonymous-instant path avoids it entirely.
- Free flight template: `freeflight/freeFlight.ts:101` buildFreeFlightMission (zero fetch/auth/lock).
- EndCard: `panels/EndCard.tsx` (grid :132-158, ScoreBreakdown :39-51, Versions :53-66).

## Ship
- [ ] Gate green → live-verify (instant flight + anon cap) → owner signoff → deploy
