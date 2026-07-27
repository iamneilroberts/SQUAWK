# Cesium 1.119+ flight-sim engineering notes

Research-agent output, 2026-07-27, lightly trimmed. Context: keyless Cesium, Esri World
Imagery, Re:Earth quantized-mesh terrain (`quantized-mesh-1.0`, TMS/EPSG:4326, zoom 0–14,
ellipsoidal heights per its `layer.json`), 60 Hz sim loop driving an FPV camera.

## 1. First-person camera each frame

- `camera.setView({ destination, orientation: { heading, pitch, roll } })` — HPR in plain
  radians in the local ENU frame; no manual quaternion math needed. No documented perf
  problem at 60 Hz — the per-frame cost is tile selection, not the camera call.
- Keep the aircraft's attitude state as a **quaternion** internally; raw HPR state has the
  usual pitch ±90° singularity. Convert at the render boundary
  (`Transforms.headingPitchRollQuaternion(origin, hpr)` if a quaternion is needed for a
  model too).
- Community threads ("Cockpit view for flight simulation", "Camera first person view")
  show roll drift when the default controller and `setView` fight — set
  `viewer.scene.screenSpaceCameraController.enableInputs = false` in cockpit mode.
- Cockpit feel vs bolted-camera feel (standard sim technique, not a Cesium API):
  eye-point offset from CG in body frame; low-pass (~5–15 Hz) the **camera's** copy of
  attitude while physics stays raw; small spring-damped translation lag.

## 2. Terrain height for collision

- `scene.globe.getHeight(cartographic)` — **synchronous**, returns `number | undefined`.
  Reads whatever tile is currently resident at the globe's current LOD selection;
  `undefined` before tiles load.
- `sampleTerrainMostDetailed(provider, positions)` — async, walks to max available LOD,
  needs network round-trips; not viable inside a 60 Hz tick.
- Pattern: `getHeight()` every tick, but never treat `undefined` as "no ground" — carry
  the last known good sample; periodically fire async backfill for current + predicted
  position; after any teleport treat ground as unverified and clamp conservatively until
  defined samples arrive.
- Known gnarly bug: **cesium#5999** — camera jumps hundreds of meters after terrain
  finishes loading (`Camera.suspendTerrainAdjustment` interplay). Drive height entirely
  from own physics + cached samples, never from Cesium's camera terrain-following.

## 3. Tile prefetching along a predicted path

- **No native support.** `Cesium3DTileset.preloadFlightDestinations` is 3D-Tiles-only.
  Open feature request: **cesium#7987** ("Preload terrain and imagery tiles").
- Tile selection prioritizes the current view; no lookahead bias exists to lean on.
- DIY technique: periodically request terrain samples / imagery for points seconds ahead
  along the velocity vector so HTTP fetch + decode is in flight before arrival. (A hidden
  second camera to bias the quadtree traversal is unverified — don't design around it.)
- Outrunning tiles at low altitude looks like: coarser mesh faceting, blurred
  parent-imagery until the right LOD lands (never blank), occasional pop-in; reported
  terrain holes during fast pans (cesium-native#269). Physics must not depend on it.

## 4. Esri World Imagery

- Max LOD 23 (~0.019 m/px nominal); real source resolution 0.3–1 m depending on region —
  deep zooms are upsampled parent data in most places.
- No documented rate limit for the keyless tile endpoint — which also means no quota to
  budget against and no contractual protection. A fast low camera churns tiles far harder
  than a map user; cache aggressively, accept throttling gracefully if it comes.

## 5. requestRenderMode

Use **continuous rendering** (default). Explicit-render mode is designed for mostly-static
scenes (idle CPU savings); Cesium's own guidance says it's unsuitable for continuous
animation — a sim would call `requestRender()` every tick anyway, reinventing continuous
mode with extra failure modes. Unambiguous.

## 6. Entity vs primitive at 60 Hz

- Entity/`CallbackProperty` machinery has repeated community reports of collapse under
  per-frame dynamic load (down to 0 FPS with many callbacks; evaluation frequency
  uncapped). Cesium's own Entity-perf fix was dirty-flagging for *mostly-static* content —
  the opposite of a sim where everything moves every frame.
- LORAN's `aircraftLayer.ts` learned this at 30 Hz: rebuild-per-frame sat at 25–30 FPS;
  the fix was reused Billboard/Label/Polyline collections keyed by ICAO hex, mutated in
  place, add/remove only on membership change. Extend exactly that pattern to the own
  aircraft, ghost, and traffic at 60 Hz. **No entities for moving objects.**

## Sources

Cesium Camera ref-doc · Cesium camera learn guide · community threads "Cockpit view for
flight simulation" (16069), "Camera first person view" (13543), "Terrain height in Cesium"
(22705) · cesium-dev threads on altitude/collision · GitHub cesium#5999, cesium#7987,
cesium-native#269 · Esri World Imagery service metadata (LOD table) · Cesium blog:
"Improving Performance with Explicit Rendering" (2018-01), "Entity API Performance"
(2018-06) · community thread "Using multiple CallbackProperty kills performance" (10608) ·
terrain.reearth.land layer.json (fetched directly).
