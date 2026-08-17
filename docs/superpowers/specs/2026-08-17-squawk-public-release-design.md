# SQUAWK — Public Open-Source Release Design

**Date:** 2026-08-17
**Status:** Design — awaiting owner review before implementation plan
**Branch/worktree:** `squawk-rebrand`

## Goal

Turn the already-public repo (`github.com/iamneilroberts/adsb-game`) into a clean,
self-hostable open-source project under the product name **SQUAWK**, where a stranger can
clone it and stand up their **own** installation via one of three paths — while the owner's
live `fly.voygent.app` deployment keeps working unchanged.

## Decisions locked (owner, 2026-08-17)

1. **Name = SQUAWK.** (ADS-B is the aircraft *squawking* its identity; you grab it and fly.)
2. **Rename the repo in place** — `gh repo rename SQUAWK` (keeps stars/history/issues,
   GitHub auto-redirects the old URL). Not a fresh repo.
3. **Cloudflare option ships the FULL Worker, parameterized** — auth, missions, leaderboards,
   admin, email, analytics all included, with every account/brand value made user-configurable.
   (Not a stripped proxy-only Worker; not docs-only.)
4. **Owner's live deploy uses a gitignored prod overlay** — committed config is a neutral
   SQUAWK template; the owner's real `fly.voygent.app` values live in a gitignored
   `wrangler.prod.jsonc` that `deploy:production` targets. Forkers copy a committed
   `wrangler.prod.example.jsonc`.

## Non-secret history note

Every value being parameterized (Cloudflare account ID, D1 database IDs, Access AUD, Turnstile
**site** keys, domains, emails) is already in the existing public repo's git history. **None are
secrets** — real secrets (JWT signing key, Turnstile secret key, provider tokens, email API keys)
live in Cloudflare `wrangler secret` / gitignored `.dev.vars`, never in git. So this is **brand
hygiene, not a leak**; a history rewrite is out of scope. We clean the working tree going forward.

## Three install targets

| Target | Backend | Feature level | "Fully installs + starts"? |
|---|---|---|---|
| **Local (bare-metal dev)** | Python FastAPI `backend/` + Vite dev | Single-user: browse + fly. No auth/missions/leaderboards. | Yes — `scripts/dev.sh`, keyless, no secrets required. |
| **Docker** | `backend/` + `frontend/` nginx via `docker-compose.yml` | Same single-user set. | Yes — `docker compose up`, keyless. |
| **Cloudflare Worker** | `frontend/worker/` (full TS product) | Full: auth, missions, leaderboards, admin, email, analytics. | Detailed guided setup (needs a Cloudflare account + several services). |

**Key truth to document plainly:** local & Docker run the **Python proxy backend**, which
implements only the ADS-B / adsbdb / METAR feeds — *not* auth/missions/leaderboards (those are
Worker-only). So local/Docker = the turnkey **single-user** game; Cloudflare = the full
multi-user product. The frontend must degrade gracefully (no login/leaderboard UI breakage)
when those endpoints are absent — **verify this during implementation** (feasibility gate).

## Work area 1 — Brand strings in code → SQUAWK / env-driven

Replace owner-specific literals. Operational strings (email sender/origin) should read from
existing env vars rather than hardcode a new brand.

| File | Current | Change |
|---|---|---|
| `frontend/src/admin/AdminApp.tsx:39` | `VOYGENT OPERATIONS` / `ADSB-GAME CONTROL ROOM` | `SQUAWK OPERATIONS` / `SQUAWK CONTROL ROOM` |
| `frontend/src/main.tsx:33` | `ADSB-GAME CONTROL ROOM` | `SQUAWK CONTROL ROOM` *(done)* |
| `frontend/index.html` (title, apple-title, boot-fail) | `ADSB-GAME` | `SQUAWK` *(done)* |
| `frontend/public/manifest.webmanifest` | `ADSB-GAME` | `SQUAWK` *(done)* |
| `frontend/package.json` name | `adsb-game-frontend` | `squawk-frontend` *(done)* |
| `README.md` title | `# adsb-game` | `# SQUAWK` *(done)* |
| `frontend/worker/admin/events.ts:95,115` | `voygent-system-events.{json,csv}` | `squawk-system-events.{json,csv}` |
| `frontend/worker/alerts/email.ts:17` | hardcoded `alerts@fly.voygent.app` | read from env (new `ALERT_FROM_EMAIL` var) |
| `frontend/worker/alerts/email.ts:18,20` | `[VOYGENT ADSB]` subject / `Voygent ADS-B operational alert.` | `[SQUAWK]` / `SQUAWK operational alert.` |
| `frontend/worker/alerts/email.ts:41` | fallback origin `https://fly.voygent.app` | fallback to a placeholder / drop hard fallback |
| `frontend/worker/auth/email.ts:33` | `...for Voygent ADS-B Game:` | `...for SQUAWK:` |
| `frontend/worker/http/routes/admin.ts:473` | `voygent-adsb-game[-staging]` service name | `squawk[-staging]` |
| `frontend/src/takeover/urlTakeover.ts:3` | comment example `fly.voygent.app` | `your-domain.example` (cosmetic) |
| Worker tests (`*.test.ts`) using `fly.voygent.app`, `voygent.cloudflareaccess.com`, dataset names | test fixtures | bulk-swap to neutral (`squawk.example`, `example.cloudflareaccess.com`) — low priority, keep tests green |

`frontend/worker-configuration.d.ts` is generated — regenerate via `wrangler types` after the
config edits rather than hand-editing (or hand-edit to match if regeneration is inconvenient).

## Work area 2 — `wrangler.jsonc` → neutral template + prod overlay

**Committed `frontend/wrangler.jsonc`** becomes the SQUAWK template with placeholders and
public defaults. Placeholder convention: `"<PUT_YOUR_...>"` for values a forker must supply.

| Key | Committed template value |
|---|---|
| `name` | `squawk` |
| `vars.AUTH_FROM_EMAIL` | `sign-in@your-domain.example` |
| new `vars.ALERT_FROM_EMAIL` | `alerts@your-domain.example` |
| `vars.CLOUDFLARE_ACCOUNT_ID` | `<PUT_YOUR_CLOUDFLARE_ACCOUNT_ID>` |
| `vars.REQUEST_ANALYTICS_DATASET` | `squawk_requests_{env}` |
| `vars.ADSB_PROVIDER_PRIMARY` | **`https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}`** (flip off the owner's private `sdr.voygent.app`) |
| `vars.PUBLIC_ORIGIN` | `https://your-domain.example` (or the `*.workers.dev` note) |
| `vars.ACCESS_TEAM_DOMAIN` | `https://your-team.cloudflareaccess.com` |
| `vars.ACCESS_AUD` | `<PUT_YOUR_ACCESS_AUD>` |
| `vars.TURNSTILE_SITE_KEY` | `<PUT_YOUR_TURNSTILE_SITE_KEY>` |
| `d1_databases[].database_name` | `squawk-{env}` |
| `d1_databases[].database_id` | `<PUT_YOUR_D1_DATABASE_ID>` |
| `send_email[].destination_address` | `<PUT_YOUR_ALERT_INBOX>` |
| `send_email[].allowed_sender_addresses` | `["alerts@your-domain.example"]` |
| `env.production.routes[].pattern` | `your-domain.example` (or drop the block; workers.dev works without a route) |

**Owner's real values** move to a gitignored `frontend/wrangler.prod.jsonc`, generated from the
current committed values before we placeholder them (so nothing is lost). `deploy:production`
switches to `wrangler deploy --config wrangler.prod.jsonc --env production`.

**Forker template:** commit `frontend/wrangler.prod.example.jsonc` (copy of the neutral template
with inline "replace this" comments) so a forker has a starting point mirroring the owner's flow.

**Gitignore additions:** `frontend/wrangler.prod.jsonc` (keep `.example` tracked).

**`deploy:production` script** (`frontend/package.json`): point at the overlay config. Confirm
staging deploy path too (staging currently rides the committed `env.staging` block — decide
whether staging also moves to the overlay or stays a placeholder; recommend overlay carries
both `staging` + `production` env blocks so the public template has neither).

## Work area 3 — Secrets templates

- `frontend/.dev.vars.example` exists (502 B) — verify it lists every secret the full Worker
  needs (JWT signing key, Turnstile secret key, email API key, any provider token) with empty
  values + comments. Update if the full-product secret set has grown.
- Root `.env.example` (backend) — already clean and keyless; add a one-line pointer that the
  Cloudflare path uses `frontend/.dev.vars` instead.

## Work area 4 — README + install docs

Restructure `README.md` around the three install paths (currently one "Running it" section):

1. **Quick start — Local (bare-metal):** `scripts/dev.sh`, ports, keyless, single-user note.
2. **Docker:** `docker compose up`, ports, single-user note.
3. **Cloudflare Worker (full product):** step-by-step — create Worker, D1 (`wrangler d1 create`
   + migrations), Cloudflare Access app (team domain + AUD), Turnstile widget (site+secret),
   email sending (verified sender/MailChannels/Resend as applicable), Analytics Engine dataset,
   copy `wrangler.prod.example.jsonc` → your own config, set secrets via `wrangler secret put`,
   `deploy`. Each config value cross-referenced to the table above.
- Add the **Natural Earth** attribution (borders data) alongside Esri/OurAirports/adsbdb/
  Re:Earth/RainViewer.
- Keep the keyless-by-default framing for local/Docker.

## Work area 5 — Open-source polish (from the original handoff audit)

- **Absolute paths** in 4 `docs/superpowers/plans/2026-08-12-*.md` — scrub `/home/neil` paths or
  drop those internal planning docs from the public repo.
- **Secrets scan** — `git grep -iE "api[_-]?key|secret|token|password" -- . | grep -v example`
  before push; confirm nothing real is committed.
- **LICENSE** MIT present — leave.
- Optional: short `CONTRIBUTING.md`, GitHub repo topics/description update to SQUAWK.

## Out of scope

- Rewriting git history to purge the (non-secret) prior values.
- Cloudflare Containers / Python-Workers migration of the Docker backend — **no automated
  Docker→Worker path exists**; the TS Worker is the Cloudflare implementation and already exists.
- Changing the internal Worker service name binding beyond the string swap, or altering live
  D1 data / KV.
- Any multiplayer/product feature change — this is packaging + naming only.

## Verification

- Local: `scripts/dev.sh` boots, browse + fly work, no console errors from missing auth/mission
  endpoints (graceful degrade confirmed).
- Docker: `docker compose up` boots the same.
- Worker: `wrangler deploy --dry-run` (or against a scratch env) validates the neutral template
  parses and types regenerate; owner's `wrangler.prod.jsonc` still deploys `fly.voygent.app`
  unchanged (owner runs the real deploy at sign-off).
- `npm test` in `frontend/` stays green after the test-fixture string swaps.
- `git grep -niE "voygent"` returns only intentional/historical doc mentions, no code/config.

## Gated actions (owner sign-off required before)

- `gh repo rename SQUAWK` + `git remote set-url`.
- Any `git push` to the public repo.
- The real `deploy:production` against `fly.voygent.app`.
