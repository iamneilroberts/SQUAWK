# Checklist — Feature 1: Spawn Chooser  ✅ BUILD COMPLETE (pending owner sign-off)

Built from `docs/superpowers/plans/2026-08-14-spawn-chooser.md` via subagent-driven development.

- [x] `/branch spawn-chooser` — isolated worktree off main; node_modules + .env symlinked
- [x] Task 1 — base-leg guidance knobs (34d66fc, review clean)
- [x] Task 2 — spawnPlacement geometry (54479cf, review clean)
- [x] Task 3 — spawn position/altitude/speed/vsi overrides (fb4cc62, review clean)
- [x] Task 4 — 4-way spawnModePreference + #90 migration (0f6021a, review clean)
- [x] Task 5 — repositioned flag + onEnd unranked short-circuit (a8c0d32→3b33a0d, 1 fix: countdown decouple)
- [x] Task 6 — 4-way chooser UI + wiring + delete old pref (2dcec5b, opus review approved)
- [x] Whole-branch opus review — READY, no Critical
- [x] Final fix wave — on-slope vertical rate + wording (760e000, re-review clean)
- [x] decisions.md entry appended
- [ ] **PENDING OWNER:** push branch + open PR
- [ ] **PENDING OWNER:** deploy to prod for live pass (do NOT merge until sign-off)

Verification: full unit suite 1455 pass · tsc clean · build clean · merges onto main (d1ab7cd) with no conflicts.

_Updated: 2026-08-14 — spawn-chooser (build complete)_
