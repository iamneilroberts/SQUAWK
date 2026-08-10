# adsb-game — Cloudflare public game execution checklist

- [x] Approve and commit the Cloudflare-native public ADS-B game design (`b985b14`)
- [x] Add the prominent main-page `HOW TO FLY` requirement and commit the 18-task implementation plan (`2b61025`)
- [x] Task 1 — Establish the Cloudflare application and modern test shell
- [x] Task 2 — Add shared contracts and the dynamic request pipeline
- [x] Task 3 — Create the D1 schema and repositories
- [x] Task 4 — Build exact broker admission, modes, counters, and leases
- [x] Task 5 — Port ADS-B ingestion and add normalized regional caching
- [x] Task 6 — Generate runway shards and deterministic mission assignment
- [x] Task 7 — Implement magic-link identity, sessions, Turnstile, and preferences
- [x] Owner checkpoint A — Foundation approved 2026-08-10; live auth smoke test authorized
- [x] Task 8 — Build public browse, the quick-start notice, and mission tray
- [x] Task 9 — Add authoritative mission preparation, confirmation, and locking
- [x] Task 10 — Integrate locked missions, assists, ghost traffic, and the existing simulator
- [x] Task 11 — Implement runway landing evidence, safety gates, and scoring
- [x] Task 12 — Add debrief, profiles, and cached partitioned leaderboards
- [ ] Task 13 — Add tutorial, coaching, installability, and offline result sync
- [ ] Owner checkpoint B — Review the complete product vertical slice
- [ ] Task 14 — Secure admin APIs and implement controls, audits, bans, and termination
- [ ] Task 15 — Build detailed admin telemetry, sessions, users, and logs
- [ ] Task 16 — Add transition-based email alerts and scheduled health checks
- [ ] Owner checkpoint C — Run Access, control, alert, audit, and recovery drills
- [ ] Task 17 — Add E2E, failure/load, security, and performance release gates
- [ ] Task 18 — Provision staging, validate production, cut over, and retire Python
- [ ] Owner checkpoint D — Explicitly approve public mission enablement

Execution uses subagents one task at a time: one scoped implementer, followed by independent
spec/compliance and code-quality reviews. The root agent owns integration, full gates, and
the single commit for each task. Subagents must not edit overlapping files concurrently.

_Updated: 2026-08-10 — mongols_
