# Phase B — "First Flyable" design (spec delta)

**Date:** 2026-08-05 · **Status:** owner-approved direction, spec under review
**Parent spec:** `2026-07-27-adsb-game-design.md` (all sections apply unless amended here)
**Design review:** Opus 4.8 subagent feasibility review 2026-08-05; all red-flag
mitigations folded in below.

## 1. Owner decisions (this phase)

| # | Decision | Supersedes |
|---|---|---|
| B-1 | **Merge spec phases B+C into one "first flyable" phase.** Headless sim core AND terrain/FPV/HUD/handoff/collision ship together. | Spec §11 B/C split |
| B-2 | **C172S GA piston only.** Airliner + fighter params, and F-5E/T-38 source verification, are a future enhancement. | — |
| B-3 | **Takeover is restricted to GA-class contacts** this phase. Airliners, military, etc. are a future enhancement. Eligibility gate below (§4). | Reopens a minimal slice of the deferred type→class map |
| B-4 | **Minimal ghost ships now** (CLAUDE.md ground rule 2 honored literally): the real contact keeps polling and rendering after takeover, dimmed, with honest staleness labels. | Spec §11 put ghost in E |
| B-5 | **End card allows orbiting** the impact/landing site (Cesium default mouse controls re-enabled behind the stats card). | "Freeze frame" reading of spec §5 |

Everything else stands as specced: honest-data rule, keyless Cesium, Re:Earth
ellipsoidal terrain (ion fallback), desktop keyboard/mouse, LORAN visual language,
no per-class branches, fixed 60 Hz, SI internal, ports 8020/8021.

## 2. Scope

**In:** pure-TS 6-DOF sim core + `params/c172.json` · envelope unit tests ·
take-controls handoff (eligibility gate, snapshot, spawn clamp, handoff card,
3-2-1 countdown) · FPV camera · HUD · terrain-everywhere collision ·
minimal ghost · live traffic as scenery while flying · pause overlay ·
quit-to-browse · end classification + stats card with orbit.

**Out (deferred, logged):** buildings + building collision (D) · airliner/fighter
params + full type→class mapping + manual class override · chase cam · tile
warmer · structural overspeed failure · fly-again/respawn (ENDED → BROWSE only) ·
time acceleration · wind/turbulence (all E/backlog).

## 3. Module structure

Minimal delta on Phase A layout (keep `globe/`; no parallel `render/`):

```
frontend/src/
  sim/       pure TS, ZERO Cesium imports. Fixed 60 Hz accumulator, body→ECEF
             quaternion attitude, ISA atmosphere, lift/drag/thrust from params.
             In: control vector. Out: state (pos, vel, attitude, IAS/TAS/AoA/g).
  params/    c172.json (the only class file this phase) + ga-types.json
             (GA-piston designator allowlist for the takeover gate).
  input/     window-level keydown/keyup → held-key Set → normalized control
             vector {pitch, roll, yaw, throttle, flaps, gear, trim} sampled
             once per tick. preventDefault on game keys; Set cleared on blur.
  takeover/  eligibility predicate + snapshot + buildSpawnState (pure).
  world/     terrain height service behind one swappable module; injectable
             getHeight so it unit-tests with zero Cesium imports (G-003 datum).
  game/      mode state machine BROWSE → COUNTDOWN → FLYING → PAUSED → ENDED,
             end classification, stats accumulation.
  hud/       exported pure formatters + dumb JSX overlay (LORAN aesthetic).
  globe/     existing; gains FPV camera driver + ghost styling.
```

**Sim state lives in a mutable object/ref, NOT zustand** — 60 Hz `set()` would
re-render React. Zustand holds only `mode`, `origin`, `endStats`; HUD reads a
~10 Hz snapshot. Sim loop must be StrictMode double-mount safe.

**Viewer + polling ownership hoists from `BrowseGlobe` to an App-level owner.**
BROWSE/FLYING/ENDED are modes on ONE Cesium Viewer; polling continues in all
modes (ghost + live traffic depend on it). Terrain provider attaches at **app
start**, not at takeover (mid-session swap = full reload + camera jump).

## 4. Takeover

**Eligibility gate (all must hold; disabled button states which gate failed):**
- feed `t` (ICAO type designator) present AND in the GA-piston designator list
  (`params/ga-types.json` — data file, not code branches)
- NOT military (`dbFlags & 1`)
- `alt_baro !== "ground"`, `seen_pos ≤ 15 s`, non-null `gs`/`track`/altitude

**Snapshot:** frozen `origin: {hex, snapshot}` copied into session state at
takeover — independent of `selectedHex` (store may null the selection when the
contact leaves the feed). Never dead-reckon a stale position.

**Spawn:** pure `buildSpawnState(contact, params)` — units converted, altitude
preferred from `alt_geom` (ellipsoidal, same datum as terrain). If only
`alt_baro` (pressure) is available: clamp to terrain + 300 m and label it. As a
safety net, altitude ≤ service ceiling and IAS clamped into `[1.3·Vs, 0.9·Vne]`;
**every adjustment is returned in an `adjustments[]` list and displayed verbatim
on the handoff card.** Clamping a synthetic aircraft is legal; silent clamping
is not.

**Handoff card + countdown:** card shows snapshot values, real type, "C172
MODEL THIS BUILD", and any adjustments. The 3-2-1 countdown is **load-bearing**:
during it, `await sampleTerrainMostDetailed(provider, [spawn, spawn+10 s])`;
enter FLYING only on a defined sample, or on timeout with collision disarmed
and an honest `TERRAIN UNVERIFIED` HUD flag.

## 5. Sim core

Per parent spec §3–§4 (lift `½ρV²S·CL(α)` with soft post-stall rolloff,
parabolic polar, per-axis rate damping, power-limited thrust `T=η·P/V`, ISA,
still air), plus review mitigations:

- Attitude is a **body→ECEF quaternion**; integrate body rates on it,
  renormalize each step; convert to HPR only at the Cesium boundary. Do NOT
  integrate in a fixed ENU frame (heading drift, high-latitude breakage).
- Gravity from `Ellipsoid.WGS84.geodeticSurfaceNormal(position)` per step, not
  radial. Coriolis/transport rate explicitly ignored (documented).
- Loop driven from one rAF (or `scene.preRender`) with `performance.now()`;
  **clamp dt ≤ 0.25 s (max 15 steps/frame)**; auto-pause on `visibilitychange`.
  Persistent clamping shows an honest `SIM RATE 0.7×` indicator, never a silent
  slowdown.
- Elevator trim (2 keys) included — level flight is miserable without it.
- Limits clamp+warn only (no structural failure this phase), per parent spec.

## 6. Camera, HUD, ghost

- FPV: `camera.setView` each frame from a low-pass-filtered (5–15 Hz) copy of
  sim attitude; eye offset from CG; `screenSpaceCameraController.enableInputs =
  false` while FLYING; `frustum.near ≈ 1 m`;
  `scene.globe.depthTestAgainstTerrain = true`.
- **Esc = PAUSE overlay** (RESUME / QUIT buttons). Esc exits pointer lock
  anyway and Chrome rate-limits re-lock, so pause is the only honest Esc
  semantic; resume requires a canvas click. QUIT returns to BROWSE with no
  residue: camera controls re-enabled, browse camera restored, origin cleared.
- HUD per parent spec §9 (IAS/TAS, alt+VSI, heading tape, AoA, g, throttle%,
  flap/gear, class+callsign, SIM banner, stall/overspeed/terrain warnings,
  attribution). C172 additions: gear reads `FIXED`; flaps 0/10/20/30 detents;
  `SIM RATE` indicator.
- Contacts render at `alt_geom` (ft→m; skipped when null) — Phase A drew them
  at height 0, which is buried under real terrain. Ghost = the origin
  contact's live billboard, dimmed, labeled `GHOST · AGE 34s` (or `NO DATA`
  when the feed is STALE/OFFLINE). Other live traffic stays visible as scenery.

## 7. End of session

Terrain contact (sim altitude ≤ sampled terrain height) ends the session.
Classification per parent spec §5 thresholds (sink < 600 fpm + near-level +
< 1.3 Vs = LANDED, else CRASHED). ENDED state: stats card over the scene with
**orbit enabled** (default mouse controls back on). Stats fields: airtime,
distance flown, max IAS, max altitude, max g, impact sink rate + speed,
classification. Exit → BROWSE.

## 8. Test surface (unit, no new deps)

- Envelope: C172 cruises ~122 kt @ 75%, Vs1 ≈ 48 KIAS, Vne behavior, g clamp.
- `buildSpawnState`: units, clamps, adjustments list; alt_baro fallback path.
- Eligibility predicate + failure reason (shared by button + tooltip).
- LANDED/CRASHED table incl. exact-600 fpm, bank, flap-dependent Vs boundaries.
- Key-set → control vector: simultaneous keys, blur clear, throttle ramp.
- Accumulator vs synthetic dt sequence incl. 30 s gap (step count capped).
- Quaternion: 360° roll → identity; 60k-step normalization drift; HPR
  round-trip at ±89° pitch; 4 known attitudes pin Cesium HPR sign conventions.
- ISA density vs table; terrain service with injected `getHeight`
  (last-known-good, undefined, spawn grace); HUD formatters (fpm, 359→000, —).
- HUD tested as pure formatters + dumb JSX (no jsdom/testing-library dep).

## 9. Acceptance (show it running, then stop for sign-off)

`bash scripts/dev.sh` → pick a real GA contact → TAKE CONTROLS → handoff card
shows honest snapshot → countdown preloads terrain → fly the C172 by keyboard
over real imagery with HUD + ghost → land or crash → stats card, orbit the
site → QUIT → clean BROWSE. All unit tests green; screenshot for sign-off.
