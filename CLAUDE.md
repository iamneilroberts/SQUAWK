# adsb-game — take the controls of a real flight

Browser flight sim seeded from live ADS-B: pick a real aircraft on a minimal live display,
TAKE CONTROLS, and fly it first-person over real satellite imagery and terrain until you
crash, land, or quit. Self-hosted, single-user, open source (MIT).

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
Zustand · Tailwind for layout only + hand-written CSS tokens · Python 3.12 + FastAPI +
httpx. Physics: fixed 60 Hz, SI units internally, aviation units only at the display edge,
attitude as quaternion, `sim/` has **no Cesium imports** and is fully unit-testable.

## Data sources & attribution (must be displayed)

| Feed | Role | Notes |
|---|---|---|
| airplanes.live → adsb.lol → adsb.fi | live ADS-B, failover | readsb schema, feet/knots, 1 req/s, backend-proxied |
| adsbdb | type → class mapping | cached, backend-proxied |
| Esri World Imagery | satellite basemap | attribution required; no documented quota — degrade honestly if throttled |
| Re:Earth Terrain | quantized-mesh terrain, **ellipsoidal** | keyless; attribution "Re:Earth Terrain · Mapterhorn (CC BY 4.0)"; best-effort — ion free tier is the fallback |
| Overture Maps / OSM | buildings bubble (Phase D) | PMTiles preferred, Overpass fallback; attribution when active |

Same readsb gotchas as LORAN: `alt_geom` (WGS84) preferred, `alt_baro` may be the string
`"ground"`, negative altitudes legitimate, `dbFlags & 1` = military, `seen_pos` up to ~50 s.

## Phases

Sequential; stop and wait after each. Detail in spec §11.

- **A — Scaffold + browse:** backend proxy + minimal live display + picker.
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
