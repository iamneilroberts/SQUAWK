# adsb-game

Pick a real aircraft off live ADS-B, take the controls, and fly it first-person over real
satellite imagery and real terrain — until you crash, land, or quit. The real aircraft
keeps flying on the feed as a ghost while yours diverges.

Browser-based (CesiumJS), self-hosted, single-user, MIT. Sibling of
[LORAN](https://github.com/iamneilroberts/LORAN).

**Status: Phase B (First Flyable) complete.** Pick a real GA-piston contact off the live
browse globe, TAKE CONTROLS, and fly a C172S first-person over real Esri imagery and real
Re:Earth terrain until you land, crash, or quit. The approved specs live at
[`docs/superpowers/specs/2026-07-27-adsb-game-design.md`](docs/superpowers/specs/2026-07-27-adsb-game-design.md)
and [`docs/superpowers/specs/2026-08-05-phase-b-first-flyable-design.md`](docs/superpowers/specs/2026-08-05-phase-b-first-flyable-design.md).

## What it will be

- **Browse** — minimal live ADS-B display around a home location (backend-proxied,
  rate-limited, honest empty states).
- **Take controls** — snapshot a real contact's position/altitude/heading/speed; its type
  maps to one of three flight-model classes (GA piston / airliner / fighter).
- **Fly** — simplified 6-DOF physics where class character emerges from parameters
  (a 737 rolls like 79 tonnes; a 172 stalls soft and mushy; the fighter has afterburner).
- **End** — terrain contact anywhere on Earth, or a building inside a ~25 km bubble,
  ends the session with a stats card. Gentle, level, slow touchdowns read LANDED.

## Running it

Copy `.env.example` to `.env` first (no secrets required, every upstream feed is keyless).

> **Cloudflare migration note:** Docker Compose is a legacy deployment path and is not
> supported on this branch after the Cloudflare build shell lands. The production build
> now emits a Worker plus `dist/client`, not the nginx-root layout. Docker/nginx retirement
> is Task 18; do not use Compose as a validation or deployment path during the migration.

**Cloudflare shell** — runs the unified Vite/Worker development runtime. During Task 1 only
`/api/status` is implemented; the existing browse UI remains honestly offline until its API
routes are ported in later tasks:

```bash
cd frontend
npm ci
npm run dev:worker
```

**Bare metal** — one script runs the backend (uvicorn, from `backend/.venv`) and the
Vite dev server together, on **http://localhost:5173** (backend on `:8020`). Requires
`python3` and `node`/`npm` on `PATH`. First run creates `backend/.venv` and installs
`backend/requirements.txt`, and runs `npm ci` in `frontend/` — that's normal and only
happens once; later runs skip straight to starting the servers:

```bash
bash scripts/dev.sh
```

Ports default to backend `8020` / compose frontend `8021` (see
[`docs/decisions.md` G-006](docs/decisions.md) — `:8010`/`:8080` are taken by other
services on this box).

> **Port overrides:** only the legacy bare-metal path honors `ADSB_GAME_PORT` — `scripts/dev.sh`
> passes it to uvicorn and `vite.config.ts` proxies to it. The Docker path is fixed: the
> backend image, `nginx.conf`, and `docker-compose.yml` hardcode backend `8020` / published
> `8021`, but that Compose path is transitionally unsupported on this branch. Running
> `cd frontend && npm run dev` directly (bypassing `dev.sh`) also leaves `ADSB_GAME_PORT`
> unset and the Vite proxy falls back to `:8020`.

## Controls

Desktop keyboard only in this build.

| Key | Action |
|---|---|
| `↑` / `↓` | pitch down / pitch up |
| `←` / `→` | roll left / roll right |
| `A` / `D` | rudder left / right |
| `W` / `S` (or `+` / `-`) | throttle up / down |
| `F` / `V` | flaps down / up (0 · 10 · 20 · 30) |
| `,` / `.` | trim nose down / nose up |
| `G` | gear — the C172's gear is fixed, so this reads GEAR FIXED |
| `Esc` | pause (RESUME / QUIT TO BROWSE) |

Takeover is restricted to civil GA-piston contacts this build (see
`frontend/src/params/ga-types.json`); the disabled button says which gate a contact failed.
All of them fly the C172S parameter set, which the handoff card discloses. Every clamp the
sim applies to a snapshot is listed on that card before you fly.

### Map layers

Two toggles live in the status bar, beside the feed-radius chip:

- **MAP SAT / MAP CHART** — swaps the imagery layer between Esri World Imagery (satellite) and
  Esri Dark Gray Canvas (a much lighter vector-style basemap). Terrain, camera and traffic are
  untouched; only the imagery changes. Use CHART if tiles are slow.
- **LABELS ON / OFF** — adds Esri's keyless "World Boundaries and Places" reference layer plus
  airport idents from a bundled OurAirports extract. Off by default.

Both are keyless Esri REST services; the app still runs with `Ion.defaultAccessToken = null`.
The attribution line in the status bar and on the HUD names exactly the layers that are on.

**Refreshing the airport data** (rarely needed — it is committed):

```bash
bash scripts/fetch-ourairports.sh
```

That downloads OurAirports' public-domain `airports.csv`, keeps large and medium airports, and
rewrites `frontend/src/data/airports-world.json`. It is a build-time-only script: the browser
never fetches it and never parses CSV. The current extract holds 5,272 airports at 512 KB.

### The cockpit dashboard

While flying, a collapsible strip along the bottom of the screen carries:

- **INSTRUMENTS** — an analog six-pack (ASI, attitude, altimeter, turn coordinator, DG, VSI) drawn
  from the same ~10 Hz snapshot as the HUD, so the needles and the numbers can never disagree. The
  ASI's arcs are computed from the C172S parameter file: the stall speeds come out of the aero
  block, Vno and Vfe out of the POH figures in `c172.json`.
- **RADAR** — a PPI scope of the **live ADS-B feed**, own ship centred, heading-up, ranges
  10/40/80/150/250 NM. Blips are real contacts and nothing else; if the feed drops the scope says
  `RADAR OFFLINE · NO FEED` rather than going quietly empty.
- **WEATHER** and **ATC** — chrome only. Both read `NO FEED · FUTURE INTEGRATION` and name the feed
  that is planned. Nothing fake is ever drawn in them.
- **CONTROLS** — the keymap, generated from the `KEYMAP` constant in `input/controls.ts`. There is
  no second, hand-maintained key list to fall out of date.

Live contacts crossing the windscreen also get a small screen-anchored tag (callsign, type,
altitude); click one for a card with the feed's fields plus adsbdb enrichment.

Each panel header folds its own panel, and the strip folds as a whole. **The keys are not listed
here on purpose** — the CONTROLS panel in the app is generated from the `KEYMAP` constant in
`frontend/src/input/controls.ts`, and a second hand-maintained key table in the README is exactly
the thing that would go stale and start lying. Open the app and press `?`.

Fold state is per-flight: it survives a pause, and a new takeover starts with a fresh cockpit.

## Attribution

Imagery © Esri World Imagery · Terrain: Re:Earth Terrain · Mapterhorn (CC BY 4.0) ·
Buildings (when active): Overture Maps / © OpenStreetMap contributors · Live traffic:
airplanes.live, adsb.lol, adsb.fi · Aircraft data: adsbdb · Basemap (CHART): Esri Dark Gray
Canvas · Places: Esri World Boundaries and Places · Airport labels: OurAirports (public domain).
