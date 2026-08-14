# #52 Approach speed/altitude band — CHECKLIST

_Updated: 2026-08-13 — approach-band_

Owner decisions: explicit per-class `approach` field + BOTH display surfaces (NavDirector text line + tape bands).

## Data
- [x] `approach: { targetSpeedKt; bandKt }` on MissionProfile (types.ts)
- [x] Validate `approach` (positive, bandKt < targetSpeedKt) — profiles.ts + tests
- [x] `approach` block in all 5 JSONs (surgical insert, no reformat): c172s 65±5, b738 150±10, f5e 155±12, biz 118±10, tprop 118±10
- [x] decisions.md entry (tuning knobs, Phase-B verification)

## Pure logic (TDD)
- [x] Extract glideSlopeAltitudeFt + glidepathToleranceFt into guidanceGeometry.ts
- [x] Deduped 3 glide-slope formula copies (approachGuidance, approachSurface, approachAlerts)
- [x] mission/approachBand.ts approachBandFor(...) — gating + speed band + altitude band

## Display
- [x] NavDirector strip line "APCH lo-hi KT · lo-hi FT" (cyan)
- [x] tapeBandBox + cyan band overlay on IAS + ALT tapes
- [x] Wired FlightSession -> Hud -> ImmersiveHudBar (excludes instant flight)
- [x] CSS: .tape-band, .imm-director-approach

## Ship
- [x] Gate: typecheck clean, 1401 unit tests pass, lint 0 errors (5 pre-existing globe warnings)
- [x] Production build clean
- [x] Committed
- [ ] Owner sign-off to deploy
- [ ] Deploy (ff-merge both, npm run deploy:production, push both)
- [ ] Owner device-verify on final approach -> close #52 -> prune worktree
