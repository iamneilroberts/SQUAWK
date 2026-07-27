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
