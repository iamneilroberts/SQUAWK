# Browse Eligibility Badges (#55) + On-Demand Fetch (#41) Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Show which live contacts are mission-eligible before the player taps them (#55), and fire a fresh ADS-B fetch when a briefing opens or the range changes so the position isn't stale (#41) — without exceeding the 1 req/s upstream budget.

**Architecture:** #55 is pure + cheap — `checkEligibility(contact)` needs only the contact (no fetch, no own position). Tint the map chevron (`icons.ts::contactColor`) and mark the list row (`ContactList.tsx`) from it. #41 adds a `refreshNow()` to the existing traffic poller that reuses its in-flight guard (`schedule(0)` when idle), coalescing with the poll and the server-side 30s cache + global 1/s gate — never a second parallel call.

**Tech Stack:** React 18 + TS · zustand · Cesium · vitest. Commands from `frontend/`.

## Global Constraints

- Honest data: eligibility is computed live per contact; do not fabricate or cache a stale verdict. Ineligible ≠ hidden — contacts stay visible, just marked.
- Design decision (record in docs/decisions.md): **ineligible contacts render dimmed/muted** (a desaturated gray chevron + dimmed list row); eligible contacts keep their existing color coding — civilian cyan `#5fd7e0`, military amber `#ffb000`. No new accent colors invented (terminal palette). Eligibility is orthogonal to military, layered as brightness/saturation, not hue.
- #41 must NOT add a parallel fetch path: reuse the poller's internal `schedule(0)`/`inFlight` debounce so an on-demand refresh ADVANCES the next poll, never stacks a second upstream call. The server 30s region cache (`TRAFFIC_FRESH_SECONDS`) + the Durable Object global `minimumIntervalMs` gate are the backstop — the client just nudges timing.
- No new dependencies. Suite green at every commit. Existing tests extended, never weakened.
- Commit per task.

---

### Task 1: Eligibility indicators on browse contacts (#55)

**Files:**
- Modify: `frontend/src/globe/icons.ts` (`contactColor` — dim ineligible)
- Modify: `frontend/src/panels/ContactList.tsx` (per-row eligible/ineligible class + a small marker)
- Modify: `frontend/src/styles/tokens.css` (a `.contact-row-ineligible` dim style; a badge/dot if used)
- Test: `frontend/src/globe/icons.test.ts` (contactColor cases), and ContactList's test if one pins row classes

**Interfaces:**
- `contactColor(c: Contact): string` — unchanged signature; now returns a dimmed/muted color when `checkEligibility(c).eligible === false`, else the existing military/civilian color.

**Steps (TDD):**
- [ ] Read `frontend/src/takeover/eligibility.ts` (`checkEligibility(contact) → {eligible} | {eligible:false, reason}`), `frontend/src/globe/icons.ts::contactColor` (currently `c.military ? "#ffb000" : "#5fd7e0"`), and `ContactList.tsx` rows (~169-189, already imports `checkEligibility`).
- [ ] Write failing tests in icons.test.ts: eligible civilian → `#5fd7e0`; eligible military → `#ffb000`; ineligible (e.g. a contact whose `checkEligibility` is false — construct one with a ground/stale/unsupported field) → a dimmed color (assert it differs from the bright ones and equals the chosen muted constant). Run, confirm fail.
- [ ] Implement: `contactColor` computes `checkEligibility(c).eligible`; if false return a muted gray (e.g. `#5a6b70` — pick one and name it a const with a comment); else the existing military/civilian branch. Keep it pure. Green.
- [ ] ContactList: per row compute `checkEligibility(c).eligible` once; add `contact-row-ineligible` to the className when false. Optionally a leading marker (e.g. a small dim dot or a `·` vs `▸`) — keep it subtle, terminal style. Do NOT hide ineligible rows (the existing filter dropdown already lets the player filter; this is a passive indicator).
- [ ] tokens.css: `.contact-row-ineligible { opacity: 0.5; }` (or a muted text color) — subtle, matches the dim-chevron.
- [ ] Full gate `npx vitest run && npx tsc --noEmit`.
- [ ] Commit `feat(browse): dim ineligible contacts on the map + list so eligible ones stand out (#55)`.

### Task 2: On-demand ADS-B fetch on briefing-open + range-change (#41)

**Files:**
- Modify: `frontend/src/state/store.ts` (`startTrafficPolling` returns `{ stop, refreshNow }`; wire `refreshNow` into `select(hex)` and `setRadiusNm(n)`, OR expose it so the mount site wires it)
- Modify: `frontend/src/globe/ViewerHost.tsx` (the one caller of `startTrafficPolling` — capture `refreshNow`) if the wiring needs the returned handle; alternatively fire from `select`/`setRadiusNm` directly inside the store
- Test: `frontend/src/state/store.test.ts` (refreshNow coalescing behavior)

**Interfaces:**
- Consumes: the poller's internal `schedule(0)` + `inFlight` guard (store.ts ~407-523; the visibility-change handler at ~512-515 already does `else if (!inFlight) schedule(0)` — the exact proven pattern).
- Produces: `refreshNow()` — if a fetch is in flight, no-op (its result applies momentarily); else cancel the pending wait and fetch immediately (advances, not stacks). Fired on: `select(hex)` (briefing opens) and `setRadiusNm(n)` (range change).

**Steps (TDD where feasible):**
- [ ] Read `startTrafficPolling` (the closure, `tick`, `schedule`, `inFlight`, the return), `select` (store.ts ~272), `setRadiusNm` (~174), and how ViewerHost.tsx:100 mounts the poller.
- [ ] Decide the cleanest wiring: preferred is the poller storing its `schedule`/`inFlight` such that `select`/`setRadiusNm` can trigger a coalesced refresh (e.g. the poller registers a module-level `refreshNow` ref the store actions call, or returns the handle to ViewerHost which the store reads). Match the codebase's existing pattern — do NOT introduce a second `fetchTraffic` call site.
- [ ] Write a failing test: with a fake/injected fetch, `refreshNow()` while idle triggers exactly one immediate fetch and advances the timer; `refreshNow()` while a fetch is in flight does NOT trigger a second fetch. (Use the store's existing test harness / fake timers pattern — read store.test.ts first.) If the poller isn't unit-testable in isolation, pin the coalescing helper (extract a tiny pure `shouldRefreshNow(inFlight)` or test via the store's public surface). Run, confirm fail.
- [ ] Implement `refreshNow` and wire it to `select` (only when actually selecting a contact, i.e. not on deselect/null) and `setRadiusNm`. Green.
- [ ] Full gate `npx vitest run && npx tsc --noEmit`.
- [ ] Commit `feat(browse): fresh ADS-B fetch on briefing-open + range change, coalesced with the poll (#41)`.

### Task 3: Decision log + deploy

- [ ] Append `docs/decisions.md` CF-021: the dim-ineligible design choice (#55) + the coalesced-refresh guarantee (#41: reuses the poller in-flight guard + server 30s cache + DO 1/s gate, so no extra upstream calls). Commit.
- [ ] `npm run deploy:production`; probe `https://fly.voygent.app/` → 200; note the worker version.
- [ ] Push. Owner on-device test: (a) browse shows eligible vs dimmed contacts at a glance; (b) opening a briefing no longer shows POSITION STALE for a fresh contact. Then close #55/#41.

## Self-Review
Pure-testable bits (`contactColor`, refresh coalescing) have named tests. `checkEligibility` is confirmed synchronous + contact-only (no fetch/own-position), so per-contact-per-poll cost is trivial. #41's safety rests on reusing the existing in-flight/schedule guard + server cache — the plan forbids a parallel fetch path. New names: the muted-color const (#55), `refreshNow` (#41).
