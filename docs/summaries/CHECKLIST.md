# Checklist — Gulf Coast place labels (variant B)

_Updated: 2026-08-12 — mongols-rich-hud (built + gate-green @ 7c1c66c; NOT deployed — awaiting signoff)_

Spec: `docs/superpowers/specs/2026-08-12-gulf-coast-labels-design.md`

## Checklist
- [x] 1. `shortenAirportName` + airport labels → shortened names (1468d87)
- [x] 2. `data/places.ts` + curated `places-gulf.json` + `visiblePlaces` (a2e79a0)
- [x] 3. `fetch-ournavaids.sh` + `navaids-vor.json` + `data/navaids.ts` + `visibleNavaids` (401a3a4)
- [x] 4+5. `labelLayers.ts` sync (glyphs ▪ ⬡ •) + `OverlayLayers.tsx` wiring + attribution (8f8407c)
- [x] 6. Airport extract regen WITH names + NAS/AFB + 22-char cap→code (7c1c66c)
- [ ] Deploy: `npm run deploy:production` + push  ← AWAITING SIGN-OFF

Verified live (local build, FREE FLIGHT + LABELS ON): 124 labels — 60 airports (▪, names capped),
24 navaids (⬡ code, green), 16 landmarks (• dim cyan), 24 towns (gray). Declutter correct (nothing
from orbit; regional range gate). Gate green: typecheck, 1265 tests, lint 0 errors.

Note: #65 mouse-look + 5-flights/user + admin one-tap already SHIPPED & DEPLOYED (Version 1c765af5).
