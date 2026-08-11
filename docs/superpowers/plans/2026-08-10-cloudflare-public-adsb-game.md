# Cloudflare-native public ADS-B flight game — implementation plan

> **Execution contract:** Work task-by-task in the order written. Within each task use
> failing test -> minimal implementation -> passing focused test -> full gates. Keep each
> task to one reviewable commit. Stop at the four owner checkpoints; do not deploy
> production resources or enable public mission starts without explicit owner approval.

**Goal:** Replace the current FastAPI/Vite split with one efficient public
`fly.voygent.app` Cloudflare application: anonymous live ADS-B browsing, a prominent
main-page `HOW TO FLY` guide, map-first mission briefing, magic-link authentication at
`TAKE CONTROLS`, client-side GA/airliner/fighter flights, scored runway landings,
leaderboards, and an Access-protected operations console with exact cost controls,
capacity alerts, logs, active sessions, bans, read-only mode, and a kill switch.

**Architecture:** Keep `frontend/` as the application/deployment root and preserve the
proven pure TypeScript simulator, Cesium host, aircraft profiles, input adapters, and
spawn reconstruction. Add a TypeScript Worker, D1 migrations, one global ADS-B Broker
Durable Object, shared pure mission/scoring modules, and Cloudflare integration tests
beside the React application. Port the small Python feed adapter to TypeScript, prove
fixture parity, then remove the Python runtime and nginx containers at cutover. Static
assets remain assets-first; only `/api/*` and Access-protected `/admin*` enter Worker
logic.

**Authoritative design:** `docs/superpowers/specs/2026-08-10-cloudflare-public-adsb-game-design.md`

---

## 0. Verified starting point

Verified on branch `mongols` on 2026-08-10:

| Area | Current truth | Migration consequence |
|---|---|---|
| Frontend | React 18, Cesium, Zustand, Vite 5 | Keep the app; upgrade the build/test shell for Cloudflare |
| Simulator | Pure data-driven 6-DOF TypeScript at fixed 60 Hz | Reuse; do not move physics server-side |
| Aircraft | `c172s`, `b738`, `f5e` profiles and designator lists | Reuse profiles; change unmatched types from C172 fallback to browse-only |
| Takeover | `ContactList` fires directly into countdown/free flight | Replace with selection -> briefing -> auth -> mission lock |
| Traffic | Global Zustand poller calls Python `/api/adsb` every 5 seconds | Replace with context-aware 15/8/12-second Worker contracts |
| Feed adapter | FastAPI failover, two-second process cache, one process lock | Port normalization fixtures; replace cache/rate gate with the global broker |
| Airport data | One 512 KB airports-only bundle; no runway geometry | Generate versioned airport/runway regional shards |
| Landing | Gentle/level/slow contact classification only | Add assigned-runway safety gates, evidence, and 0–100 scoring |
| Tests | 78 files / 975 tests pass; typecheck and production build pass | Preserve this as the regression floor |
| Bundle | One 4.84 MB minified / 1.30 MB gzip JS bundle | Split Cesium/admin chunks and enforce a bundle budget |
| Python tests | `python3 -m pytest -q backend/tests` hung silently in this worktree | Treat Python JSON fixtures as parity inputs; do not make the hung runner a release gate |
| Worktree | Only `.superpowers/` is untracked before this plan | Never add or delete that visual-companion state |

Baseline commands:

```bash
cd frontend
npm ci
npm test
npm run typecheck
npm run build
```

Expected pre-migration result: 78 test files and 975 tests pass. The build's large-chunk
warning is known and must be resolved before the public release gate.

## 1. Target repository layout

```text
frontend/
  migrations/                    D1 forward-only SQL
  public/
    data/airports/<version>/     immutable manifest + regional runway shards
    manifest.webmanifest
    sw.js
  scripts/                       Cesium copy + airport data verification
  src/
    admin/                       lazy-loaded admin console
    auth/                        magic-link and session UI
    briefing/                    quick-start notice + mission tray
    data/                        public API client and traffic presentation
    mission/                     pure assignment, assists, evidence, scoring
    offline/                     IndexedDB result queue
    tutorial/                    deterministic tutorial definitions and coaching
    sim/, globe/, input/         preserved simulator/runtime seams
    shared/                      isomorphic contracts, codes, versions, schemas
  test/
    e2e/                         Playwright journeys
    fixtures/adsb/               feed parity and failure fixtures
    load/                        fake-provider concurrency scenarios
  worker/
    admin/                       Access validation, telemetry, controls, users
    adsb/                        TypeScript feed client and normalizer
    auth/                        HMAC identity, tokens, sessions, CSRF
    db/                          repositories and transaction helpers
    durable/AdsbBroker.ts        global cache, counters, leases, modes, alerts
    http/                        router, response, validation, security
    missions/                    authoritative mission/result handlers
    telemetry/                   Analytics Engine + bounded system events
    env.ts
    index.ts
  vite.config.ts
  vitest.config.ts               existing node/pure tests
  vitest.worker.config.ts        workerd/Miniflare integration tests
  playwright.config.ts
  wrangler.jsonc
```

The Worker may import only pure modules from `src/shared/` and `src/mission/`.
Worker code must never import React, Zustand, Cesium, DOM-only modules, or client storage.

## 2. Toolchain and dependency decision

The Cloudflare Vite plugin now requires Vite 6, 7, or 8; the current repository uses
Vite 5. The Workers Vitest pool requires Vitest 4.1 or newer; the current repository uses
Vitest 2. Use the compatible Vite 7 line for the smallest major jump, and lock exact
resolved versions in `package-lock.json`.

Versions observed while writing this plan:

- `@cloudflare/vite-plugin 1.51.1` (requires `wrangler ^4.120.0`);
- `wrangler 4.120.0`;
- `@cloudflare/vitest-pool-workers 0.20.3` (requires Vitest 4.1);
- `vitest 4.1.10`;
- `@playwright/test 1.62.1`.

Approved dependency categories for implementation:

- required Cloudflare/Vite/Workers test tooling;
- Playwright for the approved end-to-end journeys;
- ESLint + TypeScript/React Hooks plugins to satisfy the release lint gate.

Do not add a runtime router, ORM, schema library, JWT library, state library, or PWA
framework. Use the platform APIs, a small explicit route table, D1 prepared statements,
Web Crypto, the existing Zustand store, hand-written boundary validators, and a small
service worker. Do not run `npm audit fix --force`; review audit changes deliberately.

Approved launch configuration defaults, centralized in `src/shared/limits.ts` rather
than repeated in handlers:

| Control | Default |
|---|---:|
| Anonymous / signed browse / active flight refresh | 15s / 8s / 12s |
| Conservation anonymous / signed browse refresh | 30s / 15s |
| Dynamic admitted-request ceiling | 100,000 per UTC day |
| Automatic conservation / read-only / kill thresholds | 70% / 90% / 100% |
| Active flights | one per user; ten global; warning at eight |
| Magic-link requests | three per email digest per hour, plus IP limit |
| Mission starts / result submissions | ten each per user per hour |
| Leaderboard client / server cache | no faster than 15s / 60s |
| Magic link / prepared mission lifetime | 15 minutes / 2 minutes |
| Active-flight lease | renew at poll; expire after 45 seconds without renewal |
| Ranked mission source age | at most 15 seconds |
| Traffic stale / expired | visibly stale after configured fresh window; remove at 120s |
| D1 session last-seen flush | no more than once per five minutes |
| System event / admin audit retention | 30 days / 365 days |

`UPSTREAM_MIN_INTERVAL` and `UPSTREAM_DAILY_LIMIT` deliberately have no guessed
default: they must match the contracted provider plan before production browsing or
missions are enabled.

Reference implementation constraints:

- Cloudflare Vite plugin: <https://developers.cloudflare.com/workers/vite-plugin/>
- Workers Vitest integration: <https://developers.cloudflare.com/workers/testing/vitest-integration/>
- D1 migrations: <https://developers.cloudflare.com/d1/reference/migrations/>
- Access JWT validation: <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/>

## 3. Global constraints

These are binding across every task:

1. **Traffic honesty:** real ADS-B contacts are real or absent. Cached data carries age and
   `FRESH | STALE | EXPIRED`; no demo traffic appears in production.
2. **Simulation boundary:** 60 Hz physics stays in mutable/ref client state. Zustand and
   network APIs receive lower-rate snapshots only.
3. **Unknown aircraft:** an unmatched or insufficient type remains browsable and cannot
   start a mission. Remove the current silent C172 substitution.
4. **Authoritative mission:** the browser preview is provisional. The Worker re-fetches
   fresh traffic, computes eligible runways, and locks all versions before countdown.
5. **Identity minimization:** never persist raw email. Store
   `HMAC(email_hmac_key, normalized_email)`; hash random tokens/session IDs before D1.
6. **No secrets or PII in logs:** no raw email, full IP, tokens, cookies, Access JWT,
   complete ADS-B payload, or result evidence body in logs/analytics.
7. **Spend containment:** dynamic work cannot bypass endpoint limits, broker admission,
   exact daily counters, provider allowance, or effective-mode checks.
8. **Mode precedence:** effective mode is the most restrictive of deployment
   `FORCE_MODE`, administrator-requested mode, and automatic budget/health mode.
9. **Admin defense in depth:** Cloudflare Access plus Worker JWT validation plus exact
   `dneilroberts@gmail.com` allow check. A game session never authorizes admin APIs.
10. **Mutations:** same-origin POST/PATCH, CSRF, strict body/size validation, idempotency
    key, stable error code. Destructive admin actions also require reason and typed
    confirmation.
11. **Storage bounds:** no per-frame D1 telemetry or permanent ADS-B archive. System
    events expire; active-session last-seen writes are coalesced.
12. **Failure honesty:** D1/broker/email/provider/terrain/R2/analytics failures follow
    design section 8 and never report an operation as successful when it did not commit.
13. **Data versions:** locked missions persist airport, aircraft profile, assignment,
    scoring, assist-definition, and tutorial version where applicable.
14. **Visual language:** retain the mission-terminal palette and compact map-first layout.
    The quick-start notice and admin console use the same tokens, not a second design
    system.
15. **Every task ends green:** focused tests, all node tests, Worker tests once introduced,
    typecheck, lint once introduced, and production build.
16. **Decision log:** add `CF-001`, `CF-002`, ... entries to `docs/decisions.md` for
    non-obvious changes made during execution.

## 4. Stable public contracts

All Worker responses use:

```ts
type SystemMode = "NORMAL" | "READ_ONLY" | "KILL_SWITCH";

type ApiEnvelope<T, Code extends string = "OK"> = {
  ok: boolean;
  code: Code;
  requestId: string;
  serverTime: string;
  mode: SystemMode;
  data?: T;
  error?: { message: string; retryAfterSeconds?: number };
};
```

Traffic data additionally includes `sourceTime`, `fetchedAt`, `cacheAgeSeconds`,
`freshness`, `providerAvailable`, `regionKey`, and `nextRefreshSeconds`.
Frontend copy switches on stable `code` values, never exception strings.

Planned route families:

| Trust boundary | Routes |
|---|---|
| Public reads | `GET /api/status`, `/api/traffic`, `/api/leaderboards` |
| Identity | `POST /api/auth/request`, `/consume`, `/logout`; `GET/PATCH /api/me` |
| Mission | `POST /api/missions/prepare`, `POST /api/missions`, `GET /api/missions/:id`, `GET /traffic`, `POST /result` |
| Admin | `GET /api/admin/*`; mode, cache, user, session, flight, and alert POST actions |

Airport shards are immutable static assets, not dynamic API calls.

## 5. Requirement-to-task map

| Requirement | Task(s) |
|---|---|
| One Cloudflare Worker + static app | 1–2 |
| D1 identity/missions/results/audit | 3 |
| Exact broker budgets, modes, leases | 4 |
| Regional ADS-B cache and TS feed port | 5 |
| Runway data and deterministic assignment | 6 |
| Magic link, Turnstile, sessions, saved center | 7 |
| Prominent main-page HOW TO FLY notice | 8 |
| Map-first briefing and alternatives | 8 |
| Fresh mission revalidation and lock | 9 |
| Existing physics + ghost + FULL/NAV/OFF | 10 |
| Runway safety, score, evidence, result | 11 |
| Debrief and leaderboards | 12 |
| Tutorial, coaching, PWA/offline queue | 13 |
| Access, audit, bans, sessions, modes | 14 |
| Detailed admin telemetry/logs/UI | 15 |
| Capacity/error alerts to owner | 16 |
| E2E/load/security/performance/CI | 17 |
| Staging, production, Python removal | 18 |

---

## Task 1 — Establish the Cloudflare application and modern test shell

**Files:**

- Modify: `frontend/package.json`, `frontend/package-lock.json`
- Modify: `frontend/vite.config.ts`, `frontend/tsconfig.json`, `.gitignore`
- Add: `frontend/tsconfig.worker.json`, `frontend/wrangler.jsonc`
- Add: `frontend/worker/index.ts`, `frontend/worker/env.ts`
- Add: `frontend/vitest.worker.config.ts`, `frontend/worker/index.test.ts`
- Add: `frontend/eslint.config.js`
- Modify: `docs/decisions.md`

**Steps:**

- [ ] Record the 975-test/typecheck/build baseline and current bundle sizes.
- [ ] Upgrade to the compatible Vite 7/Vitest 4 toolchain; add Cloudflare Vite plugin,
      Wrangler, Workers Vitest pool, generated binding types, and lint tooling.
- [ ] Configure `wrangler.jsonc` with Worker name `voygent-adsb-game`, main
      `worker/index.ts`, compatibility date pinned at implementation time, static asset
      binding `ASSETS`, SPA fallback, and Worker-first paths `/api/*` and `/admin*`.
- [ ] Define separate local/staging/production binding placeholders. Never put resource
      IDs or secrets from the Voygent travel Worker into this file.
- [ ] Define separate outbound bindings: `AUTH_EMAIL` for user-entered magic-link
      recipients after sending-domain onboarding, and destination-restricted `ALERT_EMAIL`
      for `dneilroberts@gmail.com`. Test adapters never send real mail.
- [ ] Add a minimal `/api/status` handler and assets fallback. Verify ordinary hashed
      assets bypass application routing while `/api/*` enters the Worker.
- [ ] Keep node/pure tests in the normal Vitest config and Worker tests in the
      workerd/Miniflare config. Add `test:unit`, `test:worker`, `lint`, `check`,
      `dev:worker`, `build`, and `deploy:staging` scripts.
- [ ] Run all 975 migrated tests, Worker smoke test, typecheck, lint, and build.
- [ ] Record `CF-001`: keep `frontend/` as deploy root; no parallel replacement app.

**Acceptance:** Local `wrangler dev` serves the SPA and typed status endpoint; no Python
process is needed for the smoke test. Existing simulator tests remain green.

**Commit:** `build: establish Cloudflare Worker and test shell`

## Task 2 — Add shared contracts and the dynamic request pipeline

**Files:**

- Add: `frontend/src/shared/api.ts`, `codes.ts`, `mode.ts`, `versions.ts`
- Add: `frontend/worker/http/router.ts`, `response.ts`, `validation.ts`,
  `security.ts`, `idempotency.ts`
- Add: `frontend/worker/telemetry/requestContext.ts`, `redact.ts`
- Add corresponding node and Worker tests

**Steps:**

- [ ] Write failing tests for envelope metadata, unknown routes, method rejection,
      request IDs, `Retry-After`, body-size limits, coordinates/radius clamps, same-origin
      checks, CSRF hooks, and redaction.
- [ ] Implement the explicit route table and `RequestContext`; generate a UUID once per
      request and carry it through logs, D1 events, errors, and responses.
- [ ] Add security headers: CSP compatible with Cesium/basemap/terrain hosts,
      `frame-ancestors 'none'`, no-sniff, referrer policy, permissions policy, and
      HSTS in production.
- [ ] Add endpoint-limiter adapters keyed by coarse anonymous IP digest or authenticated
      user ID. Tests use deterministic fakes; no full IP is logged or persisted.
- [ ] Write one scrubbed Analytics Engine datapoint for every admitted request, with a
      no-op/failure-tolerant adapter for local tests.
- [ ] Make errors stable and typed. Unexpected exceptions become
      `INTERNAL_ERROR` with request ID; their scrubbed details go to observability only.
- [ ] Append `CF-002`: shared envelope and trust-boundary route table.

**Acceptance:** Every dynamic route passes one tested middleware sequence; public,
authenticated, and admin handlers cannot be registered without declaring their boundary.

**Commit:** `feat(worker): add typed request and security pipeline`

## Task 3 — Create the D1 schema and repositories

**Files:**

- Add: `frontend/migrations/0001_initial.sql`
- Add: `frontend/worker/db/client.ts`, `types.ts`, `users.ts`, `sessions.ts`,
  `missions.ts`, `results.ts`, `bans.ts`, `events.ts`, `audit.ts`
- Add: `frontend/worker/crypto.ts`
- Add repository/migration integration tests

**Steps:**

- [ ] Create the nine approved logical tables: `users`, `user_preferences`,
      `magic_links`, `sessions`, `missions`, `flight_results`, `user_bans`,
      `system_events`, and `admin_audit`.
- [ ] Use text UUID primary keys, foreign keys, uniqueness for handle/email digest and
      one result per mission, status checks, bounded text columns at the handler boundary,
      and indexes for expiry, user/status, mission state, event time, and audit time.
- [ ] Store structured snapshots/evidence summaries as size-bounded versioned JSON, never
      arbitrary unbounded blobs.
- [ ] Implement prepared-statement repositories and explicit transaction/batch functions
      for magic-link consume, session rotation, mission lock, result finalize, ban, and
      audit mutation.
- [ ] Implement normalized-email HMAC and SHA-256 token/session hashing with Web Crypto.
      Test case/whitespace normalization and prove raw email is absent from stored rows,
      logs, and thrown errors.
- [ ] Add retention queries for expired tokens/sessions, bounded system events, and
      old optional trace pointers. Audit events remain append-only.
- [ ] Apply migrations to a fresh local D1 database twice: first applies, second is a
      no-op; test rollback behavior on an intentionally invalid next migration fixture.

**Acceptance:** Worker integration tests create and query every table in isolated local
D1. The schema prevents duplicate final results and replayed magic-link consumption.

**Commit:** `feat(db): add product schema and repositories`

## Task 4 — Build the broker's exact admission, modes, counters, and leases

**Files:**

- Add: `frontend/worker/durable/AdsbBroker.ts`, `protocol.ts`, `clock.ts`
- Add: `frontend/src/shared/limits.ts`
- Modify: `frontend/wrangler.jsonc`, generated Worker types
- Add Durable Object integration tests

**Steps:**

- [ ] Add the Durable Object binding `ADSB_BROKER` and one global object ID derived from
      the fixed name `global-v1`; add the Wrangler class migration.
- [ ] Write fake-clock tests for 100,000-request UTC-day rollover, 70/90/100 percent
      transitions, conservation cadence, protected active-flight reserve, and mode
      precedence.
- [ ] Persist exact daily admitted/provider counters, automatic/requested mode, alert
      transition state, and compact health counters in Durable Object storage.
- [ ] Implement one active flight per user, ten globally, expiring leases, renewal,
      explicit release, user-wide release, and stale lease cleanup. Test 8/10 and 10/10
      transition events.
- [ ] Expose only typed internal broker commands. Public clients never address the object
      directly and cannot choose the object name.
- [ ] Fail closed when the broker cannot enforce admission. Keep an Access-protected
      recovery/status path and deployment `FORCE_MODE` independent of broker health.
- [ ] Append `CF-003`: one global exact-control object for launch, with measured split
      criteria recorded but not implemented.

**Acceptance:** Concurrency tests cannot admit an eleventh flight, a second flight for one
user, or a request past the daily ceiling. An admin request cannot weaken an automatic or
deployment mode.

**Commit:** `feat(broker): enforce budgets modes and flight leases`

## Task 5 — Port ADS-B ingestion and add normalized regional caching

**Files:**

- Add: `frontend/worker/adsb/normalize.ts`, `provider.ts`, `region.ts`,
  `traffic.ts`
- Add: `frontend/test/fixtures/adsb/*`
- Modify: `frontend/worker/durable/AdsbBroker.ts`
- Modify: `frontend/src/data/api.ts`, `types.ts`, `frontend/src/state/store.ts`
- Modify: `frontend/src/globe/ViewerHost.tsx`
- Add parity, region/property, broker, and polling tests

**Steps:**

- [ ] Copy the two legacy raw-feed fixtures into the new test fixture home; add timeout,
      429, malformed envelope, missing position, and ground-contact cases.
- [ ] Port Python normalization exactly, including `ac`/`aircraft` envelopes,
      numeric coercion, `ground`, `dbFlags`, position filtering, and source timestamp.
      Compare TypeScript output to approved fixture snapshots before changing fields.
- [ ] Implement strict provider URL templates from secrets/config only, primary/fallback
      order, timeout, response-size cap, status handling, minimum global interval, and
      daily provider allowance. No caller-supplied URL or header reaches `fetch`.
- [ ] Implement center-to-cell normalization, padded provider radius, requested-circle
      filtering, and bounded cache entries. Property-test cell edges, antimeridian,
      poles, invalid coordinates, radius clamps, and provider max-radius constraints.
- [ ] Coalesce simultaneous reads for a region to one provider fetch; persist bounded
      last-good cache metadata and evict expired regions. Test many callers/one region
      and many regions/global gate using the fake provider only.
- [ ] Allocate provider work in the approved order: active selected-aircraft ghost,
      multi-viewer signed regions, anonymous shared regions, then ambient in-flight
      traffic. Shed ambient traffic first when allowance is tight.
- [ ] Return explicit freshness/source/cache metadata. On failure serve bounded stale,
      back off, then expire contacts; never label stale data live.
- [ ] Replace `startPolling(5000)` with a visibility- and mode-aware controller:
      anonymous 15s, signed browse 8s, active flight 12s, conservation 30/15s, server
      `nextRefreshSeconds` respected, no queued overlapping calls.
- [ ] Keep current contact rendering and status UI working against the new envelope.

**Acceptance:** Local anonymous browsing works through the Worker with fixture/fake
traffic. One hundred concurrent same-region test requests generate one upstream fetch.

**Commit:** `feat(traffic): add brokered regional ADS-B feed`

## Task 6 — Generate runway shards and implement deterministic mission assignment

**Files:**

- Replace: `scripts/fetch-ourairports.sh` with a deterministic airport+runway generator
  (or keep it as a thin wrapper around a checked-in generator)
- Add: `scripts/fixtures/ourairports/*`, generator tests, data validation script
- Add: `frontend/public/data/airports/<version>/manifest.json` and regional shards
- Add: `frontend/src/mission/types.ts`, `profiles.ts`, `geo.ts`,
  `assignment.ts`, `airportData.ts`
- Add: `frontend/src/mission/profiles/*.json`
- Modify: `frontend/src/data/airports.ts`, `takeover/eligibility.ts`
- Add assignment/property/data tests

**Steps:**

- [ ] Ingest OurAirports `airports.csv` and `runways.csv`; retain small airports for
      GA mission eligibility as well as medium/large airports, and retain ident, coordinates,
      elevation, runway ends/heading, length, width, surface, closure/lighted flags, and
      source date. Normalize surface categories explicitly.
- [ ] Produce deterministic immutable regional shards plus a manifest containing dataset
      version, checksums, bounds, record counts, source URLs/date, and shard map. The
      browser and Worker both load this exact version through static assets/`ASSETS`.
- [ ] Add versioned GA/airliner/fighter mission profiles containing reachability,
      runway surface/length/width/approach gates, landing thresholds, score curves, and
      profile version. Thresholds live in data, not class branches.
- [ ] Change `resolveClass` to return unsupported for unmatched/missing designators.
      Preserve physical eligibility checks and add explicit unsupported reasons.
- [ ] Implement deterministic reachability, a 30-minute cap, runway hard gates, stable
      ranking/tie-breaks, best assignment, and alternatives sorted by suitability/time.
- [ ] Property-test longitude wrap, near-pole distances, exact 30-minute and runway
      boundaries, no-runway airports, closed runways, stable ordering, and identical
      browser/Worker results.
- [ ] Keep lightweight airport labels working without loading every runway globally.
- [ ] Add a CI data-size/checksum gate and attribution.

**Acceptance:** A fixed snapshot/profile/dataset always returns the same assigned runway
and alternatives in browser and Worker tests. Unsupported aircraft never receive a
provisional mission.

**Commit:** `feat(missions): add versioned runway assignment engine`

## Task 7 — Implement magic-link identity, sessions, Turnstile, and preferences

**Files:**

- Add: `frontend/worker/auth/emailIdentity.ts`, `magicLinks.ts`, `sessions.ts`,
  `csrf.ts`, `turnstile.ts`, `email.ts`
- Add: `frontend/worker/http/routes/auth.ts`, `me.ts`
- Add: `frontend/src/auth/AuthReturn.tsx`, `SignInSheet.tsx`, `session.ts`
- Add: `frontend/src/profile/*`
- Modify: `frontend/wrangler.jsonc`, `frontend/src/App.tsx`
- Add unit, Worker integration, and browser-state tests

**Steps:**

- [ ] Implement `POST /api/auth/request`: strict email/body limits, Turnstile, IP and
      email-digest limits, enumeration-safe response, ban check, one-use token digest,
      and Email Service send.
- [ ] Put the raw token only after `#` in the return URL. The SPA removes the fragment
      immediately and POSTs the token; a GET/link preview cannot consume it.
- [ ] Atomically consume unexpired tokens, rotate/revoke old sessions as designed, and
      issue an opaque `Secure; HttpOnly; SameSite=Lax; Path=/` cookie.
- [ ] Add CSRF token issuance/rotation and require it for cookie-authenticated writes.
- [ ] Implement `GET/PATCH /api/me` for handle, exact saved center, derived region,
      default assists, tutorial/coaching state. Clamp center and rederive region server-side.
- [ ] Persist a provisional briefing reference in session storage before auth and restore
      it after consume; never trust it as authoritative.
- [ ] Test replay, expiry, concurrent consume, session revocation, banned identity,
      Turnstile failure, email failure, constant public response, and raw-email absence.

**Acceptance:** A test-address magic link signs in once, restores the selected briefing,
and stores no raw email. Existing sessions continue when outbound email is unavailable.

**Commit:** `feat(auth): add privacy-preserving magic-link sessions`

### Owner checkpoint A — foundation

Stop for owner review. Demonstrate local Worker, D1 migration, broker threshold tests,
regional caching/coalescing, runway assignment, magic-link fragment flow, and dependency
audit. Do not create paid production resources yet.

## Task 8 — Build the public browse page, quick-start notice, and mission tray

**Files:**

- Add: `frontend/src/briefing/QuickStartNotice.tsx`,
  `quickStartState.ts`, `MissionTray.tsx`, `RoutePreview.tsx`,
  `AlternativeAirports.tsx`, `briefingState.ts`
- Modify: `frontend/src/App.tsx`, `frontend/src/panels/ContactList.tsx`
- Modify: `frontend/src/globe/OverlayLayers.tsx`
- Modify: `frontend/src/takeover/useUrlTakeover.ts`, `urlTakeover.ts`
- Modify: `frontend/src/styles/index.css`, `tokens.css`
- Add component/pure-state tests and later E2E selectors

**Steps:**

- [ ] Add a prominent first-visit `HOW TO FLY` notice on the live-map main page with
      these five plain-language steps: choose a supported airborne plane; review its
      assigned route/runway; choose an eligible alternative if desired; press
      `TAKE CONTROLS` and sign in; follow guidance and land for a score.
- [ ] Make it dismissible without blocking map interaction. Persist a versioned dismissal
      locally, and keep an always-visible `HOW TO FLY` help control in browse mode to
      reopen it. Do not require sign-in to read it.
- [ ] Desktop: compact prominent overlay beside the contact/briefing area. Mobile:
      safe-area-aware bottom sheet above status/controls. Test 320 px width, landscape,
      keyboard focus order, reduced motion, and no collision with the mission tray.
- [ ] Give the notice a `SELECT A PLANE` action that opens/focuses the contact list or
      mobile drawer but never selects or fabricates a contact.
- [ ] Center anonymous first visits on the configured discovery center; restore an
      authenticated user's precise saved center. Add callsign/hex/type search plus
      class/altitude/eligibility filters without changing traffic truth.
- [ ] Change contact click from immediate takeover to provisional assignment and
      map-first `MissionTray`. Show real aircraft identity/freshness, reconstruction
      disclosure, class, runway, route, ETA, scoring target, assists, and alternatives.
- [ ] Keep route geometry primary on the map. Switching an alternative updates the
      provisional route only and remains limited to the returned eligible set.
- [ ] Make `TAKE CONTROLS` the auth gate. Signed-out users see the sign-in sheet;
      signed-in users proceed to preparation in Task 9.
- [ ] Change legacy `?takeover=<hex>` behavior to select/open the briefing, never bypass
      mission overview/auth/revalidation.
- [ ] Unit-test quick-start visibility/reopen/versioning and mission tray states:
      eligible, unsupported, stale, no runway, provider down, signed out, signed in.

**Acceptance:** A new visitor can understand the complete loop without guessing, dismiss
the notice, reopen it, select a real aircraft, inspect the route, and choose only a valid
alternative before any controls are taken.

**Commit:** `feat(browse): add quick-start guide and mission briefing`

## Task 9 — Add authoritative mission preparation, confirmation, and locking

**Files:**

- Add: `frontend/worker/missions/prepare.ts`, `lock.ts`, `authorization.ts`
- Add: `frontend/worker/http/routes/missions.ts`
- Add: `frontend/src/briefing/MissionReconfirmation.tsx`
- Modify: `frontend/src/briefing/briefingState.ts`, `MissionTray.tsx`
- Modify: D1 mission repository and broker lease protocol
- Add Worker and state-machine tests

**Steps:**

- [x] Implement `POST /api/missions/prepare`: authenticate, ban/mode/rate check, fetch a
      fresh selected contact through the broker, recompute assignment, and return a
      short-lived signed preparation containing the authoritative eligible set/versions.
- [x] Compare the authoritative fingerprint with the provisional briefing. If aircraft,
      route, runway, or eligibility changed, return `MISSION_RECONFIRM_REQUIRED` and
      require an explicit second confirmation in the tray.
- [x] Implement idempotent `POST /api/missions`: validate the preparation and chosen
      eligible alternative, acquire the user/global lease, then transactionally create
      one locked mission. Release the lease if D1 commit fails.
- [x] Freeze ADS-B start snapshot, reconstruction disclosure/adjustments, class/profile,
      airport/runway geometry, all data/scoring/assist versions, chosen assist, and times.
- [x] Return a bounded signed mission receipt for offline result queuing. Do not embed
      secrets or raw identity.
- [x] Test replay, expired preparation, stale aircraft, altered destination, duplicate
      idempotency key, D1 failure after lease, lease failure, read-only/kill mode, and ban.

**Acceptance:** Authentication delay can never silently launch the old route. Exactly one
mission and lease exist after retries; countdown starts only from a committed lock.

**Commit:** `feat(missions): revalidate and lock authoritative flights`

## Task 10 — Integrate locked missions, assists, ghost traffic, and the existing simulator

**Files:**

- Modify: `frontend/src/game/FlightSession.tsx`, `machine.ts`, `flightLoop.ts`
- Modify: `frontend/src/state/store.ts`, `frontend/src/takeover/spawn.ts`
- Add: `frontend/src/mission/assists.ts`, `assistState.ts`
- Add: `frontend/src/globe/MissionRouteLayer.tsx`, `ApproachAssistLayer.tsx`
- Modify: `frontend/src/globe/TrafficOverlay.tsx`, `ghost.ts`
- Modify HUD/control components and tests

**Steps:**

- [x] Preserve the flight state machine for `COUNTDOWN/FLYING/PAUSED/ENDED`; keep
      briefing/auth as a separate UI state so selecting contacts does not pretend a sim
      has started.
- [x] Feed `FlightSession` only the locked mission snapshot/profile, not the currently
      mutable selected contact. Reuse `buildSpawnState`, terrain preload, class loaders,
      fixed-step loop, Cesium host, keyboard/touch controls, and honest adjustments.
- [x] Add `FULL | NAV | OFF` with FULL default, a prominent preflight/in-flight toggle,
      and monotonic `highestAssistUsed`. Profile definitions drive overlays; no class
      branches.
- [x] Implement route/destination cue for FULL/NAV, assigned runway highlight for
      FULL/NAV, and corridor/glide gates/flare cue for FULL only. OFF leaves physical
      airport/runway and instruments.
- [x] Poll locked aircraft ghost and ambient traffic at the 12-second active cadence;
      renew lease. Freeze/fade on loss/stale, and never apply traffic to physics/collision.
- [x] Release lease on finalization, explicit quit, admin termination, ban, or expiry.
      Browser unload is best-effort only; expiry is the correctness mechanism.
- [x] Test GA/airliner/fighter starts, reconstructed fields, highest-assist escalation,
      overlay matrix, ghost staleness, network loss, and local simulation continuity.

**Acceptance:** All three classes fly the existing 60 Hz model from an authoritative
mission while Worker request cadence stays low and traffic never affects forces.

**Commit:** `feat(flight): fly locked missions with adaptive assists`

## Task 11 — Implement runway landing evidence, safety gates, and scoring

**Files:**

- Add: `frontend/src/mission/runwayGeometry.ts`, `landingEvidence.ts`,
  `landingSafety.ts`, `landingScore.ts`, `resultPackage.ts`
- Modify: `frontend/src/game/flightLoop.ts`, `classify.ts`, `FlightSession.tsx`
- Add: `frontend/worker/missions/results.ts`
- Modify: result repository and mission routes
- Add extensive node and Worker tests

**Steps:**

- [x] Add pure geodesic runway-frame projection and test centerline, thresholds,
      permitted direction, surface polygon, touchdown zone, rollout environment, and
      antimeridian cases.
- [x] Record a bounded landing window at a fixed low rate (target 10 Hz, maximum 512
      samples and 128 KB encoded request). Capture only fields required for verification.
- [x] Implement profile-driven hard gates: assigned surface/direction, gear, sink, bank,
      attitude, speed, structural load, and controlled rollout. Return a stable named
      failure, never a quality score after a failed gate.
- [x] Implement the approved successful score weights: vertical speed 25, centerline 20,
      touchdown zone 20, alignment 15, speed 10, bank 5, rollout 5.
- [x] Use the same pure scorer in browser preview and Worker recomputation. The Worker
      trusts the locked D1 mission/profile version, validates timing/plausibility/shape,
      and can mark incomplete/suspicious evidence unranked.
- [x] Make `POST /api/missions/:id/result` idempotent by mission ID and key. Save the
      summary even when optional R2 trace write fails; release the lease after durable
      finalization.
- [x] Boundary/property-test every class threshold and scoring curve, duplicate/replayed
      result, corrupt evidence, wrong runway/version/user, R2 failure, and score 0–100.

**Acceptance:** Worker and browser produce identical measurements for valid fixtures; a
failed hard gate has a precise reason and no score; one mission cannot rank twice.

**Commit:** `feat(scoring): verify and score assigned-runway landings`

## Task 12 — Add debrief, profiles, and cached partitioned leaderboards

**Files:**

- Add: `frontend/src/debrief/*`, `frontend/src/leaderboards/*`
- Add: `frontend/worker/http/routes/leaderboards.ts`
- Modify: `frontend/src/panels/EndCard.tsx`, `frontend/src/App.tsx`
- Modify: D1 result queries
- Add UI, query, cache, and authorization tests

**Steps:**

- [x] Replace the current simple EndCard with safety outcome, named failures, seven score
      components, total, rank eligibility, highest assist, class, versions, and retry state.
- [x] Add user history/class statistics without exposing email or precise home location.
- [x] Implement public leaderboard filters by class, highest assist, and scoring version;
      paginate with stable ordering and privacy-safe handle/user ID.
- [x] Cache each bounded filter set for 60 seconds and tell clients not to poll faster
      than 15 seconds. Invalid/unbounded filters never create cache keys.
- [x] Test ties, pagination, unranked exclusion, banned users, score versions, stale cache,
      and accessible mobile/desktop layouts.

**Acceptance:** A completed flight has a truthful debrief and appears only in the matching
class/assist/scoring partition when eligible.

**Commit:** `feat(results): add debrief and versioned leaderboards`

## Task 13 — Add tutorial, first-flight coaching, installability, and offline result sync

**Files:**

- Add: `frontend/src/tutorial/*`, versioned tutorial definitions
- Add: `frontend/src/offline/resultQueue.ts`, `sync.ts`
- Modify: `frontend/public/manifest.webmanifest`, add icons and `public/sw.js`
- Add: `frontend/src/pwa/*`
- Modify: `frontend/src/App.tsx`, profile preferences
- Add unit and E2E tests

**Steps:**

- [ ] Create deterministic unranked stable approaches for GA, airliner, and fighter at
      fixed airports. No ADS-B request occurs in tutorial mode.
- [ ] Add pause-at-teaching-moment lessons and optional first-live-flight coaching;
      persist completion/preferences.
- [ ] Finish the install manifest, icons, install instructions, landscape/fullscreen
      checklist, and update-safe service worker. Cache only versioned shell/assets and
      airport/tutorial data; never cache authenticated API responses or Access content.
- [ ] Store pending signed result packages in IndexedDB, enforce count/age/size bounds,
      and retry with the original idempotency key after recovery. Never accept while the
      user is banned or mission receipt is invalid/expired.
- [ ] In READ_ONLY/network loss, finish locally and explain queued state. In KILL_SWITCH,
      cached shell shows maintenance and does not imply live traffic.
- [ ] Test offline reload, update activation, queue deduplication/eviction, recovery sync,
      tutorial zero-feed calls, and coaching opt-out.

**Acceptance:** The PWA installs, tutorial works with all runtime services offline, and an
interrupted valid result syncs once without duplicate ranking.

**Commit:** `feat(pwa): add tutorials coaching and offline result queue`

### Owner checkpoint B — product vertical slice

Stop for a visual and functional review of the main-page notice, anonymous browse,
briefing/auth/reconfirmation, one mission from each class, assists, landing/debrief,
leaderboards, tutorial, and offline behavior. Use only fake/safe ADS-B staging data.

## Task 14 — Secure admin APIs and implement controls, audits, bans, and termination

**Files:**

- Add: `frontend/worker/admin/accessJwt.ts`, `authorize.ts`, `auditMutation.ts`,
  `mode.ts`, `users.ts`, `sessions.ts`, `flights.ts`, `cache.ts`
- Add: `frontend/worker/http/routes/admin.ts`
- Modify: broker protocol/state, D1 repositories, `wrangler.jsonc`
- Add Access/authz/mutation integration tests

**Steps:**

- [x] Configure the fail-closed Worker contract for Access-protected `/admin*` and
      `/api/admin/*` with exact email `dneilroberts@gmail.com`; Task 18 provisions the
      live staging/production applications, policies, team domain, and audience.
- [x] Validate `Cf-Access-Jwt-Assertion` on every admin shell/API request: allowed
      algorithm, signature against cached rotating JWKS by `kid`, issuer, audience,
      expiry/not-before, and exact admin email/application role. Reject cookie-only game
      sessions.
- [x] Serve the admin SPA shell through the Worker only after validation. Never cache
      Access responses publicly.
- [x] Require same-origin, admin CSRF, idempotency key, reason, and typed confirmation for
      bans, session/flight termination, and KILL_SWITCH.
- [x] Implement requested mode, registration disable, provider cache-only, one normalized
      region cache clear, session revoke, flight terminate, temporary/permanent ban,
      unban, and exact-email digest lookup.
- [x] A ban transaction revokes sessions; broker releases leases; future authorization
      and queued ranked results fail. Every mutation appends before/after/request/actor
      audit data and triggers an alert event.
- [x] Test invalid signature/kid/issuer/audience/time/email/role, CSRF, replay,
      insufficient confirmation, mode precedence, partial failure, and audit completeness.

**Acceptance:** Neither an ordinary signed-in user nor a forged Access header can view or
mutate admin data. All destructive actions are attributable, idempotent, reversible where
specified, and immediately enforced.

**Commit:** `feat(admin): secure operational controls and user enforcement`

## Task 15 — Build the detailed admin telemetry, sessions, users, and logs console

**Files:**

- Add: `frontend/src/admin/AdminApp.tsx`, `api.ts`, `Overview.tsx`,
  `TrafficCapacity.tsx`, `ActiveSessions.tsx`, `LogsErrors.tsx`, `Users.tsx`,
  `Controls.tsx`, shared admin components
- Add: `frontend/worker/admin/overview.ts`, `analytics.ts`, `events.ts`
- Modify: request telemetry, D1 last-seen flushing, broker presence snapshots
- Add UI and Worker tests

**Steps:**

- [x] Lazy-load admin code only on `/admin`; keep it out of the public app chunk.
- [x] Overview: effective/requested/automatic mode, component/binding health, exact API
      and provider budget bars, projected exhaustion, active flights, cache hit rate,
      latency/error summaries, monitoring-degraded flags, and authoritative-platform links.
- [x] Traffic & Capacity: route/status/reject trends, cache regions/age/viewers, provider
      calls/failures, D1/R2/email operations, cadence/reserve state, and bounded filters.
- [x] Active Sessions: user ID/handle, bounded last activity/device summary, coarse region,
      mission/aircraft/duration/assists, with revoke/end actions. Keep presence ephemeral
      in the broker and flush D1 last-seen no more often than configured.
- [x] Logs & Errors: scrubbed `system_events` warnings/errors/transitions with request ID,
      severity/type/time filters, bounded CSV/JSON export, and direct link to Workers Logs.
      Do not pretend this table is the entire Cloudflare log stream.
- [x] Users: search by user ID, handle, or exact entered email digest; show status,
      sessions/results/bans; ban/unban/revoke controls with required confirmations.
- [x] Controls: NORMAL/READ_ONLY/KILL_SWITCH, registration, cache-only, region clear,
      test alert, automatic-mode explanation, and visible reason when effective mode
      cannot be relaxed.
- [x] Implement only hard-coded Analytics Engine SQL templates behind a read-only account
      token; rate-limit and briefly cache results. UI accepts parameters, never SQL.
- [x] Label application counters/estimates separately from authoritative Cloudflare
      billing. Test empty, sampled, delayed, and unavailable analytics/log states.

**Acceptance:** The owner can diagnose capacity, sessions, provider/cache health, errors,
and user activity without exposing raw email/IP/tokens or granting the Worker Cloudflare
mutation privileges.

**Commit:** `feat(admin): add telemetry sessions users and logs console`

## Task 16 — Add transition-based email alerts and scheduled health checks

**Files:**

- Add: `frontend/worker/alerts/types.ts`, `transitions.ts`, `email.ts`,
  `healthCheck.ts`
- Modify: broker, request telemetry, admin actions, Worker scheduled handler
- Modify: `frontend/wrangler.jsonc`
- Add alert tests and operations runbook

**Steps:**

- [x] Route application alerts to `dneilroberts@gmail.com` using the onboarded aviation
      sending domain and a destination-restricted Email binding.
- [x] Add deduplicated transitions and recovery alerts for API/provider 70/90/100 percent,
      active flights 8/10 and 10/10, sustained 5xx/binding failure with minimum count+rate,
      provider outage/staleness/recovery, modes, bans, session/flight termination, and
      kill actions.
- [x] Store transition/cooldown state in the broker so isolate restarts do not duplicate
      storms. Include UTC time, environment, threshold, action, remaining capacity,
      request/audit ID, and admin link; include no PII or secrets.
- [x] Add a five-minute Cron health check that detects silent failure and recovery. A
      missed Cron is not itself proof of health.
- [x] Implement the admin test-alert action and distinguish TEST in subject/body/audit.
- [x] Document manual Cloudflare-native backup notifications to the same address:
      Workers errors, resource notifications, and billing alerts at $10/$25. State that
      these are delayed informational alerts, not a hard cap.
- [x] Test transition-only delivery, cooldown, UTC reset, send failure/retry, recovery,
      duplicate Cron/in-band observation, and exact recipient.

**Acceptance:** Fake-clock drills produce one email per transition and one recovery, with
no alert storm; a successful staging test reaches `dneilroberts@gmail.com`.

**Commit:** `feat(alerts): notify capacity health and admin transitions`

### Owner checkpoint C — operations

Stop for Access-policy review and live staging drills: read-only, kill switch and recovery,
ban/unban, session revoke, flight terminate, provider cache-only, alert test, telemetry
degradation, audit export, and rollback access. Confirm the alert email was received.

## Task 17 — Add full E2E, failure/load, security, and performance release gates

**Files:**

- Add: `frontend/playwright.config.ts`, `frontend/test/e2e/*`
- Add: `frontend/test/load/*`, fake provider Worker
- Add: CI workflow/scripts and bundle/PII scanners
- Modify: `frontend/package.json`
- Add: `docs/runbooks/staging-acceptance.md`, `incident-response.md`

**Steps:**

- [ ] Add Playwright journeys for anonymous browse/cache; quick-start notice/reopen;
      saved center; briefing/alternative; magic-link route change/reconfirm; all three
      classes; assists/leaderboard; tutorial/coaching; offline queue/recovery; read-only;
      kill switch; admin telemetry; ban/unban; termination; audit; and test alert.
- [ ] Use a fake ADS-B source only for automated load/failure tests. Verify same-region
      coalescing, distinct-region global gating, timeout/429/malformed/outage/recovery,
      daily thresholds/reserve, and 1-user/10-global leases.
- [ ] Inject D1, Durable Object storage, R2, Email, analytics, and asset/terrain failures
      and assert the exact design section 8 behavior.
- [ ] Add security tests for route-boundary bypass, CORS/CSRF, body bombs, cache-key
      explosion, header/token log redaction, auth enumeration, JWT confusion, admin
      replay, and result tampering.
- [ ] Split Cesium, app, and lazy admin chunks. Enforce total initial JS gzip <= 1.5 MB,
      non-Cesium initial app JS gzip <= 250 KB, no admin chunk on public load, and no
      unversioned airport megabundle. Change budgets only with measured owner approval.
- [ ] Add CI gates: clean install, lint, unit, Worker integration, local D1 migrations,
      typecheck, production build, bundle limit, PII/secret scan, E2E, and fake-provider
      load/failure suite.
- [ ] Run `npm audit`, classify residual findings, and upgrade deliberately. No forced
      semver-major audit rewrite without rerunning all gates.

**Acceptance:** One command runs the full local readiness suite; CI blocks a public deploy
on any correctness, privacy, mode, alert, migration, or bundle regression.

**Commit:** `test: add Cloudflare public-release readiness gates`

## Task 18 — Provision staging, validate production, cut over, and retire Python

**Files:**

- Finalize: `frontend/wrangler.jsonc`, environment docs, secret inventory
- Add: `docs/runbooks/deploy.md`, `rollback.md`, `provider-capacity.md`
- Remove only after parity/cutover approval: `backend/`, `frontend/nginx.conf`,
  `frontend/Dockerfile`, legacy Docker/dev proxy wiring
- Modify: root development scripts/docs/env examples

**Steps:**

- [ ] Provision isolated staging/production D1, Durable Object namespaces, optional R2
      buckets/lifecycle, Analytics Engine datasets, Email/rate-limit bindings, secrets,
      custom domain, Access applications/policies, and least-privilege deploy token.
- [ ] Keep staging on fake or explicitly safe provider credentials. Never copy production
      user data, identities, ADS-B credentials, or analytics token into staging.
- [ ] Apply forward migrations, deploy staging, run all acceptance/failure/admin drills,
      receive the test alert, and verify rollback against the migrated schema.
- [ ] Run a five-concurrent-flight private beta for GA/airliner/fighter. Verify exact
      broker counters, cache reuse, error rate, bundle/runtime performance, and provider
      allowance.
- [ ] Enable anonymous production browse first. Keep mission starts disabled until
      production mode/counters/alerts and purchased upstream allowance are confirmed.
- [ ] Enable mission starts explicitly, then monitor the first operating window from the
      admin console and native Cloudflare dashboards.
- [ ] Only after TypeScript fixture parity and successful cutover, remove FastAPI,
      nginx/Docker split, Vite proxy, Python requirements/tests, and obsolete env vars.
      Preserve useful source fixtures in `frontend/test/fixtures/adsb/`.
- [ ] Tag the release and record resource IDs, Access audience, migration version,
      dataset/profile/scoring versions, Worker deployment version, alert proof, and
      rollback command in the runbook—not in public logs or screenshots.

**Acceptance:** `fly.voygent.app` serves the public site from isolated Cloudflare
resources; anonymous browse and explicitly enabled missions work; admin recovery remains
available in kill mode; Python is no longer a runtime or CI dependency.

**Commit:** `ops: cut over Cloudflare-native public ADS-B game`

### Owner checkpoint D — public enablement

Production mission starts require explicit owner confirmation after:

- the provider allowance supports the configured 8/12/15-second behavior;
- Access only admits `dneilroberts@gmail.com`;
- 70/90/100 percent plus 8-of-10 and 10-of-10 capacity drills have passed;
- a staging and production test alert arrived;
- read-only, kill, rollback, ban, and recovery paths were exercised;
- all release gates are green and the rollback is schema-compatible.

## 6. Final readiness commands

The exact script names are established in Tasks 1 and 17. The final release path must be
equivalent to:

```bash
cd frontend
npm ci
npm run lint
npm run test:unit
npm run test:worker
npm run typecheck
npm run build
npm run check:bundle
npm run test:e2e
npm run test:load
npm run check:pii
npm audit
npx wrangler d1 migrations list ADSB_GAME_DB --env staging
npx wrangler deploy --env staging --dry-run
```

Never run the load suite against a public ADS-B provider or the production domain.

## 7. Plan self-check

Before calling implementation complete, trace every row in the requirement map to:

1. a checked task step;
2. at least one automated test;
3. a staging acceptance result;
4. an operational owner/sign-off item where external Cloudflare state is involved.

The plan deliberately does not promise a Cloudflare hard dollar cap, cheat-proof
leaderboards, permanent traffic history, server-side physics, live weather effects, or
global map/terrain hosting.
