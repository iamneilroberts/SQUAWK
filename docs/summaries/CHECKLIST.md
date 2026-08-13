# Checklist — streamline starting + debrief (big phase)

_Updated: 2026-08-12 — mongols-rich-hud. B2+B3+B4 DEPLOYED @ Version 59a11f21 (HEAD c0885ea, pushed).
Anon instant flight LIVE-VERIFIED on prod. B3c + B5 + C1-C3 remain._
_Local/staging can't fetch traffic (provider vars only in env.production) → issue #66; verify on prod._

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
- [~] B3. TAKE CONTROLS rewire — CORE DONE + DEPLOYED + LIVE-VERIFIED. Anon `takeControls` →
      buildInstantMission(selected contact) → startInstantFlight; no prepare/lock/sign-in/bounce.
      New store flag `instantFlight`; FlightSession `local = freeFlight||instantFlight` guards all
      server lease/keepalive/submit; instant ends with a local unranked message (scored EndCard = B5).
      ✅ VERIFIED on prod (Version 59a11f21): anon took over a real CRJ7 (JIA5312) at its actual
      176KT/1781FT, NO sign-in bounce, clean FPV + HUD, clean QUIT teardown, no console errors.
      REMAINING (B3c): redesign `briefing/QuickStartNotice.tsx` into the "FLY NOW" start card — the
      intro card still shows the OLD "sign in when ready to fly" copy, now contradicted by fly-first.
      NOTE: instant flight HUD shows "NO DESTINATION SET" — the immersive HUD isn't reading the
      instant mission's nearest-airport assignment; fold into C3 (airport bearing pointers).
- [x] B4. No-selection TAKE CONTROLS → nearestFlyableContact (dec4a67). Center = home ?? savedCenter;
      anon flies it instantly, authed selects it for the ranked briefing. No-op when selected-but-
      loading or no center/flyable available.
- [x] B5. Instant-flight debrief (d101b34). New `instant` DebriefSubmission status → EndCard shows a
      LOCALLY SCORED, unranked debrief (same landing evaluation as tutorial; never submitted),
      authority "INSTANT FLIGHT — LOCAL AND UNRANKED", amber SIGN IN TO RANK THIS FLIGHT
      (onSignIn→sign-in sheet), ScoreBreakdown collapsed behind ▸details. 2 EndCard tests.
      NOTE: kept the full ranked EndCard layout intact (its tests lock it); the mock's 3-stat visual
      trim / FLY AGAIN button not done — optional polish follow-up.

## TODO — anon abuse controls (NEEDS DECISION on tripwire mechanism)
- [ ] C1. Client cap: localStorage anon-flight count; 4th → require sign-in (block instant path).
- [ ] C2. IP tripwire (worker): count anon flight-starts by CF-Connecting-IP, fail-open. Mechanism TBD
      (Rate Limit binding vs KV counter vs DO). Client beacons on anon flight start; over-threshold →
      require sign-in. Does NOT gate the current flight on the network (optimistic + fail-open).

## HUD
- [x] C3 (instant-flight part) / #47. Instant flight destination pointer fixed (51a9574, deployed
      b08ce861) — ungated `immersiveNavCue` for instantFlight; shows "KGPT · 22.4 NM" + DEST arrow,
      verified live. Decision logged. STILL OPEN in #47: destination indicator in the DEFAULT
      (non-immersive) desktop HUD.

## DONE (owner sequence a→handoff→b→c, 2026-08-13)
- [x] (a) triage: closed #64 #58 #63 #43 #32 #26 #9 #36 (51→43 open); commented #65 #61 #47 #66.
- [x] handoff: pause-2026-08-13-instant-flight-shipped.md
- [x] (b) B5 debrief verify: instant flight entry verified live (A20N airliner takeover, no bounce);
      debrief scored EndCard + SIGN IN TO RANK unit-tested; owner confirmed crash→debrief mechanism.
- [x] (c) C3 instant destination pointer — see HUD above.

## STILL PENDING
- [x] #47 default (non-immersive) desktop HUD destination indicator — HudDestinationCue in Hud.tsx
      (top-center, airport · NM · heading-relative arrow), driven by immersiveNavCue; supersedes +
      removes mission/MissionNavCue.tsx. Gate green (1290 tests). COMMITTED, NOT DEPLOYED (owner signoff).
- [x] verify + close #65 (mouse-look) and #61 (exterior trail flicker) — VERIFIED on b08ce861, closed.
- [x] B5 polish: instant debrief hero (big outcome + AIRTIME/DISTANCE/MAX ALT) + FLY AGAIN button
      (restarts a fresh instant flight via App flyAgain). Additive, instant-only. Gate green.
      DEPLOYED 2026-08-13 @ Version 07a0984a (commit bfff644). ⚠️ FLY AGAIN restart path still needs
      an eyeball on prod (unit-tested only) — fly an instant flight → debrief → tap FLY AGAIN.

## UX issue batch (mobile walkthrough 2026-08-13) — HOLDING DEPLOY for owner
- [x] #69 pick-plane search zoom — inputs 16px at <=1023px (iOS focus-zoom fix). CSS-only.
- [x] #72 cockpit preview — DROPPED (owner chose drop over video); removed CockpitPreview + stale copy.
- [x] #74 immersive attribution/Cesium-credit fade — credit joins the auto-hide (text attribution already faded).
- [x] #75 immersive buttons fade — FULL/EXIT · DCLTR · MENU + NAV/WX chip fade with idle; tap reveals.
      Kept always-on: HUD bar, stick, throttle, warnings. Flight chips (CAM/GEAR/FLP/TRM) NOT faded.
- [ ] #73 in-flight airport-label declutter (distance cap in data/airports.ts visibleAirports) — NEXT.
- [ ] #70 free-flight modal bottom overlap + #71 provisional-mission card mobile display — layout, likely shared root cause.
_Batch 1 (#69/#72/#74/#75) gate green: typecheck, 1287 unit, lint 5/8. COMMITTED, NOT DEPLOYED._

## C1 (client anon cap) and C2 (worker IP tripwire) — DEFERRED by owner (behind-the-scenes admin).

## Issues filed 2026-08-13: #66 (local/staging feed), #67 (mini-2D map on WX/radar), #68 (initial 3D-tilt wow).

## Issue triage 2026-08-13 — CLOSED #64 #58 #63 #43 #32 #26 #9 #36 (fixed-batch, 51→43 open).

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
