# adsb-game — design spec

**Date:** 2026-07-27 · **Status:** approved by owner (brainstorm session "adsb-game")
**Sibling project:** LORAN (github.com/iamneilroberts/LORAN) — shares stack discipline and
visual language; shares **no code at runtime** (normalizer is copied, not imported).

## 1. Concept

A minimal live ADS-B display (the **browse screen**) shows real traffic around a home
location. Selecting a contact and pressing **TAKE CONTROLS** snapshots that aircraft's real
position, altitude, heading and speed, maps its type to one of three flight-model classes,
and drops the player into a first-person cockpit view at that exact state, over real
satellite imagery and real terrain. Free flight until terrain or building impact ends the
session, or the player quits.

The real aircraft keeps flying on the live feed and is rendered as a **ghost**, so the
player can watch reality diverge from them.

### Founding decisions (owner, 2026-07-27)

| Decision | Choice |
|---|---|
| Home | Separate repo, `adsb-game`, MIT, open source |
| Session arc | Free flight; impact ends it; no objectives, no scoring |
| Flight model | Simplified 6-DOF aero — one model shape, per-class parameter files |
| Fighter class | F-5/T-38-style stable jet — **no** FBW/FLCS special case (owner amendment) |
| Controls v1 | Desktop mouse + keyboard only; input layer abstracted for later touch/tilt |
| Collision v1 | Terrain everywhere + buildings in a ~25 km bubble; traffic is scenery |
| Terrain | Re:Earth quantized-mesh (keyless, ellipsoidal); Cesium ion free tier is fallback |
| Buildings | Overture Maps PMTiles first; raw Overpass fallback (Phase D spike decides) |
| Data feed | Own tiny FastAPI proxy; normalizer copied from LORAN |

## 2. Honest-data seam (ground rule)

The **only synthesized object is the player's aircraft.** Everything else obeys LORAN's
honesty rules: live contacts are real or absent, unknown fields render as em-dash, feeds
down = explicit offline state. Sim state is unmistakable at all times:

- persistent `SIM` banner + distinct accent color while flying,
- the player's aircraft carries a synthetic callsign (`SIM-<hex>`),
- the genuine contact remains on the feed, rendered as a ghost,
- exiting the sim returns to the live browse screen with no residue.

## 3. Architecture

Stack: Vite + React 18 + TypeScript, CesiumJS (keyless: `Ion.defaultAccessToken = null`),
Zustand, Tailwind for layout only + hand-written CSS tokens (amber/cyan mono aesthetic
inherited from LORAN), Python 3.12 + FastAPI + httpx backend, `.env` config, Docker Compose
plus bare-metal dev path. No SQLite in v1 (nothing to record).

```
frontend/src/
  sim/           pure-TS 6-DOF core — NO Cesium imports, fully unit-testable
  sim/aircraft/  ga-piston.json, airliner.json, fighter.json + type→class mapping
  world/         terrain height service, buildings bubble, collision manager
  view/          Cesium viewer, FPV camera, chase cam, aircraft/traffic primitives
  game/          session state machine: BROWSE → FLYING → ENDED
  input/         normalized control vector — keyboard+mouse now, same interface later
  hud/           tapes, warnings, SIM banner
backend/app/     FastAPI: /api/adsb (normalize+failover+rate-limit), /api/type/{hex}
```

- Physics: fixed 60 Hz timestep with accumulator, decoupled from render.
- Attitude stored as a quaternion; converted to heading/pitch/roll only at the Cesium
  boundary (avoids Euler singularities; render camera takes a low-passed copy).
- Units: **SI internally, aviation units (knots/feet/fpm) only at the display edge.**
- Continuous rendering (not `requestRenderMode`) — a sim is the documented anti-case.

## 4. Flight model

One 6-DOF rigid-body model, three parameter files. Forces: lift `½ρV²S·CL(α)` with
per-class CL curve and soft post-stall rolloff, parabolic drag polar `CD = CD0(config) +
k·CL²`, thrust per class (below), gravity. Moments: control-surface authority × dynamic
pressure + per-axis rate damping. ISA standard atmosphere for ρ(h). Still air (no wind,
no turbulence) in v1.

Class-specific physics that must NOT be simplified away (research-verified):

| Class | Basis | Thrust model | Character comes from |
|---|---|---|---|
| GA piston | C172S | **power-limited**: `T = η·P/V`, capped at static thrust | light mass, low wing loading, soft mushy stall, flaps add drag as well as lift |
| Airliner | 737-800 | flat-rated turbofan: lapse with density altitude + ram-drag falloff with speed | 79 t of roll inertia, discrete flap regimes (clean/T-O/landing) shifting CLmax **and** CD0, +2.5 g limit |
| Fighter | F-5E/T-38 class | dry/wet: afterburner is a **simple thrust toggle**, not a lookup table | high T/W, small wing, ~220°/s roll, ~+7.3 g clamp, high AoA warning from the same stall code |

- The fighter is deliberately a conventionally stable airframe so all three classes share
  one code path; class differences are **data, not branches**.
- Limits (Vne/Vmo, g, AoA) are clamps + HUD warnings in v1. Exceeding them warns; it does
  not yet break the airframe (listed as a Phase E candidate, owner to decide).
- C172 and 737-800 parameter sets are research-sourced (see `docs/research/`
  `aero-parameters.md`). The F-5E/T-38 set was re-based after that research pass and its
  numbers must be **verified against published sources during Phase B** before tuning.
- CD0 and Oswald-e are textbook-range estimates for all classes (real values are
  unpublished); each JSON documents them as the designated tuning knobs.

### Type → class mapping

Priority order, first hit wins; shown to the player at handoff with a manual override:

1. known type-designator lists (e.g. `F16`,`F15`,`F18`,`EUFI` → fighter; `C172`,`P28A`,
   `SR22`… → ga-piston; `B73x`,`A32x`,`E75x`… → airliner),
2. ADS-B emitter category (`A1`/`A2` → ga-piston, `A3`/`A5` → airliner),
3. fallback: airliner, labeled as a guess in the handoff dialog.

## 5. Session state machine

```
BROWSE ──select + TAKE CONTROLS──▶ FLYING ──terrain/building impact──▶ ENDED ──▶ BROWSE
   ▲                                  │  quit (Esc)                        │
   └──────────────────────────────────┴────────────────────────────────────┘
```

- **BROWSE**: live viewport-scoped ADS-B display, contact list + globe, pick a contact.
  Takeover allowed only for **airborne** contacts (`alt_baro != "ground"`) with a fresh
  position (`seen_pos` under threshold) — spawning on the ground would be an instant crash.
- **Handoff**: snapshot lat/lon, `alt_geom` (fallback `alt_baro`), track→heading, ground
  speed→TAS approximation, vertical rate. Show inferred class + override. 3-2-1 fade to FPV.
- **FLYING**: sim loop runs; live traffic keeps polling and renders as scenery (not solid);
  ghost of the origin aircraft included. `SIM` banner throughout.
- **ENDED**: freeze frame + stats card — airtime, distance, max speed/alt/g, impact sink
  rate and speed. Terrain contact with sink rate < 600 fpm, near-level attitude and speed
  < 1.3 Vs reads **LANDED**; anything else **CRASHED**; building impact reads **IMPACT**.
  Every terrain/building contact ends the session either way in v1.

## 6. World & collision

**Terrain** — Re:Earth quantized-mesh (`https://terrain.reearth.land/cesium-mesh/ellipsoid`),
keyless, **ellipsoidal heights** — same WGS84 datum as `alt_geom`, so collision compares
like with like. Zoom ≤ 14 mesh: crash-detection grade, not blade-of-grass grade. Best-effort
service; Cesium ion free tier (needs token, non-commercial) is the documented fallback.
Ground test each physics tick via `scene.globe.getHeight()` with three mandatory defenses
(research: cesium#5999, community threads):

1. **last-known-good cache** — `undefined` (tiles not resident) reuses the previous sample,
   never reads as "no ground";
2. periodic async `sampleTerrainMostDetailed` backfill for current + predicted position;
3. spawn grace: until the first defined sample arrives for the area, collision is armed
   only against the last verified floor (no fall-through, no false crash on spawn).

**Buildings** — solid only inside a ~25 km bubble around the spawn point; beyond it the
world is honest scenery. Phase D opens with a spike comparing:
- *Preferred:* **Overture Maps building footprints via PMTiles** — keyless, no rate limits,
  pre-merged polygons, ML-fused heights (prior art: osm-drone-simulator chose this over
  Overpass for exactly our pain points). New deps: `pmtiles`, `flatbush` (owner-approved).
- *Fallback:* Overpass QL (`nwr["building"]`, bbox then circle-crop client-side), knowing
  the costs: multipolygon reassembly, ~3–20 % height-tag coverage (levels×3 m else 8 m
  default), and big-metro queries needing tile-splitting.

Pipeline either way: fetch once at handoff → compose `building_top = terrain_height_at_
footprint + AGL_height` **at fetch time** (OSM/Overture heights are above-ground — datum
trap) → `flatbush` bbox index → exact point-in-polygon (~10 lines, no turf.js) on the few
candidates per tick → altitude test. Render as batched extruded `PolygonGeometry`
primitives (tens of thousands OK; `GroundPrimitive` cannot extrude; Cesium OSM Buildings
needs Ion and is out).

**Tile warming** — Cesium has no native path prefetch (open request cesium#7987). A small
warmer periodically requests terrain samples + imagery along the velocity vector ~10–30 s
ahead. Physics never depends on imagery; a fast jet on the deck sees late-sharpening
tiles, honestly.

## 7. View & camera

- FPV: `camera.setView({destination, orientation:{heading,pitch,roll}})` each render frame
  from a **low-pass-filtered copy** of sim attitude (~5–15 Hz cutoff) + eye point offset
  ahead/above CG — cockpit feel, not bolted security camera. Raw physics stays unfiltered.
- `screenSpaceCameraController.enableInputs = false` while flying (it fights `setView`).
- Chase cam toggle (external view) in Phase E.
- Own aircraft + live traffic + ghost render via reused Billboard/Label collections mutated
  in place — the primitive-churn lesson LORAN's `aircraftLayer.ts` already paid for.
  No `Entity`/`CallbackProperty` at 60 Hz.
- Imagery: Esri World Imagery (keyless, attribution required). No documented rate limit ≡
  no quota to budget against; sustained low-level flight may draw throttling — degrade
  honestly (Cesium falls back to parent tiles; never fake tiles).

## 8. Input (desktop v1)

Normalized control vector `{pitch, roll, yaw, throttle, flaps, gear, airbrake?}` behind an
interface; keyboard+mouse is the only v1 implementation. Later touch/tilt implements the
same interface (tilt additionally requires HTTPS — deliberately out of scope).

| Input | Action |
|---|---|
| Mouse (hold LMB or pointer-lock toggle) | pitch/roll stick |
| Arrow keys | stick alternative |
| `W`/`S` or `+`/`-` | throttle |
| `A`/`D` | rudder |
| `F`/`V` | flaps down/up (per-class detents) |
| `G` | gear |
| `Shift` (fighter) | afterburner toggle |
| `C` | chase cam (Phase E) |
| `Esc` | quit to browse |

## 9. HUD

Monospace, translucent, bracket corners — LORAN visual language. Elements: IAS + TAS,
altitude (ft) + VSI tape, heading tape, AoA, g readout, throttle %, flap/gear state,
class + synthetic callsign, `SIM` banner, stall / overspeed / terrain-proximity warnings,
attribution line (Esri · Re:Earth Terrain · Mapterhorn CC BY 4.0 · Overture/OSM when
buildings active).

## 10. Backend

FastAPI, copied-then-trimmed from LORAN (MIT, same author): the readsb-schema normalizer,
airplanes.live → adsb.lol → adsb.fi failover, 1 req/s discipline, short cache.
Endpoints: `GET /api/adsb?viewport=…` and `GET /api/type/{hex}` (adsbdb, cached, for
class mapping). No photos, no geocoding, no recorder. `.env` for all URLs/limits.

## 11. Build order (stop and wait for sign-off after each phase)

- **A — Scaffold + browse:** repo plumbing, backend proxy, live display, picker.
- **B — Sim core:** pure-TS 6-DOF + three parameter sets; unit tests assert published
  performance envelopes (C172 cruises ~122 kt at 75 %, 737 tops out near Vmo, fighter
  T/W and roll rate in range; stall speeds within a few knots of book values). No rendering.
- **C — FPV:** terrain provider, damped cockpit camera, HUD, handoff moment, ground
  collision with the three defenses. **First flyable build.**
- **D — Buildings:** PMTiles-vs-Overpass spike, bubble fetch, extrusion, collision.
- **E — Polish:** ghost aircraft, chase cam, richer crash stats, tile warmer, structural
  overspeed failure (owner decision), input-layer groundwork for touch.

## 12. Non-goals (v1)

No multiplayer. No scoring/leaderboards. No weather/wind. No fuel model. No sound. No
ground operations (taxi/takeoff — airborne spawn only; ground contact ends the session).
No air-to-air collision. No mobile controls (interface reserved). No recording/replay.
No AI traffic — every other aircraft shown is real.

## 13. Risks & open questions

| Risk | Stance |
|---|---|
| Re:Earth terrain is best-effort, may rate-limit | documented fallback: Cesium ion free tier; terrain provider behind one module |
| Esri throttling under sustained low-level flight | degrade honestly; client cache; accept blur |
| Overture PMTiles hosting/extract availability | Phase D opens with the spike; Overpass fallback fully specified |
| Fighter (F-5/T-38) numbers not yet source-verified | Phase B verification task before tuning |
| `getHeight()` LOD coarseness vs "buzzing the deck" | accepted: crash detection is honest at ~zoom-14 resolution; documented |

## 14. Dependencies (owner-approved 2026-07-27)

CesiumJS, React 18, Zustand, Tailwind (layout only), Vite, FastAPI, httpx — inherited
stack. New for this project: `pmtiles`, `flatbush`. Anything further: ask first.
