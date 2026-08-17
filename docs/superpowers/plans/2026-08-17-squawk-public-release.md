# SQUAWK Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the repo as the public open-source project **SQUAWK** — three install paths (local, Docker, Cloudflare Worker), every owner/account-specific value made user-configurable — without breaking the owner's live `fly.voygent.app` deploy.

**Architecture:** Committed config becomes a neutral SQUAWK template with placeholders + public defaults. The owner's real Cloudflare values move to a **gitignored** `frontend/wrangler.prod.jsonc` overlay that `deploy:production` targets. Brand strings in Worker/UI code become `SQUAWK` or read from env. Docs restructure around the three paths.

**Tech Stack:** Cloudflare Workers + wrangler (JSONC config), Vite/React frontend (TS), Python FastAPI backend, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-17-squawk-public-release-design.md`

## Global Constraints

- **Name:** `SQUAWK` (uppercase in user-facing copy; `squawk` in identifiers/slugs).
- **No secrets in git.** Real secrets stay in `wrangler secret` / gitignored `.dev.vars`. Only non-secret config is parameterized.
- **Owner's live deploy must keep working** — `fly.voygent.app` values live in gitignored `frontend/wrangler.prod.jsonc`; never delete them without first capturing them there.
- **Public ADS-B provider default** = `https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}` (never the owner's private `sdr.voygent.app`).
- **Surgical.** Touch only naming/config/docs. No feature changes, no D1/KV data changes, no history rewrite.
- **Gated actions (owner-run only, NOT in these tasks):** `gh repo rename`, `git remote set-url`, any `git push`, the real `deploy:production`.
- Tests run from `frontend/` via `npm test`; keep green after every task.

---

### Task 1: Split Worker config — neutral template + gitignored prod overlay

The infra-critical task. Do this first and carefully: capture the owner's real values into the overlay BEFORE neutralizing the committed config.

**Files:**
- Create: `frontend/wrangler.prod.jsonc` (gitignored — owner's real values)
- Create: `frontend/wrangler.prod.example.jsonc` (tracked — forker template)
- Modify: `frontend/wrangler.jsonc` (→ neutral SQUAWK template)
- Modify: `.gitignore` (add `frontend/wrangler.prod.jsonc`, keep `.example` tracked)
- Modify: `frontend/package.json` (deploy scripts → `--config wrangler.prod.jsonc`)
- Regenerate: `frontend/worker-configuration.d.ts`

**Interfaces:**
- Produces: neutral `frontend/wrangler.jsonc` with `name: "squawk"`, provider primary = airplanes.live, and placeholders `<PUT_YOUR_CLOUDFLARE_ACCOUNT_ID>`, `<PUT_YOUR_D1_DATABASE_ID>`, `<PUT_YOUR_ACCESS_AUD>`, `<PUT_YOUR_TURNSTILE_SITE_KEY>`, `<PUT_YOUR_ALERT_INBOX>`, plus `your-domain.example` emails/origins/routes and `squawk_requests_{env}` datasets.
- Produces: new `ALERT_FROM_EMAIL` var in the config `vars` blocks (consumed by Task 2).

- [ ] **Step 1: Capture owner's current config into the gitignored overlay**

```bash
cd frontend
cp wrangler.jsonc wrangler.prod.jsonc   # exact current values = the live fly.voygent.app config
```

- [ ] **Step 2: Gitignore the overlay (before it can be staged)**

Add to `.gitignore` (root), after the existing `.dev.vars.*` block:
```
# Cloudflare production overlay (owner's real account/domain values)
frontend/wrangler.prod.jsonc
!frontend/wrangler.prod.example.jsonc
```
Verify: `git status --porcelain frontend/wrangler.prod.jsonc` prints nothing (ignored).

- [ ] **Step 3: Rewrite `frontend/wrangler.jsonc` as the neutral SQUAWK template**

Apply these value changes (keep every structural key, binding, ratelimit, DO, cron, and `env` block intact — only the values below change). Add `"ALERT_FROM_EMAIL"` alongside `AUTH_FROM_EMAIL` in each `vars` block.

Top-level + `env.staging.vars` + `env.production.vars`:
- `name`: `"squawk"`
- `AUTH_FROM_EMAIL`: `"sign-in@your-domain.example"`
- `ALERT_FROM_EMAIL` (new): `"alerts@your-domain.example"`
- `CLOUDFLARE_ACCOUNT_ID`: `"<PUT_YOUR_CLOUDFLARE_ACCOUNT_ID>"`
- `REQUEST_ANALYTICS_DATASET`: `"squawk_requests_local"` / `"squawk_requests_staging"` / `"squawk_requests_production"`
- `ADSB_PROVIDER_PRIMARY`: `"https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}"`
- `PUBLIC_ORIGIN` (staging/prod): `"https://your-domain.example"`
- `ACCESS_TEAM_DOMAIN` (prod): `"https://your-team.cloudflareaccess.com"`
- `ACCESS_AUD` (prod): `"<PUT_YOUR_ACCESS_AUD>"`
- `TURNSTILE_SITE_KEY` (staging/prod): `"<PUT_YOUR_TURNSTILE_SITE_KEY>"`

`d1_databases[].database_name`: `"squawk-local"` / `"squawk-staging"` / `"squawk-production"`; `database_id`: `"<PUT_YOUR_D1_DATABASE_ID>"`.

`send_email[].destination_address`: `"<PUT_YOUR_ALERT_INBOX>"`; `allowed_sender_addresses`: `["alerts@your-domain.example"]`.

`env.production.routes[0].pattern`: `"your-domain.example"`.

- [ ] **Step 4: Create the forker template**

```bash
cd frontend
cp wrangler.jsonc wrangler.prod.example.jsonc
```
Add a top-of-file comment block to `wrangler.prod.example.jsonc`:
```
// Copy this file to wrangler.prod.jsonc and replace every <PUT_YOUR_...> and
// your-domain.example / your-team value with your own. wrangler.prod.jsonc is
// gitignored. `npm run deploy:production` deploys using it.
```

- [ ] **Step 5: Point deploy scripts at the overlay**

In `frontend/package.json`, change the deploy script(s) to pass `--config wrangler.prod.jsonc`. Find them first:
```bash
cd frontend && grep -nE '"deploy' package.json
```
Update `deploy:production` (and `deploy:staging` if present) so the command reads e.g.
`wrangler deploy --config wrangler.prod.jsonc --env production`. Leave any local/dev script on the default `wrangler.jsonc`.

- [ ] **Step 6: Regenerate types from the neutral config**

```bash
cd frontend && npx wrangler types
```
This rewrites `worker-configuration.d.ts` to match the neutral committed config (and includes the new `ALERT_FROM_EMAIL`). If `wrangler types` needs auth/errors, hand-edit `worker-configuration.d.ts` to replace the voygent literals with the neutral values + add `ALERT_FROM_EMAIL: string`.

- [ ] **Step 7: Verify both configs parse and the owner's deploy is intact**

```bash
cd frontend
npx wrangler deploy --dry-run --config wrangler.prod.jsonc --env production   # owner's real config still valid
npx wrangler deploy --dry-run --env production                                # neutral template parses (placeholders OK for dry-run)
git status --porcelain | grep wrangler.prod.jsonc && echo "LEAK" || echo "overlay correctly ignored"
```
Expected: both dry-runs parse; overlay is ignored (prints "overlay correctly ignored").

- [ ] **Step 8: Commit**

```bash
git add frontend/wrangler.jsonc frontend/wrangler.prod.example.jsonc .gitignore frontend/package.json frontend/worker-configuration.d.ts
git commit -m "refactor(deploy): neutral SQUAWK wrangler template + gitignored prod overlay"
```

---

### Task 2: Brand strings in Worker code (email, events, admin) + tests

**Files:**
- Modify: `frontend/worker/alerts/email.ts` (sender→env, subject, body, origin fallback)
- Modify: `frontend/worker/auth/email.ts:33` (sign-in copy)
- Modify: `frontend/worker/admin/events.ts:95,115` (export filenames)
- Modify: `frontend/worker/http/routes/admin.ts:473` (service name)
- Modify: matching assertions in `frontend/worker/**/*.test.ts`

**Interfaces:**
- Consumes: `ALERT_FROM_EMAIL` env var (Task 1).

- [ ] **Step 1: Find the tests that assert the old strings**

```bash
cd frontend
grep -rnE 'VOYGENT ADSB|Voygent ADS-B|alerts@fly\.voygent\.app|voygent-adsb-game|voygent-system-events' worker
```

- [ ] **Step 2: Update the test assertions to the new values (write-the-failing-expectation first)**

For each hit in a `*.test.ts`, change the expected string:
- `[VOYGENT ADSB]` → `[SQUAWK]`
- `Voygent ADS-B operational alert.` → `SQUAWK operational alert.`
- `Your one-time sign-in code for Voygent ADS-B Game:` → `Your one-time sign-in code for SQUAWK:`
- `voygent-system-events` → `squawk-system-events`
- service name `voygent-adsb-game[-staging]` → `squawk[-staging]`
- alert sender assertions: expect it to come from `env.ALERT_FROM_EMAIL` (see Step 4)

- [ ] **Step 3: Run the tests to confirm they now FAIL against old code**

```bash
cd frontend && npm test -- worker
```
Expected: FAIL on the updated assertions.

- [ ] **Step 4: Change the Worker code**

- `alerts/email.ts:17`: replace `const sender = "alerts@fly.voygent.app";` with `const sender = env.ALERT_FROM_EMAIL;` (thread `env` in if not already available in scope; if the function lacks `env`, pass it from the caller).
- `alerts/email.ts:18`: subject prefix `[VOYGENT ADSB]` → `[SQUAWK]`.
- `alerts/email.ts:20`: `"Voygent ADS-B operational alert."` → `"SQUAWK operational alert."`.
- `alerts/email.ts:41`: `env.PUBLIC_ORIGIN ?? "https://fly.voygent.app"` → `env.PUBLIC_ORIGIN ?? "https://your-domain.example"` (or drop the `??` fallback if `PUBLIC_ORIGIN` is always set).
- `auth/email.ts:33`: `"...for Voygent ADS-B Game:"` → `"...for SQUAWK:"`.
- `admin/events.ts:95,115`: `voygent-system-events.{json,csv}` → `squawk-system-events.{json,csv}`.
- `http/routes/admin.ts:473`: `"voygent-adsb-game"` / `"voygent-adsb-game-staging"` → `"squawk"` / `"squawk-staging"`.

- [ ] **Step 5: Run the tests to confirm they PASS**

```bash
cd frontend && npm test -- worker
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/worker
git commit -m "refactor(worker): rebrand Voygent strings to SQUAWK; alert sender from env"
```

---

### Task 3: Brand strings in frontend UI

**Files:**
- Modify: `frontend/src/admin/AdminApp.tsx:39`
- Modify: `frontend/src/takeover/urlTakeover.ts:3` (comment only)

- [ ] **Step 1: Update AdminApp header**

`AdminApp.tsx:39`: `<p>VOYGENT OPERATIONS</p><h1>ADSB-GAME CONTROL ROOM</h1>` → `<p>SQUAWK OPERATIONS</p><h1>SQUAWK CONTROL ROOM</h1>`.

- [ ] **Step 2: Update the cosmetic comment**

`urlTakeover.ts:3`: example URL `https://fly.voygent.app/?takeover=<hex>` → `https://your-domain.example/?takeover=<hex>`.

- [ ] **Step 3: Verify no voygent left in `src/` and build succeeds**

```bash
cd frontend
grep -rniE 'voygent' src && echo "REMAINING ABOVE" || echo "src clean"
npm run build
```
Expected: `src clean`; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "refactor(ui): rebrand admin console + takeover comment to SQUAWK"
```

---

### Task 4: Neutralize voygent hostnames in Worker tests

Low-risk cleanliness pass; keeps the public test suite free of the owner's domain.

**Files:**
- Modify: `frontend/worker/**/*.test.ts` (hostnames only)

- [ ] **Step 1: Inventory remaining test hostnames**

```bash
cd frontend
grep -rnE 'fly\.voygent\.app|voygent\.cloudflareaccess\.com|somotravel\.workers\.dev|voygent_adsb_game_requests' worker | grep -c ''
```

- [ ] **Step 2: Bulk-swap to neutral test values**

Replace across `frontend/worker/**/*.test.ts` only:
- `fly.voygent.app` → `squawk.example`
- `voygent.cloudflareaccess.com` → `example.cloudflareaccess.com`
- `voygent-adsb-game-staging.somotravel.workers.dev` → `squawk-staging.example.workers.dev`
- `voygent_adsb_game_requests_*` → `squawk_requests_*`

Use an editor-scoped find/replace or `sed -i` limited to test files; do NOT touch non-test worker code (that was Task 2).

- [ ] **Step 3: Run the full suite green**

```bash
cd frontend && npm test
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/worker
git commit -m "test(worker): neutralize voygent hostnames in fixtures"
```

---

### Task 5: Secret + env templates audit

**Files:**
- Modify: `frontend/.dev.vars.example` (if incomplete)
- Modify: `.env.example` (backend — add Cloudflare pointer line)

- [ ] **Step 1: List the secrets the full Worker actually reads**

```bash
cd frontend
grep -rnoE 'env\.[A-Z_]+' worker | grep -oE '[A-Z_]+$' | sort -u
```
Cross-check each against the `vars` in `wrangler.jsonc` (non-secret config) vs `.dev.vars.example` (secrets). Anything read from `env` that is NOT in `vars` is a secret and must appear in `.dev.vars.example`.

- [ ] **Step 2: Fill any gaps in `.dev.vars.example`**

Add missing secret keys with empty values + a one-line comment each (e.g. JWT signing key, Turnstile **secret** key, email provider API key, any provider token). Do not add real values.

- [ ] **Step 3: Add the backend pointer to `.env.example`**

Append near the top of `.env.example`:
```
# NOTE: the Cloudflare Worker install path is configured separately via
# frontend/wrangler.jsonc + frontend/.dev.vars (see README "Cloudflare Worker").
```

- [ ] **Step 4: Commit**

```bash
git add frontend/.dev.vars.example .env.example
git commit -m "docs(config): complete secret templates + backend→CF pointer"
```

---

### Task 6: README — three install paths + Natural Earth attribution

**Files:**
- Modify: `README.md` (restructure `## Running it`; extend `## Attribution`)

- [ ] **Step 1: Replace `## Running it` with three labelled subsections**

Structure:
```markdown
## Install

SQUAWK runs three ways. Local and Docker are the turnkey single-user game
(keyless, no accounts). Cloudflare Worker is the full product (accounts,
missions, leaderboards) and needs a Cloudflare account + guided setup.

### 1. Local (bare-metal dev)
<current scripts/dev.sh steps, ports, keyless note, "single-user: browse + fly">

### 2. Docker
<docker compose up steps, ports, single-user note>

### 3. Cloudflare Worker (full product)
1. `wrangler d1 create squawk-production` → put the id in your wrangler.prod.jsonc
2. Apply migrations: `wrangler d1 migrations apply ...`
3. Create a Cloudflare Access application → note team domain + AUD
4. Create a Turnstile widget → site key (config) + secret key (.dev.vars)
5. Configure email sending (verified sender) → set AUTH_FROM_EMAIL / ALERT_FROM_EMAIL
6. Create an Analytics Engine dataset → REQUEST_ANALYTICS_DATASET
7. `cp frontend/wrangler.prod.example.jsonc frontend/wrangler.prod.jsonc`, fill every <PUT_YOUR_...>
8. `wrangler secret put ...` for each key in .dev.vars.example
9. `cd frontend && npm run deploy:production`
```
Cross-reference each value to the placeholder names from Task 1.

- [ ] **Step 2: Add Natural Earth to `## Attribution`**

Add a line: borders/coastline vector data © **Natural Earth** (public domain, ne_50m) — alongside the existing Esri / OurAirports / adsbdb / Re:Earth / RainViewer credits.

- [ ] **Step 3: Verify links + render**

```bash
grep -nE 'your-domain.example|PUT_YOUR|Natural Earth' README.md
```
Expected: placeholders + Natural Earth present; skim for broken headings.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): three install paths + Natural Earth attribution"
```

---

### Task 7: Open-source polish — abs-path scrub + secrets scan

**Files:**
- Modify or delete: `docs/superpowers/plans/2026-08-12-{approach-guidance,declutter-57,eligibility-fetch-55-41,pin-signin}.md`

- [ ] **Step 1: Locate absolute paths**

```bash
git grep -lE "/home/neil|/Users/" -- .
```

- [ ] **Step 2: Scrub or drop**

For each hit (all under `docs/superpowers/plans/`): either replace the `/home/neil/...` path with a repo-relative path, or remove the file from the repo if it is an internal planning artifact with no public value (owner's call — default: scrub paths, keep files).

- [ ] **Step 3: Secrets scan (must be clean before any push)**

```bash
git grep -inE "api[_-]?key|secret|token|password" -- . | grep -viE "example|placeholder|PUT_YOUR|// |describe\(|it\(|test\(" | grep -iE '=|:' 
```
Review every remaining line by eye; confirm no real credential is committed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(oss): scrub absolute paths from tracked plan docs"
```

---

### Task 8 (GATED — owner runs, do NOT auto-execute): rename, push, deploy

Prepare the exact commands; the owner runs them after reviewing the branch. Present them; do not execute.

- [ ] **Step 1: Merge the branch to `main`** (from the main clone, per the deploy recipe): review the full diff first.
- [ ] **Step 2: Rename the GitHub repo**
```bash
gh repo rename SQUAWK
git remote set-url origin https://github.com/iamneilroberts/SQUAWK.git
```
- [ ] **Step 3: Push**
```bash
git push origin main
```
- [ ] **Step 4: Update the GitHub repo description** to the SQUAWK one-liner (owner picks the wording).
- [ ] **Step 5: Verify the owner's live deploy still works** — `cd frontend && npm run deploy:production` (uses the gitignored overlay), confirm `fly.voygent.app` serves and the Worker version bumps.
- [ ] **Step 6: `/branch done squawk-rebrand`** + delete the branch once merged.

---

## Self-Review

**Spec coverage:** Work area 1 (brand strings) → Tasks 2, 3 (+ done in commit 4781962). Work area 2 (wrangler template + overlay) → Task 1. Work area 3 (secret templates) → Task 5. Work area 4 (README/install docs) → Task 6. Work area 5 (polish) → Task 7. Feasibility gate (frontend degrades on local/Docker) → verified in Task 6 Step 1 context + Task 3 Step 3 build; **explicit smoke run folded into Task 6** (document the single-user reality) — if the frontend hard-errors without auth endpoints, that becomes a spec-flagged follow-up, not silently shipped. Gated actions → Task 8.

**Placeholder scan:** No "TBD"/"handle edge cases" — every task has concrete files, values, and commands.

**Type consistency:** `ALERT_FROM_EMAIL` introduced in Task 1 (config + types), consumed in Task 2. Placeholder tokens (`<PUT_YOUR_...>`) consistent between Task 1 and Task 6. Service-name and email-string replacements identical between Task 2 code changes and their test-assertion updates.
