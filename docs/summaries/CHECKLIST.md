# Checklist — Feature 1: Spawn Chooser

Build from `docs/superpowers/plans/2026-08-14-spawn-chooser.md` via subagent-driven development.
Pin every implementer subagent `model: sonnet`; opus for the final whole-branch review.

- [x] `/branch spawn-chooser` — isolated worktree off main; node_modules + .env symlinked (NEVER npm ci here)
- [x] Task 1 — base-leg guidance knobs (`baseLegOffsetNm`/`baseLegOffsetDeg`) in types + 5 profiles + validator (commit 34d66fc)
- [ ] Task 2 — `mission/spawnPlacement.ts` (`onFinalPlacement` + `baseLegPlacement`) + tests (TDD)
- [ ] Task 3 — `takeover/spawn.ts` position/altitude/speed/vertical-rate overrides + disclosures + tests (TDD)
- [ ] Task 4 — `takeover/spawnModePreference.ts` (4-way, replaces headingToFafPreference, #90 migration) + tests (TDD)
- [ ] Task 5 — store `repositioned` flag + `FlightSession onEnd` unranked short-circuit + EndCard disclosure (build-verified)
- [ ] Task 6 — 4-way chooser UI: FlightSession spawnMode + branch both build sites + instantMission/App swap + HandoffCard selector + UNRANKED note; delete headingToFafPreference (build + full `npm run test:unit`)
- [ ] Whole-branch review (opus) → decisions.md entry → PR → deploy branch to prod for owner live pass → stop for sign-off

_Updated: 2026-08-14 — spawn-chooser_

