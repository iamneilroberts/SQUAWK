# Decisions

Dated log of non-obvious calls. Newest last.

## 2026-07-27 — G-001 · Founding decisions (owner, brainstorm session)

Recorded in full in the spec (`docs/superpowers/specs/2026-07-27-adsb-game-design.md`, §1):
separate repo from LORAN; free-flight-until-impact session arc; simplified 6-DOF with
per-class parameter files; desktop controls only in v1; terrain collision everywhere +
buildings in a ~25 km bubble; Re:Earth terrain; Overture-PMTiles-first buildings; own
FastAPI proxy with the normalizer copied from LORAN.

## 2026-07-27 — G-002 · Fighter class is F-5/T-38-style, not F-16 (owner)

The F-16 is statically unstable and only flyable through its FLCS; modeling it honestly
requires a closed-loop control layer — the sole per-class code branch in the design. Owner
chose an easier model: a conventionally stable fighter (F-5E/T-38 class), same direct 6-DOF
path as the other classes, afterburner as a plain dry/wet thrust toggle, limits as clamps.
Real F-16s selected on the browse screen still map to this archetype; the parameter file
says so honestly. Consequence: the sim core is purely data-driven — no per-class branches.

## 2026-07-27 — G-003 · Ellipsoidal-height terrain so collision compares like with like

Re:Earth Terrain serves quantized-mesh with **ellipsoidal** heights (Mapterhorn DEM +
EGM2008 geoid applied). ADS-B `alt_geom` is WGS84-ellipsoidal too, so spawn altitude and
ground height share a datum with no geoid fudge. Keyless and free, but best-effort with no
SLA — the fallback (Cesium ion free tier, token, non-commercial terms) is documented and
the terrain provider sits behind one module so swapping is one file.

## 2026-07-27 — G-005 · Feed env vars are full URL templates, not bases

Upstream path shapes differ per feed (airplanes.live `/point/…`, adsb.lol + adsb.fi
`/lat/…/lon/…/dist/…`, per LORAN recon), so a single base+path convention cannot express
real failover. `FEED_PRIMARY`/`FEED_FALLBACK`/`FEED_RESERVE` are now full URL templates
with `{lat}`/`{lon}`/`{radius}` placeholders, formatted per call — this keeps feeds
swappable via `.env` without a code change.

## 2026-07-27 — G-006 · Default ports: backend 8020, compose frontend 8021

The plan's port defaults (backend `:8010`, compose frontend `:8080`) were chosen unaware of
this homelab box's reality: `:8010` is LORAN's deployed production backend (fronted by the
`cloudflared-loran` systemd tunnel) and `:8080` is occupied by an unrelated long-running
Docker container. Colliding defaults would break the bare-metal dev path and could point
this game's frontend at LORAN's live API instead of its own. Moved the backend default to
`8020` (`ADSB_GAME_PORT` in `backend/app/config.py` and `.env.example`, and the dev-proxy
target in `frontend/vite.config.ts`); `8021` is reserved for the compose frontend port and
takes effect when Task 9 lands docker-compose.yml. Both verified free on this box. Ports
remain `.env`-overridable — this only changes the defaults.

## 2026-07-27 — G-004 · Cesium static assets copied at build time, not committed

LORAN commits ~430 asset files; adsb-game copies from `node_modules` in `predev`/`prebuild`
instead, keeping the public repo lean. Trade-off: `npm install` required before first run
(true anyway).

## 2026-08-05 — Phase A known limitations (final whole-branch review triage)

The final whole-branch review approved Phase A with three ~1-line robustness/hygiene fixes
applied and tested: malformed-template failover (`adsb.py`), non-dict feed row skip
(`normalize`), and an adsbdb hex whitelist (`adsbdb.py`). The following are consciously
deferred as documented Phase-A limitations, not defects:

- **No keyboard selection of contact rows** (`frontend/src/panels/ContactList.tsx`) — rows
  are click-only, consistent with Cesium picking; add `role`/`tabIndex`/`onKeyDown` post-A.
- **No `restart:`/healthcheck in `docker-compose.yml`** — fine for manual homelab runs; add
  `restart: unless-stopped` + a `/healthz` healthcheck if/when it becomes always-on.
- **`frontend/scripts/copy-cesium-assets.sh` merges, not mirrors** — stale assets could
  linger on a Cesium version bump; `rm -rf` the target dirs before copy at that time.
- **Stale contacts stay rendered on OFFLINE** — billboards freeze at last-good positions
  while the status chip honestly reads STALE/OFFLINE (data is real, just old; this is
  deliberate anti-flicker). Revisit clearing/dimming on sustained OFFLINE if it misleads.
- **Port override only works on the bare-metal path.** `scripts/dev.sh` + `vite.config.ts`
  honor `ADSB_GAME_PORT`; the Docker path (backend image, `nginx.conf`, `docker-compose.yml`)
  hardcodes backend `8020` / published `8021`, so `.env` does not change the compose ports.
  A bare `npm run dev` (bypassing `dev.sh`) leaves the proxy on the `:8020` fallback.
- Backend cache/lock micro-races (cache read outside the lock, no `_cache` eviction) are
  unreachable in practice: one fixed home/radius key plus the frontend in-flight guard.

## 2026-08-05 — Phase B owner decisions (B-1..B-5): merged "first flyable", C172-only, GA-only takeover

Owner decisions at Phase B brainstorm, recorded in
`docs/superpowers/specs/2026-08-05-phase-b-first-flyable-design.md` §1:

- **B-1** Spec §11's B/C split is merged into one "first flyable" phase (sim core AND
  terrain/FPV/HUD/handoff/collision together). Owner chose seeing it fly over the
  headless-first split.
- **B-2** C172S GA piston is the only class this phase; airliner/fighter params and the
  F-5E/T-38 source-verification are future enhancements.
- **B-3** Takeover restricted to GA-class contacts (feed `t` vs a GA-piston designator
  data list; military excluded). Airliners etc. are future. A disclosed envelope clamp in
  `buildSpawnState` remains as a safety net — silent clamping is banned.
- **B-4** Minimal ghost ships now (ground rule 2 honored literally), with honest
  staleness labels.
- **B-5** End card allows orbiting the impact site (not a hard freeze-frame).

An Opus 4.8 feasibility review (same date) surfaced 9 red flags — spawn-vs-envelope,
terrain-not-resident-at-spawn, backgrounded-tab dt, ENU-frame drift, Esc/pointer-lock,
Viewer/polling ownership, selection nulling, height-0 contacts under real terrain,
snapshot gating — all folded into the spec as requirements rather than left to
implementation discretion.

## 2026-08-05 — B-006 · C172S parameters are tuned at typical operating mass, not max gross

The POH quotes Vs1 48 / Vs0 40 KIAS at max gross (1157 kg), but reproducing those at max
gross needs CLmax ≈ 1.85 — well outside the sourced 1.47–1.58 range. Rather than invent a
wing, `params/c172.json` uses the sourced typical operating mass (950 kg, research doc
range 950–1050) with a sourced CLmax of 1.533, which lands Vs1 at 48.1 kt and Vs0 at
41.8 kt against the book numbers. The trade is stated in `sources.massKg` in the file
itself. Two knobs carry the rest of the tuning and are labelled TUNING KNOB in `sources`:
`cd0` 0.032 → 0.035 (cruise lands at ~123 kt TAS inside the POH's 122–124 kt band) and
`propPeakSpeedMs` (a linear prop-efficiency ramp below 60 m/s, which both caps static
thrust and brings sea-level climb from ~1570 fpm to ~740 fpm vs the POH's 730 fpm — a
constant-efficiency `T = ηP/V` model is wildly optimistic in the climb).
