# Buildings bubble: Overpass vs Overture — research notes

Research-agent output, 2026-07-27, lightly trimmed. Goal: solid buildings in a ~25 km
bubble around the spawn point; fetch once per session, extrude client-side, collide in the
physics loop.

## Overpass path (the fallback)

Query — use `nwr` to catch ways and multipolygon relations in one pass:

```
[out:json][timeout:180][maxsize:536870912];
nwr["building"](around:25000,30.6944,-88.0399);
out geom;
```

- Prefer a **bbox** filter over `around:` at this radius (distance evaluation is slow);
  crop to the circle client-side with a haversine check.
- `out geom` does **not** pre-merge multipolygon relations — inner/outer ring assembly
  (osmtogeojson or equivalent) is a real pipeline step, not an afterthought.
- Size (back-of-envelope, unmeasured): Mobile-scale ≈ 20k–60k footprints, 15–40 MB JSON.
  Houston-scale downtown ≈ 300k–700k footprints, 250–600+ MB — territory where whole-city
  pulls have OOM'd the public server's default memory ceiling. One-shot works for
  small/mid cities; big metros need 2×2 (or recursive) bbox splitting + merge-dedupe.
- Rate limits: overpass-api.de courtesy guideline "under 10k queries/day and under
  1 GB/day". One fetch per session is trivially fine. Mirrors in priority order:
  overpass-api.de → overpass.private.coffee → overpass-api.kumi.systems. Self-hosting
  (e.g. `wiktorn/overpass-api` Docker) is the honest long-term answer if usage grows.

## Height-data reality (why Overture is preferred)

- `height` tag: ~3 % of buildings globally, ~10–20 % in the US. `building:levels`:
  ~4.6 % globally. NYC is the big exception (2013–14 import carried real heights).
- Standard heuristic when absent: `levels × 3 m`; neither tag → flat default in the
  6–10 m band. Outside a few cities, **the default is the norm, not the exception.**
- Overture Maps fuses ML-estimated heights (Microsoft/Google building datasets) on top of
  OSM, and ships pre-merged polygons — materially better on both pain points.

## Overture PMTiles path (preferred; Phase D spike confirms)

Prior art: **osm-drone-simulator** (OlivierB-OB, browser drone sim, Three.js, 60 fps
target) fetches buildings from **Overture PMTiles** instead of Overpass — no server, no
rate limit, IndexedDB caching, ring-buffer tile loading around the vehicle. Its collision
story is undocumented — read the source before assuming feature parity; the data pipeline
is transferable regardless. Spike must also settle *which* PMTiles source: an existing
hosted Overture buildings PMTiles vs building our own extract.

## Cesium extrusion at scale

- Entity API degrades hard (~10k polygon entities = massive drop, community-reported).
- Batch many `PolygonGeometry` instances (with `extrudedHeight`) into few `Primitive`s —
  geometry combining runs on a web worker; tens of thousands of static extrusions are fine.
- **`GroundPrimitive` cannot extrude** — `extrudedHeight` is explicitly not rendered on it.
  Use regular `Primitive` and position bases yourself.
- Cesium OSM Buildings (Ion 3D Tiles): needs token, 15 GB/month free-tier streaming a
  flight sim would chew through, non-commercial terms, not self-hosted. Out.

## Collision testing

- Static session-frozen set → **flatbush** (static R-tree; faster build/query, lower
  memory than rbush, which only wins if the set mutates).
- Two-stage per tick: bbox range query (a handful of candidates) → exact point-in-polygon
  (ray casting, ~10 lines, no turf.js) → altitude test. Index build sub-second at
  10k–100k footprints; per-frame cost microseconds.
- **Datum trap:** OSM/Overture heights are **above ground**, so
  `building_top_ellipsoid = terrain_height_at_footprint + AGL_height`. Sample terrain per
  footprint (centroid is acceptable; slopes introduce real error) **once at fetch time**
  and cache it — never per frame.

## Other prior art

- kristoffer-dyrkorn/flightsimulator — browser sim, heightmap terrain, useful for
  loop/rendering structure, no building collision.
- osm2city / OSM2World — FlightGear scenery tooling; the most mature height-heuristic and
  roof-geometry reference (read for constants, not code).
- harp.gl / xyz-threejs `AnimatedExtrusionHandler`; osmbuildings.org — extrusion-at-scale
  references, not collision-focused.
