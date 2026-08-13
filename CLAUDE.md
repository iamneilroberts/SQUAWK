# adsb-game — take the controls of a real flight

Browser flight sim seeded from live ADS-B: pick a real aircraft on a minimal live display,
TAKE CONTROLS, and fly it first-person over real satellite imagery and terrain until you
crash, land, or quit. Open source (MIT), self-hostable three ways — local server, local
Docker, or your own Cloudflare Worker — with optional hosting for remote users
(see **Deployment & distribution**).

Sibling project: **LORAN** (github.com/iamneilroberts/LORAN) — shares stack discipline and
visual language; shares no code at runtime (the feed normalizer is copied, not imported).

Design spec (read first): `docs/superpowers/specs/2026-07-27-adsb-game-design.md`
Research notes: `docs/research/`

---

## Ground rules — these override convenience

1. **The only synthesized object is the player's aircraft.** Live contacts are real or
   absent; feeds down = explicit offline state; unknown fields render as em-dash (—).
   Never mock, sample, or synthesize feed data to make a screen look finished.
2. **Sim state must be unmistakable**: persistent `SIM` banner, distinct accent color,
   synthetic callsign (`SIM-<hex>`). The genuine aircraft stays on the live feed as a ghost.
3. **Ask before adding any dependency** beyond the approved list (spec §14).
4. Append a dated entry to `docs/decisions.md` for every non-obvious call.
5. Commit at the end of each phase, show it running, **then stop and wait** for sign-off.
6. **Prefer boring, legible code.** The owner is a DBA, not a frontend dev.
7. Open source: no absolute paths in tracked files, everything via `.env` +
   `.env.example`, Docker and bare-metal paths both first-class. No secrets in git.

## Stack

Vite · React 18 + TypeScript · **CesiumJS** (keyless: `Ion.defaultAccessToken = null`) ·
Zustand · Tailwind for layout only + hand-written CSS tokens. Backend is one of two
interchangeable proxies behind the same feed contract: **Python 3.12 + FastAPI + httpx**
(local/Docker) or the **Cloudflare Workers** build (Workers + Durable Objects + D1) that is
the reference deployment — see **Deployment & distribution**. Physics: fixed 60 Hz, SI units
internally, aviation units only at the display edge, attitude as quaternion, `sim/` has **no
Cesium imports** and is fully unit-testable.

## Deployment & distribution

The **reference deployment** — the live build the owner runs — is a **Cloudflare Workers**
stack (Workers + Durable Objects for the ADS-B broker/lease, D1 for auth/missions/admin,
`wrangler.jsonc` config). This public repo is the **open-source distribution**; the goal is
that anyone can stand up their own instance three first-class ways:

- **Local server** — bare-metal (Vite frontend + FastAPI proxy), `.env` driven.
- **Local Docker** — `docker-compose`, the turnkey self-host path.
- **Cloudflare Worker** — deploy the Workers build to your own CF account; **optional
  hosting** lets a maintainer run one instance for remote users.

Config stays portable across all three (`.env` + `.env.example`, no absolute paths, no
secrets in git). The FastAPI proxy and the Workers broker are two backends serving the same
frontend against the same feed contract — keep them in sync rather than forking behavior.

## Data sources & attribution (must be displayed)

| Feed | Role | Notes |
|---|---|---|
| Local ADS-B receiver (dump1090 / readsb / tar1090) | live ADS-B, **preferred when present** | your own SDR's `aircraft.json`, same readsb schema; used **in addition to** the API feeds — local first for your area, APIs for wider coverage/failover. Configured via `.env`, off by default |
| airplanes.live → adsb.lol → adsb.fi | live ADS-B, API failover | readsb schema, feet/knots, 1 req/s, backend-proxied |
| adsbdb | type → class mapping | cached, backend-proxied |
| Esri World Imagery | satellite basemap | attribution required; no documented quota — degrade honestly if throttled |
| Re:Earth Terrain | quantized-mesh terrain, **ellipsoidal** | keyless; attribution "Re:Earth Terrain · Mapterhorn (CC BY 4.0)"; best-effort — ion free tier is the fallback |
| Overture Maps / OSM | buildings bubble (Phase D) | PMTiles preferred, Overpass fallback; attribution when active |
| RainViewer | precip-radar overlay (NavMap WX) | keyless, global, CORS-open; browser-direct (no proxy); attribution "WEATHER © RAINVIEWER" when active; reprojected onto the NM-polar nav face, `radar.past` (observed) only |

Same readsb gotchas as LORAN: `alt_geom` (WGS84) preferred, `alt_baro` may be the string
`"ground"`, negative altitudes legitimate, `dbFlags & 1` = military, `seen_pos` up to ~50 s.

## Phases

Sequential; stop and wait after each. Detail in spec §11.

- **A — Scaffold + browse:** ✅ Complete. Backend proxy (failover across airplanes.live →
  adsb.lol → adsb.fi, adsbdb enrichment) + Cesium browse globe with live contacts, chevron
  icons, picking, contact list, honest feed status bar; Docker Compose and bare-metal dev
  paths both verified.
- **B — Sim core:** pure-TS 6-DOF, three parameter files, envelope unit tests. No rendering.
- **C — FPV:** terrain, damped cockpit camera, HUD, handoff, ground collision. First flyable.
- **D — Buildings:** PMTiles-vs-Overpass spike, 25 km bubble, collision.
- **E — Polish:** ghost, chase cam, stats, tile warmer, structural limits decision.

## Flight model — one shape, three data files

GA piston (C172S, power-limited thrust `T=η·P/V`), airliner (737-800, flat-rated turbofan,
flap regimes, huge roll inertia), fighter (**F-5/T-38-class stable jet** — afterburner is a
plain dry/wet toggle; no FBW/FLCS code path, per owner decision). Class differences are
**data, not branches**. CD0/e are documented tuning knobs; fighter numbers need Phase B
source verification.

## Visual direction

LORAN's mission-terminal language: near-black `#05070a`, amber `#ffb000` for warnings/SIM
accents, cyan `#5fd7e0` for nominal data, monospace, uppercase letterspaced labels,
1px borders, bracket corners, translucent panels, no rounded corners > 2px, no shadows.
The globe is the subject; HUD and chrome are instrumentation.

## Explicit non-goals (v1)

No multiplayer, scoring, weather, fuel, sound, ground ops (airborne spawn only), air-to-air
collision, mobile controls (interface reserved), recording/replay, AI traffic. If you find
yourself building one — **stop and ask.**
