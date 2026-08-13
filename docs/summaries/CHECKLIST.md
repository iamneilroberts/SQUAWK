# Checklist — mobile UI polish finish + multi-aircraft-type flight models

_Updated: 2026-08-13 — mongols-rich-hud. Live prod @ HEAD 9f78531, Version 5956e755._
_Full handoff: shared coord dir → handoffs/pause-2026-08-13-ui-polish-aircraft-types.md_

Deploy = `cd frontend && npm run deploy:production` then `git push`.
Gate = `cd frontend && npm run typecheck && npm run test:unit && npm run lint` (≤8 warns; 5 pre-existing).
Suite 1281 green. THIS IS LIVE PROD — commit/deploy discipline; owner verifies each deploy on iPhone.

## Done + deployed this session
- [x] #47 desktop HUD dest indicator + B5 instant hero/FLY AGAIN (Version 07a0984a)
- [x] #69 search zoom · #72 drop cockpit preview · #73 airport label range cap
- [x] #74/#75 immersive chrome auto-hide → REDESIGNED: hide-while-flying + MENU reveals all
- [x] #70/#71 free-flight modal + mission card fit/bleed-through
- [x] Cesium credit widget HIDDEN (keyless; attribution in StatusBar)
- [x] One-tap resume on touch (RESUME direct; "click globe" is desktop-only)
- [x] #76 handoff card fits width + z-index · #77 iOS ENTER FULLSCREEN gated
- [x] #67 satellite basemap under NAV/WX (Esri, hook-free NavBasemapLayer, shared warp)
- [x] HUD C default · SIGN IN clear of ALT · mission grid 2-col ≤380px (Version 5956e755)

## Pending
- [ ] Owner verify Version 5956e755 on device (HUD C, sign-in, mission fit, #67 basemap imagery)
- [ ] "cesium border still seems oversized" — AMBIGUOUS; get a screenshot before fixing
- [ ] Mission briefing may still scroll if ELIGIBLE AIRPORTS list long — condense further if reported
- [ ] #67 basemap live-verify (Esri CORS — bails to black if tainted; proxy via worker if so)
- [ ] FLY AGAIN restart (B5) still not live-verified end-to-end
- [ ] #77 FULL immersive toggle still over-promises on iOS (minor relabel)
- [ ] EPIC: multi-aircraft-type flight models — resolveClass (takeover/eligibility.ts:33) maps t→3 classes;
      broaden buckets + add archetype param files + maybe parametric adsbdb scaling. START WITH BRAINSTORMING.
- [ ] Deferred by owner: #66 feed cfg · #68 3D-tilt wow · #78 desktop dashboard realism · C1 client cap · C2 IP tripwire
