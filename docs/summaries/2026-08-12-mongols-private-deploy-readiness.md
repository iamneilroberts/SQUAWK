# Mongols private-deploy readiness assessment (Task 1)

**Date:** 2026-08-12
**Assessed by:** foreground investigation (read-only + live wrangler/curl probes), redoing the subagent that stalled.
**Source of truth:** live Cloudflare account + `mongols` worktree @ `25ae8c6`.

## Headline: it is ALREADY DEPLOYED and PUBLIC

`fly.voygent.app` is **live right now** serving the mongols game, and it is **NOT locked** —
anonymous `curl` gets HTTP 200 (no Cloudflare Access redirect). The handoff assumed nothing
was deployed; reality is the opposite. Everything the readiness check worried about
(provisioning, secrets, migrations, cost floor, custom domain) is **already done**. The only
thing standing between today and "private-first" is **one Cloudflare Access application in
front of the hostname.**

### Verified live state (2026-08-12 00:58 UTC)

| Thing | State | Evidence |
|---|---|---|
| Worker deployed | ✅ live @ version `ce7524d5`, 2026-08-11 04:26 | `wrangler deployments list --env production` |
| Custom domain | ✅ `fly.voygent.app` resolves (Cloudflare IPs) | `dig +short` → 172.67.155.72 / 104.21.56.184 |
| Site serving | ✅ HTTP 200, mongols CSP (turnstile/rainviewer/reearth/arcgis/cesium) | `curl -I https://fly.voygent.app/` |
| Backend API | ✅ typed envelope, `mode:"NORMAL"` | `curl /api/mode` → structured `NOT_FOUND` w/ requestId |
| Prod D1 | ✅ created + schema + migrations applied | `d1_migrations` COUNT = **4**; tables incl. `users` |
| Prod secrets | ✅ all 4 present | CSRF_SECRET, EMAIL_KEY_SECRET, MISSION_SIGNING_SECRET, TURNSTILE_SECRET |
| Turnstile | ✅ site key + secret configured | prod vars + secret list |
| **Access gate** | ❌ **NOT in front of the site** | anonymous `curl` → 200, no `cloudflareaccess.com` redirect |

⚠️ **Because it's public, anyone with the URL can play now** — consuming the ADS-B upstream
daily quota (`UPSTREAM_DAILY_LIMIT=500`), D1 writes, and mission starts. If private-first was
the intent, the site is currently not private. Fix = add Access (Q4).

## The 6 questions

**Q1 — Minimum bindings/secrets/migrations to deploy PRIVATELY (vs public).**
Nothing outstanding. All bindings bound (D1 `DB`, DO `ADSB_BROKER`/`AdsbBroker`, Analytics
`REQUEST_ANALYTICS`, Email `AUTH_EMAIL`+`ALERT_EMAIL`, 4 rate limiters, `ASSETS`, `*/5` cron),
all 4 prod secrets set, 4 migrations applied. **Private adds nothing to the deploy** — privacy
is an edge Access layer, not a config change. Deploy readiness for production = DONE.

**Q2 — workers.dev first (no DNS) vs needing fly.voygent.app?**
Moot — production is **already on the `fly.voygent.app` custom domain and live**. workers.dev
isn't needed. Note it also *can't* help privacy: **Cloudflare Access cannot gate `*.workers.dev`
subdomains** — it needs a custom domain, which is already in place.

**Q3 — Cost drivers at rest.**
Near-zero **confirmed**:
- **DO `AdsbBroker`:** self-*deletes* its alarm when no lease + no cached traffic
  (`AdsbBroker.ts:535` `if (earliest === null) await storage.deleteAlarm()`). **No DO billing at rest.**
- **`*/5` cron:** 288 invocations/day (alert healthCheck). The only always-on cost; negligible.
- **D1:** ~200 KB at rest; reads/writes only during play.
- **Email:** per-event (auth/alert) only.
- Workers Paid ($5/mo, already owned) covers the floor → **~$0 marginal at rest.**

**Q4 — Lock to invited users. ← THE remaining action.**
Add a **Cloudflare Access application** in the Zero-Trust dashboard covering
`fly.voygent.app/*`, policy = *allow emails in {dneilroberts@gmail.com, + any invitees}*.
Access runs at the edge before the Worker, so it gates the whole game. The Worker already
reverifies Access for `/admin` (AUD `f3f390d7…` configured), which keeps working underneath.
~10 min, no redeploy. **The built-in magic-link is the app's own auth but does NOT restrict who
can sign up — it is not an invite-lock by itself.** Recommendation: use Access.

**Q5 — Which Task 17/18 items truly block PRIVATE go-live.**
Essentially none. Task 17 (E2E/load/security/perf gates) and Task 18 (staging drills, 70/90/100%
capacity drills, checkpoint D) are **public-launch** gates. For an invite-only run with the owner
+ a few friends they are not blockers. Real private-go-live list: (1) put Access in front (Q4);
(2) confirm mission-starts enablement is intended (checkpoint D says keep starts disabled until
public — but `FORCE_MODE=NORMAL` suggests missions may be live; verify); (3) optional: add
staging's missing `MISSION_SIGNING_SECRET` if you want a staging smoke env (prod has it).

**Q6 — HUD-port effort (rich-hud-main → mongols).**
**Moderate hand-merge, ~half-day to a day** — not the clean port main got. Diff `25ae8c6 →
9f4bc1b` touches 9 files (~1000 ins / ~1000 del) but conflates rich-HUD changes with mongols'
own mission divergence:
- `ImmersiveHudBar.tsx` (+323), `Hud.tsx` (+41) — the actual rich HUD; ports but must bind to
  mongols' `HudSnapshot` shape.
- `tokens.css` (764 lines churned) — big; a lot is two-way divergence → needs careful 3-way.
- `FlightSession.tsx` (438) — mostly mongols mission rewrite, NOT HUD; graft HUD wiring by hand.
- mongols keeps its own approach/nav-director (in mission modules, not `hud/`) — preserve it.

## Gaps / cleanups (none block a private run)

1. **Site is public** — add Access (Q4) to make it private. ← do this first if privacy matters now.
2. **Staging** missing `MISSION_SIGNING_SECRET` (prod is fine). Only matters if you smoke-test on staging.
3. Confirm mission-starts enablement state vs checkpoint-D intent.
4. `wrangler d1 migrations list` cosmetically showed "to be applied," but `d1_migrations` table = 4
   applied and schema is present — tracking is fine, ignore the list quirk.

## Recommendation

The heavy lift the handoff feared (provision + deploy Cloudflare) is **already complete and live**.
Reframe the sub-project from "deploy mongols" to:
1. **Lock it down** — one Access app (~10 min). Decide invitee list.
2. **Decide mission-start state** for the private run.
3. **Port the rich HUD** onto mongols (~half-day hand-merge) — the real remaining build work.
4. Public-launch gates (Task 17/18) stay deferred until you actually go public.

No new provisioning, no cost surprise, no deploy risk. Owner sign-off needed on: (a) add Access
now?, (b) invitee list, (c) is the rich-HUD port the next build?
