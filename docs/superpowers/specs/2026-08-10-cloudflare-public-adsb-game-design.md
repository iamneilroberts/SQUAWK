# Cloudflare-native public ADS-B flight game — design spec

**Date:** 2026-08-10 · **Status:** approved by owner, section by section ·
**Target:** `fly.voygent.app` · **Repository:** `adsb-game`

This specification defines the target public product and supersedes the deployment and
product boundaries in `2026-07-27-adsb-game-design.md`. The existing ADS-B game and LORAN
implementations are migration sources, not compatibility constraints. Existing flight
physics and proven UI/data components may be reused when they fit this design, but the new
application is a purpose-built public ADS-B site with the game tightly integrated.

## 1. Product definition

The product is one installable React/Cesium application with a continuous journey:

```text
anonymous live browse
    -> select a supported real aircraft
    -> inspect the assigned route and landing mission
    -> optionally choose another eligible destination
    -> sign in when TAKE CONTROLS is pressed
    -> revalidate and lock the mission
    -> fly client-side
    -> land, debrief, and optionally submit a ranked result
```

### 1.1 Approved product decisions

| Area | Decision |
|---|---|
| Public access | Browse anonymously; authentication begins at `TAKE CONTROLS` |
| User location | Save a changeable home center in the user profile |
| Cache behavior | The exact preference maps to a shared normalized geographic region; exact coordinates never create unbounded cache keys |
| Briefing UI | Map-first mission tray, responsive as a bottom sheet on phones |
| Mission visibility | Selecting an aircraft shows destination, assigned runway, route, ETA, class, assists, scoring target, and alternatives before takeover |
| Destination | Suggest the best suitable airport within 30 minutes; allow the player to choose among other eligible airports |
| Aircraft classes | GA, airliner, and fighter at public launch, with class-specific flight, runway, scoring, and leaderboard rules |
| Tutorial | Controlled unranked class-specific training, followed by optional coaching on the first live mission |
| Landing judgment | Hard safety gates, then a 0–100 quality score for successful landings |
| Guidance | `FULL` by default, with a prominent `FULL / NAV / OFF` toggle before and during flight |
| Public site scope | Purpose-built public ADS-B experience; preservation of the legacy LORAN and game applications is not a requirement |
| Infrastructure | Application infrastructure on Cloudflare; live ADS-B, basemap imagery, and terrain remain external data sources |
| Cost posture | Balanced guardrails with a 100,000 admitted-dynamic-request daily ceiling and graceful degradation |

### 1.2 Normal mission journey

1. The PWA opens at the saved home center for a returning user, or at a default discovery
   center for an anonymous visitor.
2. The visitor pans, searches, filters, and selects live traffic without registering.
3. A supported airborne aircraft opens the mission tray immediately. The browser uses the
   current traffic snapshot and versioned airport data to preview a destination, runway,
   route, estimated flight time, class, assist level, and scoring target.
4. The player may choose another airport only from the class-, runway-, and 30-minute-
   eligible alternatives.
5. `TAKE CONTROLS` starts magic-link authentication. The link returns to the same briefing.
6. Authentication delay may make the preview stale, so the Worker obtains fresh aircraft
   state and recomputes the mission. If the route changed, the new briefing must be shown
   and confirmed rather than silently substituted.
7. Starting freezes the authoritative aircraft snapshot, destination, runway, assists,
   aircraft-profile version, and scoring version in one mission record.
8. The browser runs the physics. ADS-B refreshes only the real-aircraft ghost and ambient
   traffic; neither can affect player physics.
9. The landing passes or fails class-specific safety gates. A successful landing receives
   a 0–100 score and can be submitted to the matching class/assist leaderboard.

### 1.3 Installation and degraded access

The site is an installable PWA. The post-registration email and an in-app checklist explain
installation, Add to Home Screen, landscape play, and fullscreen controls.

An active simulation must continue locally when the network fails or the platform enters
`READ_ONLY` or `KILL_SWITCH`. A pending signed result package is queued locally and may be
submitted idempotently after normal service returns. Ghost and ambient traffic visibly
freeze or fade; they never become synthetic.

## 2. Cloudflare architecture

### 2.1 Deployment unit

One TypeScript Worker and one React/Cesium static-asset deployment serve
`fly.voygent.app`.

```text
Browser
  |-- static PWA / Cesium / airport shards / tutorials -> Workers Static Assets
  `-- /api/* -> TypeScript Worker
                    |-- D1: durable product records
                    |-- ADS-B Broker Durable Object: exact global operational state
                    |-- R2: optional bounded traces
                    |-- Email Service: magic links and alerts
                    |-- Turnstile: abuse challenges
                    |-- Analytics Engine: scrubbed request telemetry
                    `-- external ADS-B provider

Browser -> external basemap and terrain providers directly
Admin -> Cloudflare Access -> /admin and /api/admin/*
```

Static assets use assets-first routing so an asset hit does not invoke Worker application
logic. Only dynamic paths enter the application admission and cost-control pipeline.

### 2.2 Resource isolation

The aviation application shares the Cloudflare account and `voygent.app` DNS zone with the
Voygent travel product, but it has separate:

- Worker name, custom domain, and deployment configuration;
- D1 databases for production and staging;
- Durable Object namespaces for production and staging;
- R2 buckets and lifecycle policies;
- Analytics Engine datasets;
- secrets, migrations, logs, and operational controls;
- least-privilege deployment token with no permission to modify the travel Worker.

There is no runtime service binding or database sharing with the travel application.
Account billing, account administrators, and zone-wide DNS/WAF configuration remain shared
failure domains and must not be described as isolated.

### 2.3 External runtime dependencies

- The ADS-B provider is called only by the broker. Provider credentials are never sent to
  the browser.
- Basemap and terrain traffic goes directly from the browser to the selected providers,
  using hostname-restricted public credentials when credentials are required. It is not
  proxied through a metered Worker merely to hide a public browser key.
- Airport/runway source data is converted during the build into immutable regional shards.
  The browser and Worker use the same dataset version.

### 2.4 Cloudflare-native supporting services

- **D1:** identity digests, sessions, user preferences, locked missions, results, bans,
  bounded operational events, and admin audit records.
- **Durable Object:** regional traffic cache, request coalescing, provider-call gate,
  admitted-request counters, active-flight leases, automatic mode, admin mode, and alert
  transition state.
- **R2:** optional compressed trace/replay packages only. A normal result never depends on
  R2.
- **Email Service:** magic links and operational alerts. The aviation sending domain must
  be onboarded before public authentication; after onboarding, it can send to arbitrary
  recipients.
- **Turnstile:** magic-link requests and suspicious public mutations.
- **Cloudflare Access:** outer authentication gate for `/admin*` and `/api/admin/*`.
- **Analytics Engine:** scrubbed, application-specific request telemetry.
- **Workers Logs:** authoritative invocation logs, uncaught exceptions, and deep debugging.

## 3. State and data ownership

### 3.1 Browser-only state

The browser owns high-frequency and short-lived state:

- current traffic view and selection;
- provisional mission preview;
- fixed-step simulation state;
- HUD/input state;
- short landing-evidence buffer;
- queued idempotent result packages awaiting connectivity.

React/Zustand must not receive 60 Hz physics writes. The simulation remains a pure
TypeScript module using mutable/ref state; rendering consumes a lower-rate snapshot.

### 3.2 Versioned static data

The build produces versioned definitions for:

- regional airport/runway shards;
- aircraft type-to-class mappings;
- class performance and runway-suitability profiles;
- class landing thresholds and scoring targets;
- tutorial scenarios;
- assist-overlay definitions.

Every locked mission records all applicable versions. A deployment may change future
missions but must not reinterpret a completed result under a newer scoring profile.

### 3.3 D1 logical model

The initial schema consists of these logical tables; exact column names may be refined in
the implementation plan without changing their responsibilities.

| Table | Purpose |
|---|---|
| `users` | Stable user ID, keyed normalized-email digest, handle, status, timestamps |
| `user_preferences` | Exact chosen center, derived region key, default assists, tutorial/coaching state |
| `magic_links` | One-use token digest, email digest, expiration, consumed timestamp, request metadata |
| `sessions` | Hashed opaque session ID, user ID, expiration, revocation, bounded last-seen/device summary |
| `missions` | User, aircraft identity/class, frozen ADS-B start snapshot, airport/runway, versions, assists, status, timestamps |
| `flight_results` | Unique mission ID, safety outcome, recomputed measurements, score, highest assist used, evidence status |
| `user_bans` | User/email digest, temporary or permanent scope, reason, actor, expiration and revocation |
| `system_events` | Bounded warning/error/transition events with request IDs and scrubbed context |
| `admin_audit` | Append-only admin action, actor, target, old/new state, reason, timestamp, request ID |

There is no per-frame telemetry table and no retained ADS-B history by default.

### 3.4 Identity minimization

The authentication flow normalizes the submitted email and computes
`email_key = HMAC(server_secret, normalized_email)`. D1 stores `email_key`, not the raw
email. The submitted address exists only long enough to send the current magic link.

Magic-link tokens and session IDs are cryptographically random and only their digests are
stored. The session cookie is opaque, `Secure`, `HttpOnly`, `SameSite=Lax`, expiring, and
revocable. The admin can locate a user by entering an exact email; the server computes the
same digest. Active-session screens show user ID/handle, not raw email.

### 3.5 Broker state

The single broker owns exact global operational state:

- normalized region -> latest traffic body, source time, fetch time, and stale deadline;
- in-flight regional fetch promise for request coalescing;
- next provider-call time and configured daily provider allowance;
- current UTC admitted-request count and protected reserve;
- current active-flight leases keyed by user and mission;
- automatic mode, administrator-requested mode, and last alert transition;
- compact rolling health counters used by the admin overview.

Operational counters that must survive eviction are persisted in Durable Object storage.
Large traffic bodies may be compressed and bounded; expired regions are evicted rather
than accumulated indefinitely.

### 3.6 Telemetry and retention

- Analytics Engine receives one scrubbed datapoint per admitted dynamic request: route
  family, status class, operating mode, cache outcome, provider outcome, latency, and a
  non-PII sampling key.
- At the 100,000-request daily cap this produces at most 3.1 million datapoints in a
  31-day month, below the current Workers Paid inclusion of 10 million per month. This is
  a planning check, not a permanent pricing guarantee; pricing remains monitored like any
  other platform dependency.
- The admin Worker executes only hard-coded Analytics Engine query templates using a
  read-only `Account Analytics Read` token stored as a Worker secret. Queries are
  rate-limited and their results cached briefly. The UI never accepts raw SQL. This token
  cannot mutate Cloudflare resources, but its account-wide analytics visibility is a
  documented residual risk of sharing the account.
- Exact capacity bars and automatic alert/mode transitions use broker counters, never
  sampled analytics. Analytics Engine supplies historical breakdowns and latency/error
  trends; the UI accounts for its documented sampling behavior.
- `system_events` stores only warnings, errors, provider/binding failures, and mode/alert
  transitions. It is bounded and lifecycle-deleted.
- `admin_audit` is append-only and retained longer than operational events.
- Logs and metrics must not contain raw email, magic/session tokens, full client IP,
  unredacted headers, or complete ADS-B payloads.

## 4. Authentication and API contracts

### 4.1 Route families

| Family | Representative endpoints |
|---|---|
| Public reads | `GET /api/status`, `/api/traffic`, `/api/airports/:region`, `/api/leaderboards` |
| Identity | `POST /api/auth/request`, `/api/auth/consume`, `/api/auth/logout`; `GET/PATCH /api/me` |
| Mission lifecycle | `POST /api/missions`, `GET /api/missions/:id`, `GET /api/missions/:id/traffic`, `POST /api/missions/:id/result` |
| Administration | `GET /api/admin/*`, `POST /api/admin/mode`, user ban/unban, session revoke, flight terminate, alert test |

The implementation plan may group endpoints differently, but it must preserve the public,
authenticated, and Access-protected trust boundaries.

### 4.2 Shared response contract

Every response includes:

- a unique request/correlation ID;
- server time;
- effective operating mode;
- a stable typed success or error code.

Traffic responses additionally include source time, cache age, freshness state, and
provider availability. Rate and capacity errors return `Retry-After`. User-visible copy is
derived from stable error codes, not parsed exception strings.

All state-changing operations are schema- and size-validated and accept an idempotency key.
A mission can have only one final result. Retrying a magic-link consumption, mission start,
or result submission must not create duplicate state.

### 4.3 Magic-link flow

1. Validate request shape, rate limits, and Turnstile.
2. Normalize the email and compute the keyed digest.
3. Return the same public response whether the account exists or is banned.
4. Create a short-lived one-use token digest and send the raw token in the URL fragment so
   it is not placed in normal server request logs or a Referer header.
5. The loaded SPA posts the fragment token to the consume endpoint; consumption atomically
   marks it used and issues a new opaque session cookie. A link-preview GET cannot consume
   the token.
6. Return to the preserved provisional briefing, then require mission revalidation.

The normal user session does not authorize admin APIs.

### 4.4 Request security

- Same-origin CORS; no wildcard credentialed CORS.
- CSRF token on cookie-authenticated state changes.
- Strict schemas, body limits, coordinate/radius clamps, and enumerated route parameters.
- No caller-controlled upstream URLs or headers.
- Secrets exist only as Cloudflare bindings/secrets.
- A restrictive CSP and normal browser security headers apply to the PWA.
- Ranked mission eligibility, runway assignment, result measurements, and score are
  recomputed server-side from the submitted evidence and locked mission.

## 5. ADS-B broker, caching, and spend containment

### 5.1 Progressive admission gates

Every dynamic request passes:

1. a coarse zone WAF IP flood rule on `/api/*`;
2. Turnstile where the action requires it;
3. a Worker endpoint limiter keyed by IP when anonymous and user when authenticated;
4. the broker's exact global admission and operating-mode check;
5. only then, any D1, R2, email, or upstream operation.

Worker rate limiting occurs after Worker invocation, so it protects downstream operations
and CPU amplification but is not a hard cap on the base Worker request charge. Cloudflare
budget alerts are a delayed notification, not a service cutoff; application gates remain
the spend-control authority.

### 5.2 Regional cache normalization

The user preference stores the chosen center precisely enough to restore the map. A
traffic request never uses that coordinate directly as a cache key. The Worker:

1. validates and clamps the requested display radius;
2. snaps the center to a configured shared cell;
3. expands the provider radius enough to cover the cell edge;
4. requests or reuses the normalized region;
5. filters the response to the viewer's requested area.

Cell resolution and padding are configuration values validated against the provider's
maximum radius and response size. This preserves user choice while allowing nearby users
to reuse one provider response.

### 5.3 Balanced defaults

| Operation | Limit/cadence | Behavior |
|---|---|---|
| Anonymous traffic | one refresh per 15 seconds | shared cache; cannot force an early provider fetch |
| Signed-in browse | one refresh per 8 seconds | fastest normal regional cache cadence |
| Active-flight ghost + traffic | one refresh per 12 seconds | also renews the active-flight lease |
| Flight concurrency | one per account, ten globally | exact expiring broker leases |
| Magic links | three per normalized email per hour, plus IP limit | Turnstile; enumeration-safe response |
| Mission starts | ten per account per hour | fresh revalidation required |
| Result submissions | ten per account per hour | idempotent by mission ID |
| Leaderboards | client no faster than 15 seconds | public result cached for 60 seconds per filter set |

All limits are configuration with these approved defaults. Security-sensitive maxima may
be lowered without a product redesign.

### 5.4 Daily admitted-request modes

The default daily ceiling is 100,000 admitted dynamic API requests per UTC day.

| Consumption | Automatic behavior |
|---|---|
| 0–69% | `NORMAL`; approved cadences |
| 70–89% | conservation cadence: anonymous 30 seconds, signed browse 15 seconds; active flights unchanged |
| 90–99% | `READ_ONLY`; no new public writes or missions; cached browsing and protected active-flight refresh reserve |
| 100% | `KILL_SWITCH`; public dynamic APIs fail closed; active simulation and queued result remain client-side |

`effective_mode` is the most restrictive of:

1. deployment-level `FORCE_MODE` override;
2. administrator-requested mode;
3. automatic budget/health mode.

The admin cannot select a less restrictive effective mode while an automatic threshold or
deployment override still requires the stricter one. A deployment-level override permits
emergency shutdown when the broker/admin UI is unhealthy.

### 5.5 Provider allowance and priority

Cloudflare usage and provider usage are separate budgets. `UPSTREAM_MIN_INTERVAL` and
`UPSTREAM_DAILY_LIMIT` must reflect the purchased/provider allowance; the Cloudflare
100,000-request ceiling must not be mistaken for permission to exceed it.

Provider capacity is allocated in this order:

1. the selected real-aircraft ghost for active flights;
2. shared regions with multiple signed-in viewers;
3. shared anonymous regions;
4. ambient in-flight traffic, which is the first feature shed.

Five users in five distinct regions still require five provider fetches per refresh cycle.
Caching cannot eliminate that worst case. Provider-plan readiness is a release gate.

### 5.6 Stale-data contract

Every traffic response declares source time and cache age. When a provider request fails:

- serve the bounded last-known response with an explicit `STALE` state;
- slow retries and coalesce them;
- fade/freeze the in-flight ghost and ambient traffic;
- remove contacts after the configured maximum stale age;
- refuse new ranked missions without a fresh source snapshot.

No stale or reconstructed contact may be presented as live.

## 6. Mission engine and flight simulation

### 6.1 Eligibility and reconstruction

Supported ICAO type/category data maps a contact to GA, airliner, or fighter. Unknown or
insufficiently classified types remain browsable but cannot be taken over.

The starting model uses measured ADS-B fields where available: position, geometric or
barometric altitude, track, groundspeed, and vertical rate. ADS-B does not provide a
complete flight-dynamics state. Pitch, bank, body rates, control positions, engine state,
and some air-data values begin from safe class defaults. The briefing and HUD must disclose
that these values were reconstructed rather than measured.

### 6.2 Destination and runway assignment

The browser may calculate a provisional assignment for immediate display. The Worker is
authoritative at mission start.

For the classified aircraft, the assignment engine:

1. calculates a class performance/reachability envelope from the fresh start state;
2. finds airports reachable within 30 minutes;
3. applies hard class runway-surface, length, width, and approach gates;
4. selects the best suitable airport/runway by deterministic versioned ranking;
5. returns the remaining eligible airports in suitability/time order.

Exact launch thresholds belong in versioned class profiles and require playtesting; they
must not be scattered as code constants. The player can change the destination only before
mission lock and only to an eligible alternative.

### 6.3 Physics boundary

- Pure TypeScript, fixed-step 60 Hz physics, decoupled from Cesium rendering.
- SI units internally; aviation units at UI/data boundaries.
- One data-driven 6-DOF path with class profiles rather than class-specific code branches.
- Inputs normalize keyboard, pointer, touch/tilt, or gamepad into one control vector when
  those adapters are available.
- The locked real aircraft becomes a separately updating ghost. Ambient traffic is
  non-solid scenery. Neither supplies forces, collision, or mission truth.

The proven existing simulation modules may be reused, but their FastAPI assumptions and
legacy session arc are not preserved when they conflict with this mission model.

### 6.4 Assist levels

| Level | Guidance |
|---|---|
| `FULL` | destination/navigation cue, route, approach corridor, runway outline, glide-path gates, and flare cue |
| `NAV` | bearing, distance, route, and assigned-runway highlight; no glide-path gates or flare cue |
| `OFF` | aircraft instruments and physical airport/runway only; no game guidance overlays |

`FULL` is the default and the toggle remains prominent before and during flight. A ranked
result records the highest assistance used at any time during that flight.

### 6.5 Landing success and score

A landing must first pass every class-specific hard safety gate:

- touchdown on the assigned runway surface in the permitted direction;
- landing gear configured when the profile requires it;
- class limits for sink rate, bank, attitude, speed, and structural load;
- controlled rollout within the permitted runway environment.

A failed safety gate produces a named failure, not a misleading quality score. A successful
landing receives:

| Component | Points |
|---|---:|
| Vertical speed | 25 |
| Centerline error | 20 |
| Touchdown zone | 20 |
| Heading alignment | 15 |
| Speed control | 10 |
| Bank at touchdown | 5 |
| Rollout control | 5 |
| **Total** | **100** |

Thresholds and target curves are versioned by class. Leaderboards partition by class,
highest assist used, and scoring version.

### 6.6 Result integrity

Client-side physics cannot produce a cheat-proof public leaderboard. At launch:

- the mission start is server-locked and signed;
- the browser retains a bounded landing evidence window and summary measurements;
- the Worker verifies identity, mission timing, runway geometry, and plausible evidence;
- the Worker recomputes the safety outcome and 0–100 score;
- suspicious or incomplete submissions can be retained as unranked.

This is abuse-resistant, not server-authoritative simulation. The UI and documentation must
not claim otherwise. Stronger anti-cheat is deferred until actual abuse justifies the
latency and cost.

### 6.7 Tutorial

Tutorials use fixed airports, class-specific stable starting approaches, deterministic
conditions, and no live ADS-B calls. Teaching moments may pause the simulation. Completion
is unranked. After the controlled lesson, the user may enable coaching on the first live
mission.

## 7. Administration, telemetry, and alerts

### 7.1 Admin security

Cloudflare Access protects `/admin*` and `/api/admin/*` with an exact-email allow policy
for `dneilroberts@gmail.com`. On every request the Worker also validates the Access JWT
issuer, audience, expiration, and application admin role. An ordinary game session alone
can never authorize admin access.

Admin state changes require:

- same-origin `POST`;
- CSRF token;
- idempotency key;
- mandatory reason;
- typed confirmation for bans, session/flight termination, and `KILL_SWITCH`.

Every mutation creates an append-only audit event and sends an alert confirmation.

### 7.2 Admin pages

| Page | Required information/actions |
|---|---|
| Overview | effective/requested/automatic mode, component health, API and provider budgets, projected exhaustion, cache hit rate, latency/error summaries |
| Traffic & capacity | requests by route/status, rejects, cache regions/age/viewers, provider calls/failures, D1/R2/email operations |
| Active sessions | user ID/handle, bounded last activity/device summary, coarse region, current aircraft/mission, duration, assists; revoke session/end flight |
| Logs & errors | scrubbed warnings/exceptions, request ID, binding/provider failure, mode/alert transition, filter/export, link to Workers Logs |
| Users | search by user ID/handle or exact server-side email digest; temporary/permanent ban, reason, expiration, unban, revoke sessions |
| Controls | `NORMAL`/`READ_ONLY`/`KILL_SWITCH`, registration disable, provider cache-only, one-region cache clear, test alert |

Active-session last-seen persistence must be write-bounded. Normal traffic refreshes may
update ephemeral broker presence, while D1 last-seen is flushed no more frequently than a
configured interval.

### 7.3 Operating-mode semantics

- **`NORMAL`:** all admitted public reads, authentication, missions, results, and admin
  operations.
- **`READ_ONLY`:** public GETs and cached traffic continue; block new magic-link issuance,
  profile writes, mission starts, and result writes. Active flights finish and queue results.
- **`KILL_SWITCH`:** public dynamic APIs fail closed and the client shows maintenance.
  Access-protected status and recovery controls remain available.

Static assets are intentionally assets-first and may already be cached in a browser, so the
application kill switch cannot erase the shell. It disables live/public behavior. A total
site denial, if ever needed, is an out-of-band zone WAF/Access/DNS operation.

### 7.4 User bans and session termination

A ban may be temporary or permanent and requires a reason. Ban lookup occurs during magic-
link issuance and every authenticated authorization check. Applying a ban:

- revokes all sessions;
- releases active-flight leases;
- prevents new authentication and authenticated API use;
- prevents queued ranked results from being accepted while the ban is active;
- records and alerts the action.

The player may continue a client-only simulation that is already loaded, but it cannot
save or rank the result.

### 7.5 Alerts

Application alerts go to **`dneilroberts@gmail.com`**.

| Condition | Alert behavior |
|---|---|
| Daily API budget crosses 70%, 90%, or 100% | transition email with automatic cadence/mode action |
| ADS-B allowance crosses 70%, 90%, or 100% | remaining calls and shed traffic tier |
| Active flights reach 8/10 or 10/10 | capacity warning/capacity-full alert |
| Sustained 5xx or binding failures | require both minimum count and rate threshold to reduce low-traffic noise |
| Provider repeatedly fails or becomes stale | outage alert, then recovery alert when fresh data returns |
| Mode, ban, session termination, or kill action | immediate confirmation plus audit ID |

Alerts are transition-based and deduplicated with a cooldown. A five-minute scheduled
health check catches silent failures and sends recovery notices. The console includes a
test-alert action.

Cloudflare-native budget and Worker/error notifications must also target the same address
as an out-of-band backup. Recommended account budget alerts are $10 and $25, acknowledging
that Cloudflare billing alerts are informational and processed after usage rather than a
real-time stop.

### 7.6 Telemetry truthfulness

The admin console shows application counters and Analytics Engine telemetry, not an
authoritative real-time Cloudflare invoice. It must label estimated/request-budget values
separately from Cloudflare account billing and link to the native billing/observability
pages for authoritative platform data.

## 8. Failure behavior

| Failure | User behavior | Safety/correctness rule |
|---|---|---|
| ADS-B timeout/429 | timestamped stale cache, then expired targets disappear; tutorial works | no new ranked mission without fresh aircraft state |
| D1 unavailable | cached anonymous browse may continue; identity, mission locks, results, admin writes stop | never claim a write succeeded; retain idempotent local package |
| Broker unavailable | static application loads in maintenance state | dynamic work fails closed because exact limits cannot be enforced |
| Email unavailable | enumeration-safe retry message; existing sessions continue | do not expose account existence |
| R2 unavailable | summary result saves; trace/replay omitted | R2 never blocks mission completion |
| Basemap/terrain unavailable | use ellipsoid/base fallback and local airport/runway overlays where safe | disable ranked landing when runway placement cannot be verified visually |
| Network lost in flight | local simulation continues; signed result queues | ghost/ambient traffic freeze/fade and never drive physics |
| Analytics/logging unavailable | gameplay continues; surface monitoring degradation to admin/alerts when possible | telemetry failure never mutates mission truth |

## 9. Verification strategy

### 9.1 Unit and property tests

- fixed-step physics invariants and each class performance envelope;
- type classification and unsupported-aircraft behavior;
- center-to-region quantization, cell-edge coverage, and radius clamps;
- airport eligibility, 30-minute reachability, deterministic ranking, and alternatives;
- every class landing safety boundary and scoring component;
- assist escalation records the highest level used;
- magic-link expiry/replay, session rotation/revocation, email HMAC lookup;
- daily counters, protected reserve, mode precedence, and UTC rollover;
- alert transition/deduplication/recovery;
- ban and admin authorization decisions.

### 9.2 Cloudflare integration tests

- Worker + D1 migrations and transactions;
- Durable Object counters, storage recovery, coalescing, and leases;
- R2 optional-write failure;
- Email Service stub and production test-address flow;
- Turnstile test keys and required server verification;
- Analytics Engine datapoint shape and fixed query templates;
- Cloudflare Access JWT validation with invalid issuer/audience/expiration cases.

### 9.3 End-to-end journeys

- anonymous browse and cached refresh;
- saved center restore and region sharing;
- aircraft selection -> map-first briefing -> alternative destination;
- magic-link return and changed-route reconfirmation;
- GA, airliner, and fighter mission/landing paths;
- tutorial and first-live-flight coaching;
- assist toggling and leaderboard partition;
- read-only mode, kill switch, queued result, and later idempotent sync;
- admin telemetry, session termination, ban/unban, audit, and test alert.

### 9.4 Failure and load tests

Use a fake ADS-B source for concurrency/load tests. Never load-test the public provider.
Verify:

- many callers for one region produce one provider fetch;
- users in distinct regions obey the global provider gate;
- provider 429, timeout, malformed data, and outage paths;
- D1, Durable Object storage, R2, Email, analytics, and terrain failures;
- 70/90/100% daily transitions and protected active-flight reserve;
- one-flight-per-account and ten-flight global leases;
- alert delivery and recovery.

## 10. Environments and release

Development, staging, and production use separate Cloudflare data resources and secrets.
Production source data and credentials are never copied into staging. Staging uses a fake
or explicitly safe provider configuration for automated tests.

Release sequence:

1. deploy infrastructure, authentication, admin protection, and cost controls to staging;
2. verify static/public browsing with synthetic traffic;
3. run private GA/airliner/fighter missions and alert/admin failure drills;
4. admit a five-concurrent-flight beta;
5. enable public anonymous browsing;
6. enable public mission starts only after upstream allowance and automatic modes are
   confirmed in production telemetry.

Every production deployment requires:

- typecheck, lint, unit, integration, and E2E success;
- production build and bundle-limit validation;
- forward migration validation and a Worker rollback compatible with the current schema;
- secret and PII log scan;
- guardrail/mode/ban tests;
- a successful test alert to `dneilroberts@gmail.com`;
- a documented rollback and verified admin recovery path.

## 11. Non-goals and accepted risks

- No compatibility promise for the legacy Python/FastAPI deployment or the separate LORAN
  UI. Preserve only components that earn their place in the unified product.
- No server-authoritative 60 Hz physics. Ranked results are abuse-resistant, not cheat-proof.
- No claim that Cloudflare has a hard dollar cap. Application ceilings and degraded modes
  control admitted work; platform alerts remain delayed notification.
- No guarantee that caching eliminates the many-users/many-regions provider worst case.
- No permanent raw ADS-B archive or per-frame D1 telemetry.
- No raw email storage in D1; exact-email admin lookup requires re-entering the address.
- No promise that external ADS-B, basemap, terrain, or email delivery always remains
  available. Every dependency has an explicit visible degradation path.
- Live weather affecting physics, runway selection, or leaderboard normalization is not
  part of this specification. It requires a separate data-source and fairness design.
- A single global broker is deliberately simple and exact for the approved small public
  launch. If it becomes a measured latency or throughput bottleneck, split regional cache
  objects from the global admission object without changing the public API.

## 12. Reference links

- Cloudflare Workers Static Assets: <https://developers.cloudflare.com/workers/static-assets/>
- Cloudflare D1 pricing: <https://developers.cloudflare.com/d1/platform/pricing/>
- Cloudflare Durable Objects pricing: <https://developers.cloudflare.com/durable-objects/platform/pricing/>
- Cloudflare R2 pricing: <https://developers.cloudflare.com/r2/pricing/>
- Cloudflare Email Service limits: <https://developers.cloudflare.com/email-service/platform/limits/>
- Cloudflare Turnstile plans: <https://developers.cloudflare.com/turnstile/plans/>
- Cloudflare Access application paths: <https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/>
- Workers Analytics Engine: <https://developers.cloudflare.com/analytics/analytics-engine/>
- Workers Logs: <https://developers.cloudflare.com/workers/observability/logs/workers-logs/>
- Cloudflare budget alerts: <https://developers.cloudflare.com/billing/manage/budget-alerts/>
