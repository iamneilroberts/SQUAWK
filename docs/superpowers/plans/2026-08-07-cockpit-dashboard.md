# Cockpit Dashboard + Traffic View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the flying C172S a real cockpit: an analog six-pack driven by the sim's own ~10 Hz snapshot, a collapsible bottom instrument strip, screen-anchored tags on live ADS-B traffic crossing the windscreen (click → a detail card with feed + adsbdb fields), a PPI radar scope showing those same real contacts, honest chrome-only weather/ATC placeholders, a controls-help panel generated from the real `KEYMAP`, and two view toggles — place/airport labels and a SAT↔CHART basemap swap — that keep the attribution line truthful.

**Architecture:** A new `dashboard/` component family holds pure math modules (`gaugeMath.ts`, `geoRange.ts`, `trafficProjection.ts`, `radarMath.ts`) and dumb SVG/JSX views that consume them; every one of those modules is Cesium-free and unit-tested. The only Cesium the feature touches lives in `globe/`: `TrafficOverlay.tsx` (a thin `SceneTransforms.worldToWindowCoordinates` adapter that injects a `project` function into the pure projection module), `labelLayers.ts` (place/airport labels) and `basemap.ts` (imagery-layer swap). Everything the instruments read comes from the existing ~10 Hz `hudSnapshot` observer or from the zustand contact store — never from 60 Hz sim internals, and never from zustand at sim cadence.

**Tech Stack:** Vite · React 18 + TypeScript · CesiumJS 1.143 (keyless) · Zustand · Tailwind (layout only) + hand-written `styles/tokens.css` · vitest (node environment, no jsdom). Backend unchanged — the only endpoint consumed is the Phase A `/api/type/{hex}`. **No new dependencies.**

## Global Constraints

- **Honest-data rule (verbatim, CLAUDE.md ground rule 1):** *The only synthesized object is the player's aircraft. Live contacts are real or absent; feeds down = explicit offline state; unknown fields render as em-dash (—). Never mock, sample, or synthesize feed data to make a screen look finished.* In this feature that means specifically:
  - **The weather and ATC panels are chrome only.** They render the LORAN panel frame and the literal empty state `NO FEED · FUTURE INTEGRATION` plus a one-line statement of what feed is planned. No sample METAR, no sample radar image, no sample transmission, no placeholder numbers, no lorem text. A test asserts the rendered text of both panels contains **no digits at all**.
  - Radar blips and windscreen tags appear and disappear exactly with the feed. `feedStatus === "offline"` → the scope shows an explicit `RADAR OFFLINE · NO FEED` state; `stale` → `FEED STALE · BLIPS FROZEN`. Never an empty-but-nominal scope.
  - Detail-card fields the feed or adsbdb lack render as `—` (`EM_DASH` from `hud/format.ts`), and an adsbdb record that is entirely null reads `NO ADSBDB RECORD`, an adsbdb request that failed reads `ADSBDB UNREACHABLE`. Those are three different states and must not be collapsed into one.
  - Gauges never invent a reading. Anything outside a gauge's scale comes back from `gaugeMath` with `pegged: true` so the needle draws against the stop; a null snapshot renders em-dashes, not zeros.
- **LORAN visual language:** near-black `#05070a`, amber `#ffb000` (SIM accent + warnings), cyan `#5fd7e0` (nominal data), `--grid` `#1a222c` borders, monospace, uppercase letterspaced labels, 1px borders, bracket corners (`.panel`), translucent panels, no rounded corners > 2px, no shadows, no gradients. Every new colour comes from an existing `styles/tokens.css` variable — no new hex literals in components.
- **No new npm dependencies.** Gauges, radar and tags are hand-rolled SVG. The airports dataset is a **bundled static data file** (`frontend/src/data/airports-world.json`) generated **once** by a documented script (`scripts/fetch-ourairports.sh`) and committed — it is never fetched at runtime, and the CSV is never parsed in the browser. `git diff --stat main -- frontend/package.json` must show zero dependency lines added.
- **Keyless Cesium.** `Ion.defaultAccessToken = null` stays. Both new imagery layers are keyless ArcGIS REST services, used at these exact URLs:
  - `SAT` basemap (unchanged): `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer`
  - `CHART` basemap (new): `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer`
  - Places reference layer (new): `https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer`
- **Zero Cesium imports outside `globe/`.** `dashboard/`, `sim/`, `world/`, `input/`, `takeover/` stay Cesium-free. Gauge math, polar/radar math, world→screen projection math and declutter logic are all pure modules that take injected functions or plain numbers. The done-list carries a grep that fails the task if this slips.
- **Instruments read the ~10 Hz snapshot or the store — never 60 Hz sim internals.** `hudSnapshot` is the single bridge (`useSyncExternalStore`), exactly as the HUD uses it. No component subscribes to `scene.preRender`, and nothing calls into `flightLoop`'s closure state. Windscreen tags recompute on snapshot identity change (~10 Hz), not per frame.
- **Zustand stays small.** Phase B capped the store at `mode` / `origin` / `endStats` for session state; that cap holds for session state. This phase adds exactly two **view preference** fields — `basemap` and `labelsOn` — because the toggles live in `StatusBar`, which is a flex sibling of `ViewerHost` and cannot read `viewerContext`. They change at human cadence (a click), never per frame. Panel-collapse state is deliberately **not** in the store (see Task 2's justification).
- **StrictMode double-mount safe.** Every new effect that adds an imagery layer, a label, a listener or a timer removes exactly what it created in its cleanup, so React 18's development double-invoke leaves one live instance. Imagery-layer effects guard with an `appliedRef` so a re-invoke does not stack layers.
- **No jsdom, no `@testing-library/*`, no new test tooling.** Components are tested by **calling them as functions and walking the returned element tree** with the established `collectText` helper (copied per test file — that is the repo's existing convention, see `hud/Hud.test.tsx` and `panels/HandoffCard.test.tsx`). **A component that calls hooks cannot be tested this way** (React throws "Invalid hook call" outside a renderer), so every hook-ful component in this plan is split: hooks in the container, all rendering in an exported hook-free child or an exported pure helper. `panels/StatusBar.test.ts` is the precedent.
- **Suites stay green.** Baseline verified 2026-08-07 on branch `hindustanis`: **frontend 410 passed across 35 files**, **backend 21 passed**. Every task ends with the full frontend suite green, `npm run typecheck` clean, and the backend suite untouched and still green.
- **Attribution updates with the active layers.** One builder, `globe/mapSources.ts`'s `attributionFor()` (a deliberately Cesium-free module, so `StatusBar` and `Hud` can call it), produces the line for both the status bar and the HUD. Switching basemap or turning labels on changes that line in both places within the same render. Esri credit in Cesium's own credit container stays visible and unhidden.
- **Each task ends with the full suite green and exactly ONE commit.** Intermediate TDD cycles inside a task end at a passing run, not at a commit — the commit is the task's last step. (This resolves the two readings of "commit after every cycle" vs "one commit per task" in favour of one reviewable commit per task.)
- Append a dated entry to `docs/decisions.md` for every non-obvious call — this phase's entries are numbered **CD-001 … CD-010** ("cockpit dashboard"), continuing the `G-00x` / `B-0xx` convention. Steps below say exactly when.
- No absolute paths in tracked files. **Stop and wait for owner sign-off at the end of Task 6** (CLAUDE.md ground rule 5).

## Source documents

- **This phase's spec (authoritative):** `docs/superpowers/specs/2026-08-07-cockpit-dashboard-design.md` (D-1 … D-8)
- Parent phase spec (all rules carry forward): `docs/superpowers/specs/2026-08-05-phase-b-first-flyable-design.md`
- Founding spec: `docs/superpowers/specs/2026-07-27-adsb-game-design.md` §9 (HUD), §14 (dependency list)
- Carried decisions: `docs/decisions.md` — G-003 (ellipsoidal datum), B-013 (numeric readouts, tape deferred), B-014 (contacts at `alt_geom` only; ghost never fakes freshness), B-015 (StatusBar's prop bridge, overlay pointer-events)

## Test runner reality (verified against `frontend/package.json`, 2026-08-07)

| What | Command |
|---|---|
| Install deps (fresh clone only) | `cd frontend && npm ci` |
| Full frontend suite | `cd frontend && npm run test` (= `vitest run`) |
| One file | `cd frontend && npm run test -- src/dashboard/gaugeMath.test.ts` |
| Typecheck | `cd frontend && npm run typecheck` (= `tsc --noEmit`) |
| Backend suite (must stay green, unchanged) | `cd backend && .venv/bin/python -m pytest tests/ -q` |
| App | `bash scripts/dev.sh` → http://localhost:5173 |

vitest runs in the **node** environment. Consequences already baked into the codebase and into this plan: no module may touch `document` at import time; Cesium itself imports fine in node (`globe/contactBillboards.test.ts` proves it), so a `globe/` module with a Cesium import is still unit-testable as long as it does not construct a `Viewer`.

**Baseline to protect: 410 frontend tests across 35 files, 21 backend tests.** Verified before Task 1 starts.

## File structure added by this phase

```
frontend/src/
  dashboard/
    gaugeMath.ts          pure needle/arc/ball math for the six-pack (deg CW from 12)
    SixPack.tsx           six dumb SVG dials (hook-free)
    PanelFrame.tsx        collapsible LORAN panel frame (hook-free)
    DashboardStrip.tsx    the strip container (hooks) + exported pure state helpers
    ControlsHelp.tsx      KEYMAP -> grouped help rows (hook-free) + groupKeymap/keyLabel
    WeatherPanel.tsx      chrome only: NO FEED · FUTURE INTEGRATION
    AtcPanel.tsx          chrome only: NO FEED · FUTURE INTEGRATION
    geoRange.ts           great-circle range/bearing (shared by tags + radar)
    trafficProjection.ts  contacts + injected world->screen fn -> decluttered tags
    TrafficTags.tsx       DOM tags over the canvas (hook-free) — the testable half of the overlay
    TrafficDetailCard.tsx fetch container (hooks) + exported hook-free TrafficDetailBody
    radarMath.ts          own-ship-centred heading-up polar projection, rings, cull
    RadarScope.tsx        SVG PPI scope + range selector (hook-free)
  data/
    contactGeo.ts         contactHeightM, MOVED out of globe/ so dashboard/ can stay Cesium-free
    airports-world.json   GENERATED, committed: OurAirports large+medium extract
    airports.ts           typed loader + schema guard + pure camera-height declutter
  globe/
    mapSources.ts         CESIUM-FREE: the three keyless URLs + attributionFor() builder
    TrafficOverlay.tsx    SceneTransforms adapter (thin) -> dashboard/TrafficTags
    labelLayers.ts        Esri Places layer + airport LabelCollection sync
    basemap.ts            SAT/CHART imagery swap
    OverlayLayers.tsx     store toggles -> basemap.ts / labelLayers.ts, camera listener
scripts/
  fetch-ourairports.sh    one-time generator for airports-world.json (documented, not runtime)
```

`globe/mapSources.ts` and `dashboard/TrafficTags.tsx` are the two files the task skeleton did not
name. Both exist for the same reason: they are the parts of a `globe/` feature that carry no
Cesium, and separating them is what lets `StatusBar` print a credit line without importing Cesium
and what lets the windscreen tags be tested without a live `Scene`. Both are justified in place
(Task 3 preamble, Task 5 preamble).

Modified: `sim/quat.ts`, `sim/quat.test.ts`, `sim/types.ts`, `sim/params.ts`, `sim/params.test.ts`, `params/c172.json`, `hud/snapshot.ts`, `hud/Hud.tsx`, `hud/format.test.ts`, `hud/Hud.test.tsx`, `game/flightLoop.ts`, `game/flightLoop.test.ts`, `game/FlightSession.tsx`, `globe/contactBillboards.ts`, `input/controls.ts`, `input/controls.test.ts`, `data/api.ts`, `data/types.ts`, `state/store.ts`, `state/store.test.ts`, `panels/StatusBar.tsx`, `panels/StatusBar.test.ts`, `App.tsx`, `styles/tokens.css`, `README.md`, `docs/decisions.md`, `docs/summaries/phase-b-acceptance-runbook.md`, `docs/summaries/CHECKLIST.md`.

Two of those are moves rather than edits and are called out where they happen: `sim/quat.ts` gains a `turnRateRadS` helper (Task 1 step 4) and `globe/contactBillboards.ts` gives up `contactHeightM` to a Cesium-free module and re-exports it (Task 3 step 5). **Not** modified: `sim/aircraft.ts`, `sim/forces.ts`, `sim/integrator.ts`, `takeover/`, `world/`, and the whole backend.

## Spec requirement map — every D-1 … D-8 clause to a step

| Spec clause | Requirement | Task.Step |
|---|---|---|
| D-1 | bottom cockpit strip | 2.7 (`DashboardStripBody`), 2.15 (wired into `FlightSession`) |
| D-1 | six-pack left, radar centre, weather/ATC right, help at the edge | 2.7, 4.11 (radar slot between them) |
| D-1 | each panel individually collapsible | 2.7 (`PanelFrame` + `togglePanel`), 2.5 (tests), 2.13 (`PanelFrame` test) |
| D-1 | whole strip toggles | 2.3 (`KEYMAP.KeyC`), 2.7 (`toggleStrip`/`stripKeyAction`), 2.5 (tests) |
| D-2 | analog six-pack, SVG, LORAN line style | 1.20 (`SixPack.tsx` + tokens.css), 1.18 (tests) |
| D-2 | ASI incl. white/green/yellow arcs and the red line | 1.16 (`asiNeedle`/`asiArcs`), 1.12 (Vno/Vfe params), 1.20 |
| D-2 | artificial horizon | 1.16 (`attitudePitchOffsetPx`/`attitudeRollDeg`/`pitchLadderRungs`), 1.20 |
| D-2 | altimeter | 1.16 (`altimeterNeedle`/`altimeterDrum`), 1.20, CD-004 |
| D-2 | turn coordinator + slip ball | 1.4 (`sim/quat.ts` `turnRateRadS`, signed), 1.16 (`turnSymbolBankDeg`/`slipBallOffsetPx`), 1.8 (published), CD-002 |
| D-2 | heading (DG) | 1.16 (`headingCardDeg`), 1.20 |
| D-2 | VSI | 1.16 (`vsiNeedle`), 1.20, CD-005 |
| D-2 | driven by the real ~10 Hz HUD snapshot | 1.6 (failing test on the real `makeLoop`), 1.8 (`publish()` extension), 2.7 (prop) |
| D-3 | any live contact in the FPV frustum gets a screen-anchored indicator | 1.8 (`latDeg`/`lonDeg`), 3.8 (`projectTraffic`), 3.19 (`TrafficOverlay`) |
| D-3 | indicator shows callsign / type / alt | 3.8 (`tagLabel`/`tagTypeLine`/`tagAltLine`), 3.16 (`TrafficTags`) |
| D-3 | click → LORAN detail card | 3.16 (`TrafficDetailBody` + `TrafficDetailCard`), 3.19 (wiring) |
| D-3 | card shows feed fields + `/api/type/{hex}` enrichment | 3.12 (`fetchTypeInfo`), 3.16 |
| D-3 | no synthesis — indicators only for contacts on the live feed | 3.6 (failing test: empty map → no tags), 3.8 (store map is the only source), 3.5 (`contactHeightM` moved, one datum rule) |
| D-4 | PPI range rings, own-ship centred, heading-up | 4.3 (`scopeXY`/`ringsFor`), 4.7 (`RadarScope`) |
| D-4 | selectable range 10/40/80/150/250 NM | 4.3 (`RANGE_PRESETS_NM`), 4.7 (buttons), 4.11 (strip-local state) |
| D-4 | blips are live contacts only | 4.3 (`blipsFor`), 4.1 (empty-feed test) |
| D-4 | feed OFFLINE → explicit OFFLINE state; stale → frozen/dim | 4.3 (`scopeStatus`), 4.7, 4.5 (tests) |
| D-5 | weather + ATC full panel framing, `NO FEED · FUTURE INTEGRATION` | 2.15 (`WeatherPanel`/`AtcPanel`), 2.7 (framed by `PanelFrame`) |
| D-5 | nothing fake ever renders | 2.13 (the no-digits and no-sample-transmission tests) |
| D-6 | collapsible keymap panel generated from the real `KEYMAP` | 2.11 (`groupKeymap`/`keyLabel`/`ControlsHelp`), 2.3 (KEYMAP additions), 2.9 (coverage tests) |
| D-7 | Esri place-names reference layer, keyless | 5.9 (`PLACES_URL`), 5.15 (`applyPlacesLayer`), 5.7 (keyless-URL test) |
| D-7 | bundled OurAirports extract, LORAN-styled Cesium labels | 5.1 (generator script), 5.2 (run it), 5.5 (loader + schema guard), 5.15 (`syncAirportLabels`) |
| D-7 | declutter by camera height | 5.5 (`visibleAirports`), 5.16 (camera listener in `OverlayLayers`) |
| D-7 | off by default; toggle in the status bar | 5.13 (`labelsOn` defaults false + the chip), 5.11 (tests) |
| D-7 | attribution appended when active | 5.9 (`attributionFor`), 5.13 (StatusBar), 5.17 (Hud) |
| D-8 | SAT ↔ CHART basemap toggle, imagery only, terrain unchanged | 5.15 (`applyBasemap`), 5.16 (`OverlayLayers`), CD-010 |
| D-8 | attribution line follows the active basemap | 5.9 (`attributionFor`), 5.7 (tests), 5.13, 5.17 |
| D-8 | both toggles live with the radius chip's pattern | 5.13 (`status-chip-button` beside `radiusChipLabel`) |
| §2 | six-pack/tags read the same snapshot/feed as the HUD | 1.4, 3.18, 4.11 |
| §2 | staleness follows the existing feed-status chip semantics | 4.3 (`scopeStatus`), 3.7 (tags vanish with the contact map) |
| §2 | missing fields render as em-dash | 1.12 (`null` needles + `altimeterDrum`), 3.15 (card `orDash`), 3.7 (tag lines) |
| §3 | collapse state in zustand OR local state, NOT the sim loop | 2.7 + CD-006 (local React state, justified) |
| §3 | `sim/` stays Cesium-free; projection done in the render layer | 3.18, 6.1 (grep guard) |
| §4 | no new deps · no jsdom | Global Constraints, 6.1, 6.2, Definition of done |
| §4 | StrictMode safe | 2.15 (the strip listener's stated add/remove discipline), 5.15/5.16 (`disposeBasemap` restores the base layer; every layer effect removes what it added), 6.8 (checkpoint 24) |
| §5 | acceptance walkthrough | 6.8 (checkpoints 14–25), 6.11 (stop for sign-off) |

---

### Task 1: Gauge math + the six-pack — pure needle mathematics, then dumb SVG

This task also **extends the ~10 Hz snapshot**. The six-pack needs attitude, turn rate, sideslip
and the aircraft's own lat/lon; the sim already computes every one of them each tick, but
`publish()` currently drops them on the floor. Extending the snapshot is the honest fix. Inventing
them in the gauge layer would not be.

**Honesty audit of `hud/snapshot.ts` before writing a line of gauge code** (do this reading first —
it is what decides which instrument faces are real):

| Six-pack element | Sim actually has it? | Where it comes from |
|---|---|---|
| ASI needle | yes | `HudSnapshot.iasMs` (already published) |
| ASI white/green/yellow arcs, red line | **partly** | Vs0/Vs1 are derived from the aero block by `forces.stallSpeedIasMs`; Vne is `limits.vneIasMs`. **Vno and Vfe do not exist in `c172.json`** — added in step 6 as sourced 172S POH numbers, not invented (CD-003) |
| Attitude indicator pitch + roll | yes, unpublished | `hprFromQuat(state.attitude, state.position)` already computes `pitchRad`/`rollRad`; `publish()` throws them away and keeps only heading. Added in step 3 |
| Altimeter | yes | `HudSnapshot.altitudeM` |
| Altimeter barometric setting (Kollsman window) | **no** | The sim has no pressure setting: it flies pure ISA and `altitudeM` is geometric. The window is **omitted entirely** — no `29.92` engraved on the face, because a fixed 29.92 would imply a setting the player can neither read nor change (CD-004) |
| DG (heading card) | yes | `HudSnapshot.headingRad` |
| DG heading-bug | **no** | Nothing sets a bug and nothing flies to one. Omitted — not drawn greyed-out, just absent |
| Turn coordinator rate-of-turn | yes, unpublished | rate of heading change = body rates rotated into ECEF and projected onto local up — **negated**, because body Z points down (step 4's `sim/quat.ts` helper, signed tests). Published as `turnRateRadS` in step 8 |
| Turn coordinator slip ball | **derived, with a caveat** | The sim has no lateral accelerometer, but it *does* have `SimState.sideslipRad`, and in this model the only lateral specific force is `Y = q·S·cyBeta·β` — a strictly monotone function of β with no crosswind, P-factor or engine-torque term. So β **is** what drives this aeroplane's ball. Published as `sideslipRad`, rendered with the face legend `SLIP β` so the pilot knows what is being displayed (CD-002) |
| VSI | yes | `HudSnapshot.verticalSpeedMs` |
| Suction / vacuum flag, gyro spin-up, instrument failure | **no** | Not modelled. No flag is drawn — a permanently-green "GYRO OK" annunciator would be exactly the kind of decoration ground rule 1 forbids |

`latDeg` / `lonDeg` are added in the same step because Tasks 3 and 4 need own-ship position for
range and bearing and there is no second bridge from the sim to React.

The snapshot rows above say "step 8"; the one piece of real arithmetic among them — rate of turn —
gets its own pure function and its own signed tests first, in steps 2–5, because a sign error
there is invisible to any test written with `Math.abs`.

**Files:**
- Create: `frontend/src/dashboard/gaugeMath.ts`, `frontend/src/dashboard/SixPack.tsx`
- Test: `frontend/src/dashboard/gaugeMath.test.ts`, `frontend/src/dashboard/SixPack.test.tsx`
- Modify: `frontend/src/sim/quat.ts`, `frontend/src/sim/quat.test.ts`, `frontend/src/hud/snapshot.ts`, `frontend/src/game/flightLoop.ts`, `frontend/src/game/flightLoop.test.ts`, `frontend/src/hud/format.test.ts`, `frontend/src/hud/Hud.test.tsx`, `frontend/src/sim/types.ts`, `frontend/src/sim/params.ts`, `frontend/src/sim/params.test.ts`, `frontend/src/params/c172.json`, `frontend/src/styles/tokens.css`, `docs/decisions.md`

**Interfaces:**
- Consumes: `HudSnapshot` (`hud/snapshot.ts`); `ClassParams` (`sim/types.ts`); `stallSpeedIasMs` (`sim/forces.ts`); `msToKt`, `mToFt`, `msToFpm`, `radToDeg` (`sim/units.ts`); `EM_DASH`, `formatIasKt`, `formatVsiFpm`, `formatHeadingDeg` (`hud/format.ts`); `hprFromQuat` (`sim/quat.ts`), `enuBasis` (`sim/geo.ts`), `qRotate` (`sim/quat.ts`), `vDot` (`sim/vec3.ts`), `ecefToGeodetic` (`sim/geo.ts`).
- Produces:
  - `sim/quat.ts`: `turnRateRadS(q: Quat, positionEcef: Vec3, ratesBody: Vec3): number` — signed positive-right rate of heading change.
  - `hud/snapshot.ts`: `HudSnapshot` gains `pitchRad: number`, `rollRad: number`, `turnRateRadS: number`, `sideslipRad: number`, `latDeg: number`, `lonDeg: number`.
  - `sim/types.ts`: `ClassParams["limits"]` gains `vnoIasMs: number`, `vfeIasMs: number`.
  - `dashboard/gaugeMath.ts`:
    - `type Needle = { deg: number; pegged: boolean }`
    - `type Arc = { kind: "white" | "green" | "yellow" | "red"; fromDeg: number; toDeg: number }`
    - `ASI_MIN_KT`, `ASI_MAX_KT`, `ASI_START_DEG`, `ASI_SWEEP_DEG`, `VSI_FULL_SCALE_FPM`, `VSI_ZERO_DEG`, `VSI_HALF_SWEEP_DEG`, `AI_PX_PER_DEG`, `STANDARD_RATE_DEG_S`, `TC_SYMBOL_BANK_AT_STD_DEG`, `TC_MAX_SYMBOL_BANK_DEG`, `SLIP_FULL_SCALE_BETA_DEG`, `SLIP_BALL_TRAVEL_PX`, `SLIP_BALL_SIGN`
    - `asiNeedle(iasMs: number | null): Needle | null`
    - `asiArcs(params: ClassParams): Arc[]`
    - `altimeterNeedle(altitudeM: number | null): Needle | null`
    - `altimeterDrum(altitudeM: number | null): string`
    - `vsiNeedle(verticalSpeedMs: number | null): Needle | null`
    - `attitudePitchOffsetPx(pitchRad: number | null): { px: number; pegged: boolean } | null`
    - `attitudeRollDeg(rollRad: number | null): number | null`
    - `pitchLadderRungs(): { deg: number; px: number; label: string; halfWidthPx: number }[]`
    - `headingCardDeg(headingRad: number | null): number | null`
    - `turnSymbolBankDeg(turnRateRadS: number | null): Needle | null`
    - `slipBallOffsetPx(sideslipRad: number | null): { px: number; pegged: boolean } | null`
  - `dashboard/SixPack.tsx`: default export `SixPack({ snapshot, params }: { snapshot: HudSnapshot | null; params: ClassParams })` — **hook-free**.

---

- [ ] **Step 1: Confirm the baseline before touching anything**

```bash
cd frontend && npm run test && npm run typecheck
```

Expected: `Test Files 35 passed (35)`, `Tests 410 passed (410)`, typecheck silent. Then:

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
```

Expected: `21 passed`. If either number differs, **stop** — the plan's per-task expectations are
anchored to 410/21 and a different baseline means the branch is not where this plan assumes.

---

- [ ] **Step 2: Write the failing turn-rate test — the sign is the whole point**

Rate of turn is the one new snapshot field that is not a straight copy, so it gets a pure function
next to the frame math it belongs to rather than three lines buried in `publish()`. **The sign is
easy to get backwards and impossible to notice in a unit test that uses `Math.abs`:** body Z points
**down**, so rotating a body yaw rate into ECEF and dotting it with local **up** gives a *negative*
number for a right turn. Every test below is signed for that reason.

Append to `frontend/src/sim/quat.test.ts` (it already imports `quatFromHpr`, which is what lets
these build an arbitrary attitude):

```ts
describe("turnRateRadS", () => {
  const pos = geodeticToEcef(degToRad(30), degToRad(-88), 1000);

  it("is POSITIVE for a right turn — body Z is down, so the naive dot product is backwards", () => {
    const level = quatFromHpr(pos, 0, 0, 0);
    // r about body Z is "nose right" (see this module's header), i.e. turning right.
    expect(turnRateRadS(level, pos, { x: 0, y: 0, z: 0.05 })).toBeCloseTo(0.05, 6);
  });

  it("is NEGATIVE for a left turn", () => {
    const level = quatFromHpr(pos, 0, 0, 0);
    expect(turnRateRadS(level, pos, { x: 0, y: 0, z: -0.05 })).toBeCloseTo(-0.05, 6);
  });

  it("is zero when the heading is not changing: level attitude, roll+pitch body rates only", () => {
    // Level attitude puts both body X and body Y in the horizontal plane, so p/q rates
    // have zero projection on local up — heading genuinely isn't changing. (A banked,
    // pitched aircraft with the same rates WOULD change heading; that case belongs to
    // the signed tests above, not here.)
    const level = quatFromHpr(pos, degToRad(45), 0, 0);
    expect(turnRateRadS(level, pos, { x: 0.4, y: 0.2, z: 0 })).toBeCloseTo(0, 6);
  });

  it("is NOT the raw body yaw rate: knife-edge, a pure body yaw rate is pitch, not a turn", () => {
    // Rolled 90 degrees, body Z points along the horizon, so yawing about it changes pitch and
    // not heading at all. `state.rates.z` would claim a hard turn here.
    const knifeEdge = quatFromHpr(pos, 0, 0, degToRad(90));
    expect(turnRateRadS(knifeEdge, pos, { x: 0, y: 0, z: 0.05 })).toBeCloseTo(0, 6);
  });

  it("reads a level turn out of a body ROLL rate when the aeroplane is on its side", () => {
    // The mirror of the case above: rolled 90 degrees, body X (the roll axis) points... still
    // along the nose. Rolled 90 with the nose up 90 (pointing at the zenith), body X is up.
    const noseUp = quatFromHpr(pos, 0, degToRad(90), 0);
    expect(turnRateRadS(noseUp, pos, { x: 0, y: 0, z: 0.05 })).toBeCloseTo(0, 6);
    expect(Math.abs(turnRateRadS(noseUp, pos, { x: 0.05, y: 0, z: 0 }))).toBeCloseTo(0.05, 6);
  });
});
```

Add `turnRateRadS` to the file's imports from `./quat`, and `geodeticToEcef` from `./geo` /
`degToRad` from `./units` if they are not already there (check the head of the file first).

- [ ] **Step 3: Run it and see it fail**

```bash
cd frontend && npm run test -- src/sim/quat.test.ts
```

Expected failure: `SyntaxError: The requested module './quat' does not provide an export named
'turnRateRadS'`. 5 tests failing, 16 still passing.

- [ ] **Step 4: Add `turnRateRadS` to `sim/quat.ts`**

Append to `frontend/src/sim/quat.ts`, below `hprFromQuat`:

```ts
/**
 * Rate of TURN — the rate at which heading is changing, rad/s, positive = turning right.
 *
 * This is what a turn coordinator indicates, and it is NOT `rates.z`: body yaw rate is the rate
 * of turn only when the wings are level. Rolled up on a wingtip, a pure body yaw rate changes
 * pitch and leaves heading alone entirely.
 *
 * The MINUS SIGN is load-bearing. Body Z points DOWN (see this module's header), so a positive
 * r — nose right, i.e. turning right — rotates into ECEF pointing roughly along local DOWN.
 * Dotting that with local UP therefore yields a negative number for a right turn, and the
 * negation puts it back in the "positive = right" convention the snapshot and the turn
 * coordinator both use. Pinned by the signed tests in quat.test.ts.
 */
export function turnRateRadS(q: Quat, positionEcef: Vec3, ratesBody: Vec3): number {
  const { up } = enuBasis(positionEcef);
  return -vDot(qRotate(q, ratesBody), up);
}
```

- [ ] **Step 5: Run it and see it pass**

```bash
cd frontend && npm run test -- src/sim/quat.test.ts
```

Expected: `21 passed` (16 + 5). Running total: **415**.

---

- [ ] **Step 6: Write the failing snapshot-extension test**

`frontend/src/game/flightLoop.test.ts` already has `makeLoop({ groundHeight?, held?, contact? })`
and a `fakeHost` with a `frame(wallMs)` driver. **Use them** — do not add a second harness and do
not export one from `flightLoop.ts`. `held` is the lever these tests need: holding right rudder is
how you produce a signed turn through the real physics rather than by injecting a rate.

Append to `frontend/src/game/flightLoop.test.ts`:

```ts
describe("the 10 Hz snapshot carries everything the cockpit instruments need", () => {
  it("publishes pitch and roll, not just heading — the attitude indicator has no other source", () => {
    const { loop, host, snaps } = makeLoop();
    loop.start();
    host.frame(0);
    expect(snaps.length).toBeGreaterThan(0);
    const s = snaps[snaps.length - 1];
    expect(Number.isFinite(s.pitchRad)).toBe(true);
    expect(Number.isFinite(s.rollRad)).toBe(true);
    // buildSpawnState hands over trimmed and wings-level, so roll starts at (near) zero.
    expect(Math.abs(s.rollRad)).toBeLessThan(0.05);
    loop.stop();
  });

  it("publishes a POSITIVE rate of turn for a right turn", () => {
    // Right rudder, through the real physics — a sign error here is what puts the turn
    // coordinator's little aeroplane the wrong way up in a turn.
    const { loop, host, snaps } = makeLoop({ held: new Set(["KeyD"]) });
    loop.start();
    host.frame(0);
    for (let i = 1; i <= 120; i++) host.frame(i * 16.7);
    const s = snaps[snaps.length - 1];
    expect(s.turnRateRadS).toBeGreaterThan(0);
    loop.stop();
  });

  it("publishes a NEGATIVE rate of turn for a left turn", () => {
    const { loop, host, snaps } = makeLoop({ held: new Set(["KeyA"]) });
    loop.start();
    host.frame(0);
    for (let i = 1; i <= 120; i++) host.frame(i * 16.7);
    expect(snaps[snaps.length - 1].turnRateRadS).toBeLessThan(0);
    loop.stop();
  });

  it("publishes sideslip and the aircraft's own geodetic position", () => {
    const { loop, host, snaps } = makeLoop();
    loop.start();
    host.frame(0);
    const s = snaps[snaps.length - 1];
    expect(Number.isFinite(s.sideslipRad)).toBe(true);
    // The `ga()` contact this file spawns from sits at 30.6944 N, 88.0399 W.
    expect(s.latDeg).toBeCloseTo(30.69, 1);
    expect(s.lonDeg).toBeCloseTo(-88.04, 1);
    loop.stop();
  });
});
```

- [ ] **Step 7: Run it and see it fail**

```bash
cd frontend && npm run test -- src/game/flightLoop.test.ts
```

Expected failure: TypeScript/vitest reports `Property 'pitchRad' does not exist on type
'HudSnapshot'` (and the same for `rollRad`, `turnRateRadS`, `sideslipRad`, `latDeg`, `lonDeg`).
4 tests failing, 23 still passing.

- [ ] **Step 8: Extend the snapshot type and `publish()`**

`frontend/src/hud/snapshot.ts` — add to `HudSnapshot`, immediately after `headingRad`:

```ts
  /** Nose above the local horizontal, radians. Positive = nose up. Attitude indicator. */
  pitchRad: number;
  /** Right wing down, radians. Positive = right wing down. Attitude indicator. */
  rollRad: number;
  /**
   * Rate of heading change about the LOCAL VERTICAL, rad/s. Positive = turning right.
   * Not `rates.z`: body yaw rate is only the rate of turn when the wings are level.
   * Turn coordinator.
   */
  turnRateRadS: number;
  /**
   * Sideslip angle, radians. Drives the slip ball — in this model the only lateral specific
   * force is q*S*cyBeta*beta, so beta IS the ball (decisions.md CD-002). Not an accelerometer.
   */
  sideslipRad: number;
  /** Own geodetic position — the radar scope and the windscreen tags measure range from it. */
  latDeg: number;
  lonDeg: number;
```

`frontend/src/game/flightLoop.ts` — imports and `publish()`:

```ts
import { ecefToGeodetic } from "../sim/geo";
import { hprFromQuat, turnRateRadS } from "../sim/quat";
import { radToDeg } from "../sim/units";
```

```ts
  function publish() {
    const hpr = hprFromQuat(state.attitude, state.position);
    const geo = ecefToGeodetic(state.position);

    onSnapshot({
      iasMs: state.iasMs,
      tasMs: state.tasMs,
      altitudeM: state.altitudeM,
      verticalSpeedMs: state.verticalSpeedMs,
      headingRad: hpr.headingRad,
      pitchRad: hpr.pitchRad,
      rollRad: hpr.rollRad,
      // Rate of TURN, not body yaw rate, and signed positive-right — see sim/quat.ts.
      turnRateRadS: turnRateRadS(state.attitude, state.position, state.rates),
      sideslipRad: state.sideslipRad,
      latDeg: radToDeg(geo.latRad),
      lonDeg: radToDeg(geo.lonRad),
      aoaRad: state.aoaRad,
      loadFactor: state.loadFactor,
      throttle: controls.throttle,
      flapLabel: params.flaps[controls.flapDetent].label,
      gear: params.gear,
      stalled: state.stalled,
      overspeed: state.iasMs > params.limits.vneIasMs,
      gLimited: state.gLimited,
      terrainClearanceM,
      terrainUnverified: terrain.unverified,
      simRate: rateMeter.rate(),
      airtimeS: state.timeS,
      classLabel: params.label,
      callsign,
      modelNote: params.modelNote,
    });
  }
```

Then fix the two existing `HudSnapshot` fixtures so the suite compiles — `frontend/src/hud/format.test.ts`'s `snap()` helper and `frontend/src/hud/Hud.test.tsx`'s equivalent both need the six new fields:

```ts
  pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  latDeg: 30.6944, lonDeg: -88.0399,
```

- [ ] **Step 9: Run it and see it pass**

```bash
cd frontend && npm run test -- src/game/flightLoop.test.ts src/hud
```

Expected: `flightLoop.test.ts` 27 passed (23 + 4), `format.test.ts` 30 passed, `Hud.test.tsx`
9 passed. Running total: **419**.

---

- [ ] **Step 10: Write the failing V-speed params test**

Append to `frontend/src/sim/params.test.ts`:

```ts
describe("ASI arc V-speeds", () => {
  it("carries the POH's Vno and Vfe — the ASI arcs are sourced data, not drawn from taste", () => {
    const p = loadC172();
    expect(msToKt(p.limits.vnoIasMs)).toBeCloseTo(129, 0); // 172S POH max structural cruising
    expect(msToKt(p.limits.vfeIasMs)).toBeCloseTo(85, 0);  // 172S POH, flaps 10-30 deg
    // Ordering is what makes the arcs meaningful at all.
    expect(p.limits.vfeIasMs).toBeLessThan(p.limits.vnoIasMs);
    expect(p.limits.vnoIasMs).toBeLessThan(p.limits.vneIasMs);
  });

  it("rejects a params file that omits them rather than defaulting to a guess", () => {
    const raw = JSON.parse(JSON.stringify(c172Raw)) as Record<string, unknown>;
    delete (raw.limits as Record<string, unknown>).vnoIasMs;
    expect(() => validateClassParams(raw)).toThrow(/vnoIasMs/);
  });
});
```

Add whatever imports the existing file is missing (`msToKt` from `../sim/units`, `c172Raw` from
`../params/c172.json` — check the head of the file first; it may already import both).

- [ ] **Step 11: Run it and see it fail**

```bash
cd frontend && npm run test -- src/sim/params.test.ts
```

Expected failure: `Property 'vnoIasMs' does not exist on type` / the first assertion receives
`undefined`. 2 failing, 12 passing.

- [ ] **Step 12: Add Vno and Vfe as sourced parameters**

`frontend/src/sim/types.ts` — inside `ClassParams["limits"]`, after `vneIasMs`:

```ts
    /** Max structural cruising speed — top of the ASI's green arc, bottom of the yellow. */
    vnoIasMs: number;
    /** Max flaps-extended speed — top of the ASI's white arc. */
    vfeIasMs: number;
```

`frontend/src/sim/params.ts` — inside the `limits` block of `validateClassParams`'s return:

```ts
      vneIasMs: positive(limits, "vneIasMs", "params.limits"),
      vnoIasMs: positive(limits, "vnoIasMs", "params.limits"),
      vfeIasMs: positive(limits, "vfeIasMs", "params.limits"),
```

`frontend/src/params/c172.json` — in `limits`:

```json
    "vneIasMs": 83.85,
    "vnoIasMs": 66.36,
    "vfeIasMs": 43.73,
```

and in `sources`:

```json
    "vnoIasMs": "129 KIAS = 66.36 m/s, 172S POH max structural cruising speed. Top of the ASI green arc / bottom of the yellow caution band. Not a tuning knob and not used by the physics - display only.",
    "vfeIasMs": "85 KIAS = 43.73 m/s, 172S POH max flaps-extended speed for the 10-30 deg range (the 10 deg-only limit is 110 KIAS; the ASI white arc uses the more restrictive figure, which is what the arc means). Top of the ASI white arc. Display only.",
```

**These are display-only numbers.** Nothing in `forces.ts`, `aircraft.ts` or `spawn.ts` reads them:
the flap regime is not speed-limited in this build, and adding a Vfe *limit* would be a new
behaviour this phase did not ask for. The plan says so out loud so a later reader does not assume
the ASI's white arc is enforced.

- [ ] **Step 13: Run it and see it pass**

```bash
cd frontend && npm run test -- src/sim
```

Expected: `params.test.ts` 14 passed, `quat.test.ts` 21 passed, and every other `src/sim` file
unchanged and green (envelope 18, forces 22, aircraft 10, geo 13, integrator 7, isa 8, units 5,
vec3 4). Running total: **421**.

---

- [ ] **Step 14: Write the failing gauge-math tests**

```ts
// frontend/src/dashboard/gaugeMath.test.ts
import { describe, it, expect } from "vitest";
import {
  ASI_MIN_KT, ASI_MAX_KT, ASI_START_DEG, ASI_SWEEP_DEG,
  VSI_FULL_SCALE_FPM, VSI_ZERO_DEG, AI_PX_PER_DEG,
  STANDARD_RATE_DEG_S, TC_SYMBOL_BANK_AT_STD_DEG, TC_MAX_SYMBOL_BANK_DEG,
  SLIP_FULL_SCALE_BETA_DEG, SLIP_BALL_TRAVEL_PX, SLIP_BALL_SIGN,
  asiNeedle, asiArcs, altimeterNeedle, altimeterDrum, vsiNeedle,
  attitudePitchOffsetPx, attitudeRollDeg, pitchLadderRungs,
  headingCardDeg, turnSymbolBankDeg, slipBallOffsetPx,
} from "./gaugeMath";
import { loadC172 } from "../sim/params";
import { stallSpeedIasMs } from "../sim/forces";
import { ktToMs, ftToM, fpmToMs, degToRad, msToKt } from "../sim/units";
import { EM_DASH } from "../hud/format";

const P = loadC172();
/** The scale the tests expect, written out independently of the implementation. */
const asiDeg = (kt: number) =>
  ASI_START_DEG + ((kt - ASI_MIN_KT) / (ASI_MAX_KT - ASI_MIN_KT)) * ASI_SWEEP_DEG;

describe("airspeed indicator needle", () => {
  it("puts the bottom and top of the scale on the dial's stops", () => {
    expect(asiNeedle(ktToMs(ASI_MIN_KT))!.deg).toBeCloseTo(ASI_START_DEG, 6);
    expect(asiNeedle(ktToMs(ASI_MAX_KT))!.deg).toBeCloseTo(ASI_START_DEG + ASI_SWEEP_DEG, 6);
  });
  it("places Vne inside the dial, short of the top stop", () => {
    const vne = asiNeedle(P.limits.vneIasMs)!;
    expect(vne.deg).toBeCloseTo(asiDeg(msToKt(P.limits.vneIasMs)), 6);
    expect(vne.deg).toBeLessThan(ASI_START_DEG + ASI_SWEEP_DEG);
    expect(vne.pegged).toBe(false);
  });
  it("pegs against the bottom stop below the scale instead of running off the face", () => {
    const slow = asiNeedle(ktToMs(12))!;
    expect(slow.deg).toBe(ASI_START_DEG);
    expect(slow.pegged).toBe(true);
  });
  it("pegs against the top stop above the scale", () => {
    const fast = asiNeedle(ktToMs(400))!;
    expect(fast.deg).toBe(ASI_START_DEG + ASI_SWEEP_DEG);
    expect(fast.pegged).toBe(true);
  });
  it("returns null for an unknown airspeed — the view em-dashes it, it does not read zero", () => {
    expect(asiNeedle(null)).toBeNull();
    expect(asiNeedle(Number.NaN)).toBeNull();
  });
});

describe("airspeed indicator arcs", () => {
  const arcs = asiArcs(P);
  const byKind = (k: string) => arcs.find((a) => a.kind === k)!;

  it("runs the white arc from the full-flap stall to Vfe", () => {
    const vs0 = msToKt(stallSpeedIasMs(P, P.flaps.length - 1));
    expect(byKind("white").fromDeg).toBeCloseTo(asiDeg(vs0), 6);
    expect(byKind("white").toDeg).toBeCloseTo(asiDeg(msToKt(P.limits.vfeIasMs)), 6);
  });
  it("runs the green arc from the clean stall to Vno", () => {
    const vs1 = msToKt(stallSpeedIasMs(P, 0));
    expect(vs1).toBeCloseTo(48, 0); // the envelope test's Vs1, restated where the arc uses it
    expect(byKind("green").fromDeg).toBeCloseTo(asiDeg(vs1), 6);
    expect(byKind("green").toDeg).toBeCloseTo(asiDeg(msToKt(P.limits.vnoIasMs)), 6);
  });
  it("runs the yellow caution band from Vno to Vne", () => {
    expect(byKind("yellow").fromDeg).toBeCloseTo(asiDeg(msToKt(P.limits.vnoIasMs)), 6);
    expect(byKind("yellow").toDeg).toBeCloseTo(asiDeg(msToKt(P.limits.vneIasMs)), 6);
  });
  it("draws the red line AT Vne, as a zero-width mark", () => {
    const red = byKind("red");
    expect(red.fromDeg).toBeCloseTo(asiDeg(msToKt(P.limits.vneIasMs)), 6);
    expect(red.toDeg).toBeCloseTo(red.fromDeg, 6);
  });
  it("never produces an inverted or backwards arc", () => {
    for (const a of arcs) expect(a.toDeg).toBeGreaterThanOrEqual(a.fromDeg);
  });
});

describe("altimeter", () => {
  it("sweeps the hundreds hand once per thousand feet", () => {
    expect(altimeterNeedle(ftToM(0))!.deg).toBeCloseTo(0, 6);
    expect(altimeterNeedle(ftToM(250))!.deg).toBeCloseTo(90, 6);
    expect(altimeterNeedle(ftToM(500))!.deg).toBeCloseTo(180, 6);
  });
  it("wraps at the thousand rather than pegging — an altimeter has no stop", () => {
    expect(altimeterNeedle(ftToM(3500))!.deg).toBeCloseTo(180, 6);
    expect(altimeterNeedle(ftToM(3500))!.pegged).toBe(false);
    expect(altimeterNeedle(ftToM(12000))!.deg).toBeCloseTo(0, 6);
  });
  it("keeps a legitimate negative altitude on the face instead of clamping it to zero", () => {
    // -40 ft (Schiphol) is 960 ft into the wrap, exactly where a real altimeter puts it.
    expect(altimeterNeedle(ftToM(-40))!.deg).toBeCloseTo(345.6, 4);
  });
  it("shows whole signed feet in the drum window", () => {
    expect(altimeterDrum(ftToM(3499.6))).toBe("3500");
    expect(altimeterDrum(ftToM(-40))).toBe("-40");
  });
  it("em-dashes the drum and nulls the needle when altitude is unknown", () => {
    expect(altimeterDrum(null)).toBe(EM_DASH);
    expect(altimeterNeedle(null)).toBeNull();
  });
});

describe("vertical speed indicator", () => {
  it("puts level flight at the 9 o'clock position", () => {
    expect(vsiNeedle(0)!.deg).toBeCloseTo(VSI_ZERO_DEG, 6);
    expect(vsiNeedle(0)!.pegged).toBe(false);
  });
  it("reaches the vertical stops at full scale, climb up and descent down", () => {
    expect(vsiNeedle(fpmToMs(VSI_FULL_SCALE_FPM))!.deg).toBeCloseTo(360, 6);
    expect(vsiNeedle(fpmToMs(-VSI_FULL_SCALE_FPM))!.deg).toBeCloseTo(180, 6);
  });
  it("clamps beyond full scale and says it is pegged rather than wrapping past vertical", () => {
    const dive = vsiNeedle(fpmToMs(-4200))!;
    expect(dive.deg).toBeCloseTo(180, 6);
    expect(dive.pegged).toBe(true);
  });
  it("returns null for an unknown vertical speed", () => {
    expect(vsiNeedle(null)).toBeNull();
  });
});

describe("attitude indicator", () => {
  it("puts the horizon on the centre line in level flight", () => {
    expect(attitudePitchOffsetPx(0)!.px).toBeCloseTo(0, 6);
  });
  it("moves the horizon down the face as the nose comes up, linearly", () => {
    expect(attitudePitchOffsetPx(degToRad(10))!.px).toBeCloseTo(10 * AI_PX_PER_DEG, 6);
    expect(attitudePitchOffsetPx(degToRad(-10))!.px).toBeCloseTo(-10 * AI_PX_PER_DEG, 6);
  });
  it("treats +/-90 as the real limit of hprFromQuat, not as a peg", () => {
    // hprFromQuat's pitch is atan2(up, |horizontal|), so it CANNOT exceed +/-90. Flagging
    // these as pegged would invent a stop the aeroplane never hits.
    expect(attitudePitchOffsetPx(degToRad(90))!.px).toBeCloseTo(90 * AI_PX_PER_DEG, 6);
    expect(attitudePitchOffsetPx(degToRad(90))!.pegged).toBe(false);
    expect(attitudePitchOffsetPx(degToRad(-90))!.pegged).toBe(false);
  });
  it("rotates the horizon opposite the roll — right wing down tips the horizon left", () => {
    expect(attitudeRollDeg(degToRad(30))).toBeCloseTo(-30, 6);
    expect(attitudeRollDeg(degToRad(-45))).toBeCloseTo(45, 6);
  });
  it("normalizes a roll past half a turn into (-180, 180]", () => {
    expect(attitudeRollDeg(degToRad(190))).toBeCloseTo(170, 6);
    expect(attitudeRollDeg(degToRad(180))).toBeCloseTo(180, 6);
  });
  it("lays the pitch ladder symmetrically and skips the horizon itself", () => {
    const rungs = pitchLadderRungs();
    expect(rungs.map((r) => r.deg)).toEqual([-30, -20, -10, 10, 20, 30]);
    expect(rungs.every((r) => r.label === String(Math.abs(r.deg)))).toBe(true);
    const ten = rungs.find((r) => r.deg === 10)!;
    const minusTen = rungs.find((r) => r.deg === -10)!;
    expect(ten.px).toBeCloseTo(-minusTen.px, 6);
  });
  it("returns null when attitude is unknown", () => {
    expect(attitudePitchOffsetPx(null)).toBeNull();
    expect(attitudeRollDeg(null)).toBeNull();
  });
});

describe("directional gyro", () => {
  it("rotates the card opposite the heading so the current heading sits under the lubber line", () => {
    expect(headingCardDeg(degToRad(0))).toBeCloseTo(0, 6);
    expect(headingCardDeg(degToRad(90))).toBeCloseTo(270, 6);
  });
  it("wraps 359 -> 0 without ever producing 360", () => {
    expect(headingCardDeg(degToRad(1))).toBeCloseTo(359, 6);
    expect(headingCardDeg(degToRad(359))).toBeCloseTo(1, 6);
    expect(headingCardDeg(degToRad(360))).toBeCloseTo(0, 6);
    expect(headingCardDeg(degToRad(360))).not.toBeCloseTo(360, 6);
  });
  it("normalizes a negative heading", () => {
    expect(headingCardDeg(degToRad(-90))).toBeCloseTo(90, 6);
  });
  it("returns null when heading is unknown", () => {
    expect(headingCardDeg(null)).toBeNull();
  });
});

describe("turn coordinator", () => {
  it("banks the symbol to the index at standard rate", () => {
    const std = turnSymbolBankDeg(degToRad(STANDARD_RATE_DEG_S))!;
    expect(std.deg).toBeCloseTo(TC_SYMBOL_BANK_AT_STD_DEG, 6);
    expect(std.pegged).toBe(false);
  });
  it("mirrors for a left turn", () => {
    expect(turnSymbolBankDeg(degToRad(-STANDARD_RATE_DEG_S))!.deg)
      .toBeCloseTo(-TC_SYMBOL_BANK_AT_STD_DEG, 6);
  });
  it("pegs at twice standard rate", () => {
    const fast = turnSymbolBankDeg(degToRad(3 * STANDARD_RATE_DEG_S))!;
    expect(fast.deg).toBeCloseTo(TC_MAX_SYMBOL_BANK_DEG, 6);
    expect(fast.pegged).toBe(true);
  });
  it("is wings level at zero rate of turn", () => {
    expect(turnSymbolBankDeg(0)!.deg).toBeCloseTo(0, 6);
  });
  it("returns null when the rate of turn is unknown", () => {
    expect(turnSymbolBankDeg(null)).toBeNull();
  });
});

describe("slip ball", () => {
  it("is centred in coordinated flight", () => {
    expect(slipBallOffsetPx(0)!.px).toBeCloseTo(0, 6);
  });
  it("runs to the edge of its race at full-scale sideslip and pegs beyond", () => {
    const full = slipBallOffsetPx(degToRad(SLIP_FULL_SCALE_BETA_DEG))!;
    expect(full.px).toBeCloseTo(SLIP_BALL_SIGN * SLIP_BALL_TRAVEL_PX, 6);
    expect(full.pegged).toBe(false);
    const past = slipBallOffsetPx(degToRad(3 * SLIP_FULL_SCALE_BETA_DEG))!;
    expect(Math.abs(past.px)).toBeCloseTo(SLIP_BALL_TRAVEL_PX, 6);
    expect(past.pegged).toBe(true);
  });
  it("returns null when sideslip is unknown", () => {
    expect(slipBallOffsetPx(null)).toBeNull();
  });
});
```

- [ ] **Step 15: Run it and see it fail**

```bash
cd frontend && npm run test -- src/dashboard/gaugeMath.test.ts
```

Expected failure: `Error: Failed to resolve import "./gaugeMath" from
"src/dashboard/gaugeMath.test.ts". Does the file exist?` — the whole file errors before any test
runs.

- [ ] **Step 16: Write `gaugeMath.ts`**

```ts
// frontend/src/dashboard/gaugeMath.ts
/*
 * Pure needle mathematics for the six-pack. No React, no Cesium, no snapshot type: every
 * function takes plain numbers and returns plain numbers, which is what makes the whole
 * instrument panel's behaviour testable without a renderer.
 *
 * ONE angle convention throughout: DEGREES CLOCKWISE FROM 12 O'CLOCK. A needle drawn pointing
 * straight up at rest is placed by SVG's `transform="rotate(deg cx cy)"`, which is
 * clockwise-positive in screen coordinates, so these numbers go into the markup unmodified.
 *
 * Honesty rules baked into the signatures:
 *  - an unknown reading returns `null`, never 0. The view renders an em-dash and hides the
 *    needle; a zero would be a reading the sim never made.
 *  - a reading past the end of a scale comes back clamped WITH `pegged: true`, so the view can
 *    draw the needle against the stop instead of implying an on-scale value.
 *  - what the sim does not model is not on the face at all: no barometric setting, no heading
 *    bug, no vacuum flag. See decisions.md CD-002 and CD-004.
 */
import type { ClassParams } from "../sim/types";
import { stallSpeedIasMs } from "../sim/forces";
import { EM_DASH } from "../hud/format";
import { msToKt, mToFt, msToFpm, radToDeg } from "../sim/units";

export type Needle = { deg: number; pegged: boolean };
export type Arc = { kind: "white" | "green" | "yellow" | "red"; fromDeg: number; toDeg: number };

const known = (v: number | null | undefined): v is number =>
  v !== null && v !== undefined && Number.isFinite(v);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap into [0, 360). */
function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// ---- airspeed indicator ----------------------------------------------------------------
/**
 * A linear 40-180 kt face over a 300-degree sweep starting at the 1 o'clock stop.
 * Real ASIs are slightly non-linear at the bottom of the scale; a linear map is one line of
 * arithmetic, keeps needle and arcs in exact agreement by construction, and covers the whole
 * C172S band (Vs0 40.4 kt to Vne 163 kt) with headroom at both ends.
 */
export const ASI_MIN_KT = 40;
export const ASI_MAX_KT = 180;
export const ASI_START_DEG = 30;
export const ASI_SWEEP_DEG = 300;

function asiDegFor(kt: number): number {
  return ASI_START_DEG + ((kt - ASI_MIN_KT) / (ASI_MAX_KT - ASI_MIN_KT)) * ASI_SWEEP_DEG;
}

export function asiNeedle(iasMs: number | null): Needle | null {
  if (!known(iasMs)) return null;
  const kt = msToKt(iasMs);
  const raw = asiDegFor(kt);
  const lo = ASI_START_DEG;
  const hi = ASI_START_DEG + ASI_SWEEP_DEG;
  return { deg: clamp(raw, lo, hi), pegged: raw < lo || raw > hi };
}

/**
 * The four painted markings, all derived from the class parameters:
 *  white  Vs0 (full-flap stall) -> Vfe
 *  green  Vs1 (clean stall)     -> Vno
 *  yellow Vno                   -> Vne
 *  red    a zero-width line AT Vne
 * Vs0/Vs1 come from `forces.stallSpeedIasMs` (the same function the envelope tests hold to the
 * POH), so the arcs cannot drift away from the aeroplane the sim actually flies.
 */
export function asiArcs(params: ClassParams): Arc[] {
  const vs0 = msToKt(stallSpeedIasMs(params, params.flaps.length - 1));
  const vs1 = msToKt(stallSpeedIasMs(params, 0));
  const vfe = msToKt(params.limits.vfeIasMs);
  const vno = msToKt(params.limits.vnoIasMs);
  const vne = msToKt(params.limits.vneIasMs);
  return [
    { kind: "white", fromDeg: asiDegFor(vs0), toDeg: asiDegFor(vfe) },
    { kind: "green", fromDeg: asiDegFor(vs1), toDeg: asiDegFor(vno) },
    { kind: "yellow", fromDeg: asiDegFor(vno), toDeg: asiDegFor(vne) },
    { kind: "red", fromDeg: asiDegFor(vne), toDeg: asiDegFor(vne) },
  ];
}

// ---- altimeter -------------------------------------------------------------------------
/**
 * Drum-pointer, not three-pointer (decisions.md CD-004): ONE hand for hundreds of feet plus a
 * digital drum for the whole reading. The three-pointer's 10,000 ft hand is the classic
 * misread, and a second scale that can disagree with the HUD's ALT is a bug surface this build
 * does not need.
 *
 * The hand WRAPS and never pegs — that is what an altimeter does — which is also why a negative
 * altitude lands at a real position on the face instead of being clamped to zero.
 */
export function altimeterNeedle(altitudeM: number | null): Needle | null {
  if (!known(altitudeM)) return null;
  const ft = mToFt(altitudeM);
  return { deg: wrap360((ft / 1000) * 360), pegged: false };
}

export function altimeterDrum(altitudeM: number | null): string {
  return known(altitudeM) ? String(Math.round(mToFt(altitudeM))) : EM_DASH;
}

// ---- vertical speed indicator ------------------------------------------------------------
/**
 * Linear +/-2000 fpm, zero at 9 o'clock, full scale straight up and straight down. Real VSIs
 * compress the top of the scale; linear keeps the needle honest against the HUD's numeric VSI
 * and makes the pegging rule a single comparison.
 */
export const VSI_FULL_SCALE_FPM = 2000;
export const VSI_ZERO_DEG = 270;
export const VSI_HALF_SWEEP_DEG = 90;

export function vsiNeedle(verticalSpeedMs: number | null): Needle | null {
  if (!known(verticalSpeedMs)) return null;
  const fpm = msToFpm(verticalSpeedMs);
  const frac = fpm / VSI_FULL_SCALE_FPM;
  return {
    deg: VSI_ZERO_DEG + clamp(frac, -1, 1) * VSI_HALF_SWEEP_DEG,
    pegged: Math.abs(frac) > 1,
  };
}

// ---- attitude indicator ------------------------------------------------------------------
/** Pixels of horizon travel per degree of pitch, inside the 120-unit dial viewBox. */
export const AI_PX_PER_DEG = 2.2;

export function attitudePitchOffsetPx(
  pitchRad: number | null,
): { px: number; pegged: boolean } | null {
  if (!known(pitchRad)) return null;
  const deg = radToDeg(pitchRad);
  // hprFromQuat computes pitch as atan2(up, |horizontal|), whose range IS [-90, 90]. There is
  // no stop to hit, so this never reports pegged - inventing one would be a fake reading.
  return { px: deg * AI_PX_PER_DEG, pegged: false };
}

/** Horizon rotation, clockwise-positive. Right wing down tips the drawn horizon the other way. */
export function attitudeRollDeg(rollRad: number | null): number | null {
  if (!known(rollRad)) return null;
  const deg = wrap360(-radToDeg(rollRad));
  return deg > 180 ? deg - 360 : deg;
}

export function pitchLadderRungs(): {
  deg: number;
  px: number;
  label: string;
  halfWidthPx: number;
}[] {
  return [-30, -20, -10, 10, 20, 30].map((deg) => ({
    deg,
    px: -deg * AI_PX_PER_DEG,
    label: String(Math.abs(deg)),
    halfWidthPx: deg % 20 === 0 ? 22 : 13,
  }));
}

// ---- directional gyro --------------------------------------------------------------------
/** The card turns opposite the aeroplane, so the current heading stays under the lubber line. */
export function headingCardDeg(headingRad: number | null): number | null {
  if (!known(headingRad)) return null;
  return wrap360(-radToDeg(headingRad));
}

// ---- turn coordinator --------------------------------------------------------------------
export const STANDARD_RATE_DEG_S = 3;
export const TC_SYMBOL_BANK_AT_STD_DEG = 15;
export const TC_MAX_SYMBOL_BANK_DEG = 30;

/** The little aeroplane banks to the index at standard rate and pegs at twice standard rate. */
export function turnSymbolBankDeg(turnRateRadS: number | null): Needle | null {
  if (!known(turnRateRadS)) return null;
  const ratio = radToDeg(turnRateRadS) / STANDARD_RATE_DEG_S;
  return {
    deg: clamp(ratio, -2, 2) * TC_SYMBOL_BANK_AT_STD_DEG,
    pegged: Math.abs(ratio) > 2,
  };
}

// ---- slip ball ---------------------------------------------------------------------------
/**
 * Driven by SIDESLIP, and the face says so (`SLIP beta`). This sim has no lateral
 * accelerometer, but it also has no crosswind, no P-factor and no engine torque: the only
 * lateral specific force in the model is q*S*cyBeta*beta, a strictly monotone function of beta.
 * So beta is not a stand-in for the ball here - it is what the ball would be measuring.
 * decisions.md CD-002.
 *
 * SLIP_BALL_SIGN is the ONE place the left/right convention is decided; the acceptance
 * walkthrough checks it against "step on the ball" and flips this constant if it is mirrored.
 * Never fix a mirrored ball in the component.
 */
export const SLIP_FULL_SCALE_BETA_DEG = 10;
export const SLIP_BALL_TRAVEL_PX = 26;
export const SLIP_BALL_SIGN = -1;

export function slipBallOffsetPx(
  sideslipRad: number | null,
): { px: number; pegged: boolean } | null {
  if (!known(sideslipRad)) return null;
  const ratio = radToDeg(sideslipRad) / SLIP_FULL_SCALE_BETA_DEG;
  return {
    px: SLIP_BALL_SIGN * clamp(ratio, -1, 1) * SLIP_BALL_TRAVEL_PX,
    pegged: Math.abs(ratio) > 1,
  };
}
```

- [ ] **Step 17: Run it and see it pass**

```bash
cd frontend && npm run test -- src/dashboard/gaugeMath.test.ts
```

Expected: `Tests 38 passed (38)`. Running total: **459**.

---

- [ ] **Step 18: Write the failing six-pack component test**

```tsx
// frontend/src/dashboard/SixPack.test.tsx
import { describe, it, expect } from "vitest";
import SixPack from "./SixPack";
import { loadC172 } from "../sim/params";
import type { HudSnapshot } from "../hud/snapshot";
import { EM_DASH } from "../hud/format";
import { ktToMs, ftToM, fpmToMs, degToRad } from "../sim/units";

const P = loadC172();

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500),
  verticalSpeedMs: 0, headingRad: degToRad(270), pitchRad: 0, rollRad: 0,
  turnRateRadS: 0, sideslipRad: 0, latDeg: 30.6944, lonDeg: -88.0399,
  aoaRad: degToRad(3), loadFactor: 1, throttle: 0.6, flapLabel: "0", gear: "fixed",
  stalled: false, overspeed: false, gLimited: false, terrainClearanceM: ftToM(2000),
  terrainUnverified: false, simRate: 1, airtimeS: 0, classLabel: "C172S",
  callsign: "SIM-A1B2C3", modelNote: "C172 MODEL THIS BUILD",
  ...o,
});

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

/** Same walk, but harvesting one prop off every element — needle angles are attributes, not text. */
function collectAttr(node: unknown, key: string, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) collectAttr(c, key, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof type === "function") {
    return collectAttr((type as (p: unknown) => unknown)(props), key, out);
  }
  if (props && key in props && typeof props[key] === "string") out.push(props[key] as string);
  if (props && "children" in props) collectAttr(props.children, key, out);
  return out;
}

const render = (snapshot: HudSnapshot | null) =>
  collectText(SixPack({ snapshot, params: P })).join(" ");
const transforms = (snapshot: HudSnapshot | null) =>
  collectAttr(SixPack({ snapshot, params: P }), "transform");

describe("SixPack", () => {
  it("labels all six instruments", () => {
    const text = render(snap());
    for (const label of ["ASI", "ATTITUDE", "ALT", "TURN", "HDG", "VSI"]) {
      expect(text).toContain(label);
    }
  });

  it("reads the airspeed, altitude and heading straight off the snapshot", () => {
    const text = render(snap({ iasMs: ktToMs(103), altitudeM: ftToM(3500), headingRad: degToRad(270) }));
    expect(text).toContain("103");
    expect(text).toContain("3500");
    expect(text).toContain("270");
  });

  it("agrees with the HUD's own formatters rather than rounding differently", () => {
    // 359.6 deg reads 000 on the HUD; the DG's digital window must not read 360.
    const text = render(snap({ headingRad: degToRad(359.6) }));
    expect(text).toContain("000");
    expect(text).not.toContain("360");
  });

  it("renders em-dashes, not zeros, when there is no snapshot at all", () => {
    const text = render(null);
    expect(text).toContain(EM_DASH);
    expect(text).not.toMatch(/\b0\b/);
  });

  it("draws no needles at all when there is no snapshot", () => {
    expect(transforms(null).filter((t) => t.startsWith("rotate("))).toHaveLength(0);
  });

  it("rotates the horizon opposite the roll", () => {
    expect(transforms(snap({ rollRad: degToRad(30) }))).toContain("rotate(-30 60 60)");
  });

  it("marks a pegged VSI needle instead of implying an on-scale reading", () => {
    expect(render(snap({ verticalSpeedMs: fpmToMs(-4000) }))).toContain("PEG");
  });

  it("paints the ASI's red line at Vne", () => {
    // join first: the element's className is "gauge-arc gauge-arc-red", and array toContain
    // matches a whole element, not a substring of one.
    expect(collectAttr(SixPack({ snapshot: snap(), params: P }), "className").join(" "))
      .toContain("gauge-arc-red");
  });

  it("labels the slip indicator as sideslip, not as a coordination accelerometer", () => {
    const text = render(snap());
    expect(text).toContain("SLIP");
    expect(text).toContain("β"); // beta
  });

  it("does not draw a barometric setting or a heading bug the sim cannot back", () => {
    const text = render(snap());
    expect(text).not.toContain("29.92");
    expect(text).not.toContain("1013");
    expect(text).not.toContain("BUG");
  });
});
```

- [ ] **Step 19: Run it and see it fail**

```bash
cd frontend && npm run test -- src/dashboard/SixPack.test.tsx
```

Expected failure: `Error: Failed to resolve import "./SixPack"`.

- [ ] **Step 20: Write `SixPack.tsx` and its CSS**

```tsx
// frontend/src/dashboard/SixPack.tsx
/*
 * Six analog dials, hand-rolled SVG, LORAN line style: 1px strokes, cyan for nominal data,
 * amber for anything the aeroplane is doing that it should not be. No logic lives here —
 * every angle comes from gaugeMath.ts, where it is tested, and every digital readout comes
 * from hud/format.ts, so a dial and the HUD can never disagree about the same number.
 *
 * Hook-free on purpose: that is what lets the test call it as a plain function and walk the
 * returned element tree without jsdom.
 */
import type { ReactNode } from "react";
import type { HudSnapshot } from "../hud/snapshot";
import type { ClassParams } from "../sim/types";
import { EM_DASH, formatHeadingDeg, formatIasKt, formatVsiFpm } from "../hud/format";
import {
  asiArcs, asiNeedle, altimeterDrum, altimeterNeedle, attitudePitchOffsetPx, attitudeRollDeg,
  headingCardDeg, pitchLadderRungs, slipBallOffsetPx, turnSymbolBankDeg, vsiNeedle,
  TC_SYMBOL_BANK_AT_STD_DEG, type Arc, type Needle,
} from "./gaugeMath";

const C = 60;   // dial centre inside the 120x120 viewBox
const R = 54;   // bezel radius

function polar(deg: number, radius: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: C + radius * Math.cos(rad), y: C + radius * Math.sin(rad) };
}

function arcPath(fromDeg: number, toDeg: number, radius: number): string {
  const a = polar(fromDeg, radius);
  const b = polar(toDeg, radius);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

function Dial({ title, digits, needle, children }: {
  title: string;
  digits: string;
  needle: Needle | null;
  children?: ReactNode;
}) {
  return (
    <div className="gauge">
      <svg viewBox="0 0 120 120" className="gauge-face" role="img">
        <circle cx={C} cy={C} r={R} className="gauge-bezel" />
        {children}
        {needle && (
          <line
            x1={C} y1={C} x2={C} y2={14}
            className={needle.pegged ? "gauge-needle gauge-needle-pegged" : "gauge-needle"}
            transform={`rotate(${round(needle.deg)} ${C} ${C})`}
          />
        )}
        <circle cx={C} cy={C} r={3} className="gauge-hub" />
      </svg>
      <div className="gauge-label label">{title}</div>
      <div className="gauge-digits">{digits}</div>
      {needle?.pegged ? <div className="gauge-peg">PEG</div> : null}
    </div>
  );
}

/** One rounding rule for every transform, so the tests can assert exact strings. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function arcClass(a: Arc): string {
  return `gauge-arc gauge-arc-${a.kind}`;
}

export default function SixPack({ snapshot, params }: {
  snapshot: HudSnapshot | null;
  params: ClassParams;
}) {
  const ias = snapshot?.iasMs ?? null;
  const alt = snapshot?.altitudeM ?? null;
  const vsi = snapshot?.verticalSpeedMs ?? null;

  const roll = attitudeRollDeg(snapshot?.rollRad ?? null);
  const pitch = attitudePitchOffsetPx(snapshot?.pitchRad ?? null);
  const card = headingCardDeg(snapshot?.headingRad ?? null);
  const turn = turnSymbolBankDeg(snapshot?.turnRateRadS ?? null);
  const ball = slipBallOffsetPx(snapshot?.sideslipRad ?? null);

  return (
    <div className="six-pack">
      {/* --- airspeed --- */}
      <Dial title="ASI KT" digits={formatIasKt(ias)} needle={asiNeedle(ias)}>
        {asiArcs(params).map((a) => (
          <path
            key={a.kind}
            className={arcClass(a)}
            d={a.kind === "red"
              ? `M ${polar(a.fromDeg, R - 10).x.toFixed(2)} ${polar(a.fromDeg, R - 10).y.toFixed(2)} L ${polar(a.fromDeg, R - 2).x.toFixed(2)} ${polar(a.fromDeg, R - 2).y.toFixed(2)}`
              : arcPath(a.fromDeg, a.toDeg, R - 6)}
          />
        ))}
      </Dial>

      {/* --- attitude --- */}
      <div className="gauge">
        <svg viewBox="0 0 120 120" className="gauge-face" role="img">
          <circle cx={C} cy={C} r={R} className="gauge-bezel" />
          {roll !== null && pitch !== null && (
            <g transform={`rotate(${round(roll)} ${C} ${C})`}>
              <g transform={`translate(0 ${round(pitch.px)})`}>
                <line x1={C - 46} y1={C} x2={C + 46} y2={C} className="gauge-horizon" />
                {pitchLadderRungs().map((r) => (
                  <line
                    key={r.deg}
                    x1={C - r.halfWidthPx} y1={C + round(r.px)}
                    x2={C + r.halfWidthPx} y2={C + round(r.px)}
                    className="gauge-ladder"
                  />
                ))}
              </g>
            </g>
          )}
          <path d={`M ${C - 18} ${C} L ${C - 6} ${C} L ${C} ${C + 5} L ${C + 6} ${C} L ${C + 18} ${C}`}
            className="gauge-aircraft" />
        </svg>
        <div className="gauge-label label">ATTITUDE</div>
        <div className="gauge-digits">
          {roll === null ? EM_DASH : `${roll > 0 ? "L" : roll < 0 ? "R" : ""}${Math.abs(Math.round(roll))}°`}
        </div>
      </div>

      {/* --- altimeter (drum-pointer: one hundreds hand + a digital drum) --- */}
      <Dial title="ALT FT" digits={altimeterDrum(alt)} needle={altimeterNeedle(alt)}>
        {[0, 90, 180, 270].map((d) => (
          <line key={d}
            x1={polar(d, R - 10).x} y1={polar(d, R - 10).y}
            x2={polar(d, R - 2).x} y2={polar(d, R - 2).y}
            className="gauge-tick" />
        ))}
      </Dial>

      {/* --- turn coordinator: rate-of-turn symbol + the sideslip ball --- */}
      <div className="gauge">
        <svg viewBox="0 0 120 120" className="gauge-face" role="img">
          <circle cx={C} cy={C} r={R} className="gauge-bezel" />
          <line x1={polar(-TC_SYMBOL_BANK_AT_STD_DEG, R - 14).x} y1={polar(-TC_SYMBOL_BANK_AT_STD_DEG, R - 14).y}
            x2={polar(-TC_SYMBOL_BANK_AT_STD_DEG, R - 4).x} y2={polar(-TC_SYMBOL_BANK_AT_STD_DEG, R - 4).y}
            className="gauge-tick" />
          <line x1={polar(TC_SYMBOL_BANK_AT_STD_DEG, R - 14).x} y1={polar(TC_SYMBOL_BANK_AT_STD_DEG, R - 14).y}
            x2={polar(TC_SYMBOL_BANK_AT_STD_DEG, R - 4).x} y2={polar(TC_SYMBOL_BANK_AT_STD_DEG, R - 4).y}
            className="gauge-tick" />
          {turn && (
            <g transform={`rotate(${round(turn.deg)} ${C} ${C})`}
              className={turn.pegged ? "gauge-needle-pegged" : undefined}>
              <line x1={C - 26} y1={C - 8} x2={C + 26} y2={C - 8} className="gauge-aircraft" />
              <line x1={C} y1={C - 8} x2={C} y2={C + 2} className="gauge-aircraft" />
            </g>
          )}
          <rect x={C - 32} y={C + 20} width={64} height={14} rx={2} className="gauge-race" />
          {ball && <circle cx={C + round(ball.px)} cy={C + 27} r={5} className="gauge-ball" />}
        </svg>
        <div className="gauge-label label">TURN</div>
        <div className="gauge-digits">SLIP β {ball === null ? EM_DASH : ""}</div>
        {turn?.pegged ? <div className="gauge-peg">PEG</div> : null}
      </div>

      {/* --- directional gyro --- */}
      <div className="gauge">
        <svg viewBox="0 0 120 120" className="gauge-face" role="img">
          <circle cx={C} cy={C} r={R} className="gauge-bezel" />
          {card !== null && (
            <g transform={`rotate(${round(card)} ${C} ${C})`}>
              {[0, 90, 180, 270].map((d, i) => (
                <text key={d} x={polar(d, R - 16).x} y={polar(d, R - 16).y + 4}
                  className="gauge-card-text" textAnchor="middle">
                  {["N", "E", "S", "W"][i]}
                </text>
              ))}
              {[30, 60, 120, 150, 210, 240, 300, 330].map((d) => (
                <line key={d}
                  x1={polar(d, R - 10).x} y1={polar(d, R - 10).y}
                  x2={polar(d, R - 3).x} y2={polar(d, R - 3).y}
                  className="gauge-tick" />
              ))}
            </g>
          )}
          <path d={`M ${C - 5} 10 L ${C + 5} 10 L ${C} 18 Z`} className="gauge-lubber" />
        </svg>
        <div className="gauge-label label">HDG</div>
        <div className="gauge-digits">{formatHeadingDeg(snapshot?.headingRad ?? null)}</div>
      </div>

      {/* --- vertical speed --- */}
      <Dial title="VSI FPM" digits={formatVsiFpm(vsi)} needle={vsiNeedle(vsi)}>
        {[180, 270, 360].map((d) => (
          <line key={d}
            x1={polar(d, R - 10).x} y1={polar(d, R - 10).y}
            x2={polar(d, R - 2).x} y2={polar(d, R - 2).y}
            className="gauge-tick" />
        ))}
      </Dial>
    </div>
  );
}
```

Append to `frontend/src/styles/tokens.css`:

```css
/* ---- six-pack: analog dials, 1px strokes, cyan nominal / amber abnormal ---- */
.six-pack {
  display: grid;
  grid-template-columns: repeat(3, 78px);
  grid-template-rows: repeat(2, auto);
  gap: 6px 10px;
}
.gauge { display: flex; flex-direction: column; align-items: center; }
.gauge-face { width: 74px; height: 74px; }
.gauge-bezel { fill: none; stroke: var(--grid); stroke-width: 1; }
.gauge-tick { stroke: var(--grid); stroke-width: 1; }
.gauge-needle { stroke: var(--cyan); stroke-width: 2; }
.gauge-needle-pegged { stroke: var(--amber); }
.gauge-hub { fill: var(--cyan); }
.gauge-horizon { stroke: var(--cyan); stroke-width: 1.5; }
.gauge-ladder { stroke: var(--grid); stroke-width: 1; }
.gauge-aircraft { fill: none; stroke: var(--amber); stroke-width: 1.5; }
.gauge-lubber { fill: var(--amber); }
.gauge-race { fill: none; stroke: var(--grid); stroke-width: 1; }
.gauge-ball { fill: var(--cyan); }
.gauge-card-text { fill: var(--text); font-family: var(--mono); font-size: 11px; }
.gauge-arc { fill: none; stroke-width: 3; }
.gauge-arc-white { stroke: var(--text); }
.gauge-arc-green { stroke: var(--cyan); }
.gauge-arc-yellow { stroke: var(--amber); opacity: 0.75; }
.gauge-arc-red { stroke: var(--amber); stroke-width: 2; }
.gauge-label { color: var(--text); opacity: 0.7; font-size: 9px; }
.gauge-digits { color: var(--cyan); font-size: 12px; letter-spacing: 0.06em; }
.gauge-peg { color: var(--amber); font-size: 9px; letter-spacing: 0.08em; }
```

`.gauge-arc-red` is amber, not a new red token: the LORAN palette has exactly two accent colours
and the red line's meaning ("do not exceed") is already what amber carries everywhere else in this
app. Its narrower stroke and radial shape distinguish it from the yellow band.

- [ ] **Step 21: Run it and see it pass**

```bash
cd frontend && npm run test -- src/dashboard
```

Expected: `gaugeMath.test.ts` 38 passed, `SixPack.test.tsx` 10 passed. Running total: **469**.

- [ ] **Step 22: Log the five decisions, then the full suite and one commit**

Append to `docs/decisions.md`:

```markdown
## 2026-08-07 — CD-001 · The cockpit reads a wider 10 Hz snapshot, not a second bridge

The six-pack needs pitch, roll, rate of turn and sideslip; the radar scope and the windscreen
tags need the aircraft's own lat/lon. Every one of those already exists inside the sim each
tick — `publish()` simply threw them away. `HudSnapshot` gains `pitchRad`, `rollRad`,
`turnRateRadS`, `sideslipRad`, `latDeg`, `lonDeg` and the loop publishes them at the same ~10 Hz
as everything else. No second observer, no zustand at sim cadence, no component reaching into
`flightLoop`'s closure.

`turnRateRadS` is deliberately NOT `state.rates.z`. Body yaw rate is the rate of turn only when
the wings are level; rolled up on a wingtip it is mostly pitch. It gets a pure function in
`sim/quat.ts` (`turnRateRadS`), beside the frame math it belongs to, which rotates the body rates
into ECEF and projects them onto the local up axis — **negated**, because body Z points DOWN, so
the un-negated dot product reads a right turn as negative and would bank the turn coordinator's
little aeroplane the wrong way. That sign is pinned by signed tests (not `Math.abs`) in
`quat.test.ts`, which is the only kind of test that can catch it.

## 2026-08-07 — CD-002 · The slip ball is driven by sideslip, and the face says so

A real turn coordinator's ball is a lateral accelerometer. This sim has no accelerometer — but
it also has no crosswind, no P-factor and no engine torque, and the only lateral specific force
in the model is `Y = q·S·cyBeta·β`, a strictly monotone function of sideslip. So β is not a
stand-in for the ball: within this model it is exactly what the ball would be measuring.

The instrument is labelled `SLIP β` rather than dressed up as a coordination ball, and the
left/right convention lives in one constant, `SLIP_BALL_SIGN` in `dashboard/gaugeMath.ts`, which
the acceptance walkthrough verifies against "step on the ball". If a later phase adds crosswind
or asymmetric thrust, β stops being the whole story and this instrument must be re-derived from
a real lateral acceleration — noted here so that is not discovered by accident.

## 2026-08-07 — CD-003 · Vno and Vfe are POH data added to c172.json; Vs0/Vs1 stay derived

The ASI's arcs need four speeds. Two of them, Vs0 and Vs1, are already *derived* from the aero
block by `forces.stallSpeedIasMs` — the same function `envelope.test.ts` holds to the POH's 40
and 48 KCAS — so the arcs are computed, never typed in, and cannot drift away from the aeroplane
the sim actually flies. The other two did not exist anywhere: `limits.vnoIasMs` (129 KIAS) and
`limits.vfeIasMs` (85 KIAS) are added to `c172.json` with 172S POH provenance in `sources`, and
the validator now requires them.

Both are **display-only**. Nothing in the physics reads them: this build does not speed-limit the
flap regime, and adding a Vfe limit would be new behaviour nobody asked for. The white arc is a
marking, not an enforcement.

## 2026-08-07 — CD-004 · Drum-pointer altimeter; no Kollsman window, no heading bug

The altimeter ships ONE hundreds-of-feet hand plus a digital drum, not the classic three-pointer.
The three-pointer's 10,000 ft hand is the canonical misread, the owner is not an instrument
pilot, and a second scale that can disagree with the HUD's numeric ALT is a bug surface with no
new information behind it.

Two faces that a real six-pack has are simply absent rather than drawn inert: the **barometric
setting window** (this sim flies pure ISA and `altitudeM` is geometric — a fixed `29.92` would
imply a setting the player can neither read nor change) and the **heading bug** (nothing sets one
and nothing flies to one). Ground rule 1 applies to decoration as much as to data.

## 2026-08-07 — CD-005 · Linear VSI, linear ASI, both with explicit pegging

Real VSIs compress above 1000 fpm and real ASIs are slightly non-linear at the bottom of the
scale. Both are linear here: `±2000 fpm` over `±90°` for the VSI, `40–180 kt` over `300°` for the
ASI. The reason is agreement, not laziness — a linear map keeps needle and arcs derivable from
one function, and keeps the dial in exact step with the HUD's numeric readouts, so a player can
never see the tape and the needle disagree.

Anything off the end of a scale comes back clamped with `pegged: true` and the needle turns amber
with a `PEG` legend, rather than silently sitting on the stop as if that were the reading.
```

```bash
cd frontend && npm run test && npm run typecheck
```

Expected: `Test Files 37 passed (37)`, `Tests 469 passed (469)`, typecheck clean.

```bash
git add frontend/src/dashboard frontend/src/hud frontend/src/game frontend/src/sim frontend/src/params frontend/src/styles docs/decisions.md && git commit -m "feat(dashboard): pure gauge math and the analog six-pack"
```

---
### Task 2: The dashboard strip — collapse, controls help, and two honest empty panels

D-1, D-5 and D-6. After this task the strip is on screen with the six-pack in it and the two
placeholder panels saying exactly what they are. The radar slot arrives in Task 4; until then the
strip simply has no radar panel — a greyed-out box labelled "RADAR" with nothing behind it would
be the fake affordance ground rule 1 exists to prevent.

**Where collapse state lives — decision, with the reasoning:** **local React state in
`DashboardStrip`**, not zustand.

- It is read by exactly one subtree and by nothing else. Nothing in `sim/`, `globe/`, `panels/`
  or the backend cares whether a panel is folded.
- It changes at human cadence (a click or a keypress), so there is no re-render argument for
  putting it anywhere clever.
- The Global Constraints cap store additions at genuine cross-subtree view preferences. `basemap`
  and `labelsOn` qualify (Task 5: `StatusBar` is outside `ViewerHost`'s provider and has no other
  way to reach the viewer). Collapse state does not.
- **The consequence, chosen deliberately:** collapse survives PAUSE and ENDED, because
  `DashboardStrip` stays mounted for `FLYING | PAUSED | ENDED`; it **resets on QUIT**, because the
  strip unmounts when the mode returns to `BROWSE`. A new flight therefore starts with a fresh
  cockpit, which matches the "QUIT leaves no residue" rule the whole session teardown is built
  around. Task 6 step 4 pins that behaviour with a test.

**Strip keys, added to `KEYMAP` so the help panel picks them up automatically:** `KeyC` toggles
the whole strip ("cockpit"), `Slash` toggles the controls help (`?` on a US layout — spec §5 says
"`?` (or button)", and both exist). Neither is read by `createControlSampler`, which matches on
codes directly; `KEYMAP` is the documentation constant, and the coverage test in step 7 is what
makes it the single source of truth for the help panel.

**Files:**
- Create: `frontend/src/dashboard/PanelFrame.tsx`, `frontend/src/dashboard/DashboardStrip.tsx`, `frontend/src/dashboard/ControlsHelp.tsx`, `frontend/src/dashboard/WeatherPanel.tsx`, `frontend/src/dashboard/AtcPanel.tsx`
- Test: `frontend/src/dashboard/DashboardStrip.test.tsx`, `frontend/src/dashboard/ControlsHelp.test.tsx`, `frontend/src/dashboard/panels.test.tsx`
- Modify: `frontend/src/input/controls.ts`, `frontend/src/input/controls.test.ts`, `frontend/src/game/FlightSession.tsx`, `frontend/src/styles/tokens.css`, `docs/decisions.md`

**Interfaces:**
- Consumes: `KEYMAP` (`input/controls.ts`); `HudSnapshot` (`hud/snapshot.ts`); `loadC172` (`sim/params.ts`); `SixPack` (`dashboard/SixPack.tsx`).
- Produces:
  - `input/controls.ts`: `KEYMAP` gains `KeyC` and `Slash`.
  - `dashboard/PanelFrame.tsx`: default export `PanelFrame({ title, collapsed, onToggle, children }: { title: string; collapsed: boolean; onToggle(): void; children: ReactNode })` — hook-free.
  - `dashboard/ControlsHelp.tsx`: `KEY_LABELS: Readonly<Record<string, string>>`, `keyLabel(code: string): string`, `groupKeymap(keymap: Readonly<Record<string, string>>): { action: string; keys: string[] }[]`, default export `ControlsHelp()` — hook-free.
  - `dashboard/WeatherPanel.tsx`: `NO_FEED = "NO FEED · FUTURE INTEGRATION"`, default export `WeatherPanel()` — hook-free.
  - `dashboard/AtcPanel.tsx`: default export `AtcPanel()` — hook-free.
  - `dashboard/DashboardStrip.tsx`:
    - `type PanelId = "gauges" | "radar" | "weather" | "atc" | "help"`
    - `type StripState = { open: boolean; collapsed: Record<PanelId, boolean> }`
    - `PANEL_IDS: readonly PanelId[]`
    - `defaultStripState(): StripState`
    - `togglePanel(s: StripState, id: PanelId): StripState`
    - `toggleStrip(s: StripState): StripState`
    - `stripKeyAction(code: string): "strip" | "help" | null`
    - `DashboardStripBody(props): JSX.Element` — hook-free, exported for test
    - default export `DashboardStrip({ snapshot }: { snapshot: HudSnapshot | null })` — hooks

---

- [ ] **Step 1: Write the failing KEYMAP test**

Append to `frontend/src/input/controls.test.ts`:

```ts
describe("KEYMAP documents the cockpit keys as well as the flight controls", () => {
  it("names the strip toggle and the controls-help toggle", () => {
    expect(KEYMAP.KeyC).toMatch(/cockpit|strip/i);
    expect(KEYMAP.Slash).toMatch(/help/i);
  });

  it("does not let either of them move a flight control", () => {
    const sampler = createControlSampler(loadC172());
    const before = sampler.sample(new Set<string>(), 1 / 60);
    const after = sampler.sample(new Set(["KeyC", "Slash"]), 1 / 60);
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd frontend && npm run test -- src/input/controls.test.ts
```

Expected failure: `expected undefined to match /cockpit|strip/i` on the first test. 1 failing
(the second already passes — the sampler ignores unknown codes, which is the point of asserting
it), 23 passing.

- [ ] **Step 3: Add the two keys to `KEYMAP`**

`frontend/src/input/controls.ts`, at the end of the `KEYMAP` literal:

```ts
  Escape: "pause",
  // Cockpit chrome, not flight controls: the sampler matches on codes and never sees these.
  // They live here so ControlsHelp can render the keymap without a second, hand-copied list.
  KeyC: "collapse / restore the cockpit strip",
  Slash: "controls help",
};
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd frontend && npm run test -- src/input/controls.test.ts
```

Expected: `24 passed`. Running total: **471**.

---

- [ ] **Step 5: Write the failing strip-state and strip-body tests**

```tsx
// frontend/src/dashboard/DashboardStrip.test.tsx
import { describe, it, expect } from "vitest";
import {
  PANEL_IDS, defaultStripState, togglePanel, toggleStrip, stripKeyAction, DashboardStripBody,
} from "./DashboardStrip";
import { loadC172 } from "../sim/params";

const P = loadC172();

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

const body = (state = defaultStripState()) =>
  collectText(
    DashboardStripBody({
      state, snapshot: null, params: P,
      onTogglePanel: () => {}, onToggleStrip: () => {},
    }),
  ).join(" ");

describe("strip state", () => {
  it("opens with the instruments showing and the help folded away", () => {
    const s = defaultStripState();
    expect(s.open).toBe(true);
    expect(s.collapsed.gauges).toBe(false);
    expect(s.collapsed.weather).toBe(false);
    expect(s.collapsed.help).toBe(true);
  });

  it("has a collapse flag for every panel it knows about", () => {
    const s = defaultStripState();
    for (const id of PANEL_IDS) expect(typeof s.collapsed[id]).toBe("boolean");
  });

  it("collapses exactly the panel named and leaves the others alone", () => {
    const s = togglePanel(defaultStripState(), "weather");
    expect(s.collapsed.weather).toBe(true);
    expect(s.collapsed.gauges).toBe(false);
    expect(s.collapsed.atc).toBe(false);
  });

  it("does not mutate the state it was given", () => {
    const before = defaultStripState();
    const snapshot = JSON.stringify(before);
    togglePanel(before, "weather");
    toggleStrip(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("toggles the whole strip without disturbing the per-panel flags", () => {
    const s = toggleStrip(togglePanel(defaultStripState(), "atc"));
    expect(s.open).toBe(false);
    expect(s.collapsed.atc).toBe(true);
  });
});

describe("strip keys", () => {
  it("maps KeyC to the whole strip and Slash to the help panel", () => {
    expect(stripKeyAction("KeyC")).toBe("strip");
    expect(stripKeyAction("Slash")).toBe("help");
  });
  it("ignores every flight-control key so the cockpit cannot eat an input", () => {
    for (const code of ["ArrowUp", "ArrowDown", "KeyW", "KeyS", "KeyF", "KeyV", "Escape"]) {
      expect(stripKeyAction(code)).toBeNull();
    }
  });
});

describe("DashboardStripBody", () => {
  it("titles every panel it is showing", () => {
    const text = body();
    for (const title of ["INSTRUMENTS", "WEATHER", "ATC", "CONTROLS"]) {
      expect(text).toContain(title);
    }
  });

  it("keeps a collapsed panel's frame and title but drops its contents", () => {
    const text = body(togglePanel(defaultStripState(), "weather"));
    expect(text).toContain("WEATHER");
    // Assert on the WEATHER panel's own line: NO_FEED is shared with AtcPanel, which is still
    // open, so asserting on that string would pass or fail for the wrong reason.
    expect(text).not.toContain("WEATHER RADAR MOSAIC");
    expect(text).toContain("NO FEED · FUTURE INTEGRATION"); // still there — from the ATC panel
  });

  it("shows only the restore affordance when the whole strip is closed", () => {
    const text = body(toggleStrip(defaultStripState()));
    expect(text).toContain("COCKPIT");
    expect(text).not.toContain("INSTRUMENTS");
  });
});
```

- [ ] **Step 6: Run it and see it fail**

```bash
cd frontend && npm run test -- src/dashboard/DashboardStrip.test.tsx
```

Expected failure: `Error: Failed to resolve import "./DashboardStrip"`.

- [ ] **Step 7: Write `PanelFrame.tsx` and `DashboardStrip.tsx`**

```tsx
// frontend/src/dashboard/PanelFrame.tsx
/*
 * One collapsible LORAN panel: bracket corners from `.panel`, an uppercase title that is also
 * the collapse control, and a [+]/[-] affordance. Hook-free — the open/closed flag and the
 * handler both come from the parent, which is what makes it testable by calling it.
 */
import type { ReactNode } from "react";

export default function PanelFrame({ title, collapsed, onToggle, children }: {
  title: string;
  collapsed: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  return (
    <section className="dash-panel panel">
      <button type="button" className="dash-panel-header label" onClick={onToggle}>
        <span>{title}</span>
        <span className="dash-panel-toggle">{collapsed ? "[+]" : "[-]"}</span>
      </button>
      {collapsed ? null : <div className="dash-panel-body">{children}</div>}
    </section>
  );
}
```

```tsx
// frontend/src/dashboard/DashboardStrip.tsx
/*
 * The bottom cockpit strip (spec D-1): six-pack left, radar centre (Task 4), weather/ATC right,
 * controls help at the edge. Every panel folds on its own; KeyC folds the lot.
 *
 * Collapse state is LOCAL React state, on purpose (decisions.md CD-006): it is read by nothing
 * outside this subtree, it changes at human cadence, and the store's job is session state, not
 * furniture. It therefore survives PAUSE (the strip stays mounted) and resets on QUIT (the strip
 * unmounts with the flight) — which is the same "no residue" rule the rest of teardown follows.
 *
 * The component is split in two so the rendering half can be tested without a renderer:
 * `DashboardStrip` owns the hooks, `DashboardStripBody` owns every element.
 */
import { useEffect, useState } from "react";
import type { HudSnapshot } from "../hud/snapshot";
import type { ClassParams } from "../sim/types";
import { loadC172 } from "../sim/params";
import PanelFrame from "./PanelFrame";
import SixPack from "./SixPack";
import WeatherPanel from "./WeatherPanel";
import AtcPanel from "./AtcPanel";
import ControlsHelp from "./ControlsHelp";

export type PanelId = "gauges" | "radar" | "weather" | "atc" | "help";
export type StripState = { open: boolean; collapsed: Record<PanelId, boolean> };

export const PANEL_IDS: readonly PanelId[] = ["gauges", "radar", "weather", "atc", "help"];

/** Instruments and the honest placeholders are up; the help panel starts folded. */
export function defaultStripState(): StripState {
  return {
    open: true,
    collapsed: { gauges: false, radar: false, weather: false, atc: false, help: true },
  };
}

export function togglePanel(s: StripState, id: PanelId): StripState {
  return { ...s, collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } };
}

export function toggleStrip(s: StripState): StripState {
  return { ...s, open: !s.open };
}

/** The only two keys this strip claims. Everything else belongs to the aeroplane. */
export function stripKeyAction(code: string): "strip" | "help" | null {
  if (code === "KeyC") return "strip";
  if (code === "Slash") return "help";
  return null;
}

export function DashboardStripBody({ state, snapshot, params, onTogglePanel, onToggleStrip }: {
  state: StripState;
  snapshot: HudSnapshot | null;
  params: ClassParams;
  onTogglePanel(id: PanelId): void;
  onToggleStrip(): void;
}) {
  if (!state.open) {
    return (
      <div className="dash-strip dash-strip-closed">
        <button type="button" className="status-chip-button" onClick={onToggleStrip}>
          COCKPIT [C]
        </button>
      </div>
    );
  }

  return (
    <div className="dash-strip">
      <PanelFrame title="INSTRUMENTS" collapsed={state.collapsed.gauges}
        onToggle={() => onTogglePanel("gauges")}>
        <SixPack snapshot={snapshot} params={params} />
      </PanelFrame>

      <PanelFrame title="WEATHER" collapsed={state.collapsed.weather}
        onToggle={() => onTogglePanel("weather")}>
        <WeatherPanel />
      </PanelFrame>

      <PanelFrame title="ATC" collapsed={state.collapsed.atc}
        onToggle={() => onTogglePanel("atc")}>
        <AtcPanel />
      </PanelFrame>

      <PanelFrame title="CONTROLS" collapsed={state.collapsed.help}
        onToggle={() => onTogglePanel("help")}>
        <ControlsHelp />
      </PanelFrame>

      <button type="button" className="status-chip-button dash-strip-hide" onClick={onToggleStrip}>
        HIDE [C]
      </button>
    </div>
  );
}

export default function DashboardStrip({ snapshot }: { snapshot: HudSnapshot | null }) {
  const [state, setState] = useState<StripState>(defaultStripState);
  const params = loadC172();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = stripKeyAction(e.code);
      if (action === null) return;
      setState((s) => (action === "strip" ? toggleStrip(s) : togglePanel(s, "help")));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <DashboardStripBody
      state={state}
      snapshot={snapshot}
      params={params}
      onTogglePanel={(id) => setState((s) => togglePanel(s, id))}
      onToggleStrip={() => setState(toggleStrip)}
    />
  );
}
```

Note there is deliberately **no radar `PanelFrame` yet**. Task 4 adds it (and the `radar` entry in
`defaultStripState` is already reserved so that change is one line, not a state-shape change).

- [ ] **Step 8: Run it and see it fail differently** — the strip now resolves, but its imports do
  not:

```bash
cd frontend && npm run test -- src/dashboard/DashboardStrip.test.tsx
```

Expected failure: `Error: Failed to resolve import "./WeatherPanel"` (then `./AtcPanel`, then
`./ControlsHelp` as each is added). Those three arrive in the next two cycles; this is the one
place in the plan where a file is written before every collaborator exists, because the strip is
what defines what the collaborators must be.

---

- [ ] **Step 9: Write the failing controls-help test**

```tsx
// frontend/src/dashboard/ControlsHelp.test.tsx
import { describe, it, expect } from "vitest";
import ControlsHelp, { KEY_LABELS, keyLabel, groupKeymap } from "./ControlsHelp";
import { KEYMAP } from "../input/controls";

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

const rendered = () => collectText(ControlsHelp()).join(" ");

describe("keyLabel", () => {
  it("has an explicit label for EVERY key in KEYMAP — no silent fallbacks", () => {
    for (const code of Object.keys(KEYMAP)) {
      expect(KEY_LABELS[code], `missing label for ${code}`).toBeDefined();
      expect(KEY_LABELS[code].length).toBeGreaterThan(0);
    }
  });
  it("renders arrows and punctuation as a pilot would read them, not as DOM codes", () => {
    expect(keyLabel("ArrowUp")).toBe("↑");
    expect(keyLabel("Equal")).toBe("=");
    expect(keyLabel("NumpadAdd")).toBe("NUM +");
    expect(keyLabel("Slash")).toBe("?");
    expect(keyLabel("Escape")).toBe("ESC");
    expect(keyLabel("KeyW")).toBe("W");
  });
  it("falls back to a stripped code rather than throwing on a key added later", () => {
    expect(keyLabel("KeyZ")).toBe("Z");
  });
});

describe("groupKeymap", () => {
  it("accounts for every KEYMAP entry exactly once", () => {
    const keys = groupKeymap(KEYMAP).flatMap((g) => g.keys);
    expect(keys.sort()).toEqual(Object.keys(KEYMAP).sort());
  });
  it("merges the three ways to open the throttle into one row", () => {
    const row = groupKeymap(KEYMAP).find((g) => g.action === "throttle up")!;
    expect(row.keys).toEqual(["KeyW", "Equal", "NumpadAdd"]);
  });
  it("keeps the KEYMAP's own order rather than sorting alphabetically", () => {
    expect(groupKeymap(KEYMAP)[0].action).toBe(KEYMAP[Object.keys(KEYMAP)[0]]);
  });
});

describe("ControlsHelp", () => {
  it("is generated FROM KEYMAP — every documented action appears", () => {
    const text = rendered();
    for (const action of new Set(Object.values(KEYMAP))) {
      expect(text, `help panel is missing "${action}"`).toContain(action);
    }
  });
  it("therefore already documents the cockpit keys added this phase", () => {
    const text = rendered();
    // Assert the ACTIONS, not the key faces: "C" is a substring of "ESC" and would pass
    // vacuously; "?" is the only unambiguous face of the two.
    expect(text).toContain(KEYMAP.KeyC);
    expect(text).toContain(KEYMAP.Slash);
    expect(text).toContain("?");
  });
});
```

- [ ] **Step 10: Run it and see it fail**

```bash
cd frontend && npm run test -- src/dashboard/ControlsHelp.test.tsx
```

Expected failure: `Error: Failed to resolve import "./ControlsHelp"`.

- [ ] **Step 11: Write `ControlsHelp.tsx`**

```tsx
// frontend/src/dashboard/ControlsHelp.tsx
/*
 * The keymap panel (spec D-6), rendered FROM the real `KEYMAP` constant. There is no second
 * hand-written key list anywhere in the app — `ControlsHelp.test.tsx` asserts that every action
 * in KEYMAP appears here, so a key added to the sampler and documented in KEYMAP shows up in the
 * cockpit automatically, and a key documented nowhere fails the test rather than the player.
 */
import { KEYMAP } from "../input/controls";

/**
 * Human-readable key faces. Explicit rather than derived, because "Equal" is "=" and
 * "NumpadAdd" is not "+" on its own key. The test requires an entry for every KEYMAP code.
 */
export const KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  KeyA: "A",
  KeyD: "D",
  KeyW: "W",
  KeyS: "S",
  Equal: "=",
  Minus: "-",
  NumpadAdd: "NUM +",
  NumpadSubtract: "NUM -",
  KeyF: "F",
  KeyV: "V",
  KeyG: "G",
  KeyC: "C",
  Comma: ",",
  Period: ".",
  Slash: "?",
  Escape: "ESC",
};

/** Explicit label when we have one; otherwise the code with its DOM prefix stripped. */
export function keyLabel(code: string): string {
  const explicit = KEY_LABELS[code];
  if (explicit !== undefined) return explicit;
  return code.replace(/^(Key|Digit)/, "").toUpperCase();
}

/**
 * KEYMAP is code -> action; the panel wants action -> codes, in KEYMAP's own order, with the
 * duplicates ("throttle up" has three keys) folded into one row.
 */
export function groupKeymap(
  keymap: Readonly<Record<string, string>>,
): { action: string; keys: string[] }[] {
  const byAction = new Map<string, string[]>();
  for (const [code, action] of Object.entries(keymap)) {
    const existing = byAction.get(action);
    if (existing) existing.push(code);
    else byAction.set(action, [code]);
  }
  return [...byAction.entries()].map(([action, keys]) => ({ action, keys }));
}

export default function ControlsHelp() {
  return (
    <div className="controls-help">
      {groupKeymap(KEYMAP).map((row) => (
        <div className="controls-help-row" key={row.action}>
          <span className="controls-help-keys">
            {row.keys.map((code) => (
              <kbd className="controls-help-key" key={code}>{keyLabel(code)}</kbd>
            ))}
          </span>
          <span className="controls-help-action">{row.action}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 12: Run it and see it pass**

```bash
cd frontend && npm run test -- src/dashboard/ControlsHelp.test.tsx
```

Expected: `8 passed`. Running total (help only, the strip is still red): **479**.

---

- [ ] **Step 13: Write the failing placeholder-panel tests**

```tsx
// frontend/src/dashboard/panels.test.tsx
import { describe, it, expect } from "vitest";
import WeatherPanel, { NO_FEED } from "./WeatherPanel";
import AtcPanel from "./AtcPanel";
import PanelFrame from "./PanelFrame";

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

const weather = () => collectText(WeatherPanel()).join(" ");
const atc = () => collectText(AtcPanel()).join(" ");

describe("the weather panel is chrome only", () => {
  it("states the empty condition literally", () => {
    expect(weather()).toContain(NO_FEED);
    expect(NO_FEED).toBe("NO FEED · FUTURE INTEGRATION");
  });
  it("names the feed that is planned, so the blank is explained rather than mysterious", () => {
    expect(weather()).toMatch(/PLANNED/);
    expect(weather()).toMatch(/WEATHER RADAR/);
  });
  it("contains no digits AT ALL — a placeholder number is a fake reading", () => {
    expect(weather()).not.toMatch(/\d/);
  });
});

describe("the ATC panel is chrome only", () => {
  it("states the empty condition literally", () => {
    expect(atc()).toContain(NO_FEED);
  });
  it("names the feed that is planned", () => {
    expect(atc()).toMatch(/PLANNED/);
    expect(atc()).toMatch(/TRANSCRIPT/);
  });
  it("contains no digits AT ALL — no sample frequency, no sample squawk", () => {
    expect(atc()).not.toMatch(/\d/);
  });
  it("contains no sample transmission text", () => {
    for (const forbidden of [/CLEARED/i, /ROGER/i, /SQUAWK/i, /WILCO/i]) {
      expect(atc()).not.toMatch(forbidden);
    }
  });
});

describe("PanelFrame", () => {
  it("shows the title and the contents when open", () => {
    const text = collectText(
      PanelFrame({ title: "WEATHER", collapsed: false, onToggle: () => {}, children: "BODY" }),
    ).join(" ");
    expect(text).toContain("WEATHER");
    expect(text).toContain("BODY");
    expect(text).toContain("[-]");
  });
  it("keeps the title but drops the contents when collapsed", () => {
    const text = collectText(
      PanelFrame({ title: "WEATHER", collapsed: true, onToggle: () => {}, children: "BODY" }),
    ).join(" ");
    expect(text).toContain("WEATHER");
    expect(text).not.toContain("BODY");
    expect(text).toContain("[+]");
  });
});
```

- [ ] **Step 14: Run it and see it fail**

```bash
cd frontend && npm run test -- src/dashboard/panels.test.tsx
```

Expected failure: `Error: Failed to resolve import "./WeatherPanel"`.

- [ ] **Step 15: Write the two placeholder panels, the CSS, and wire the strip into the session**

```tsx
// frontend/src/dashboard/WeatherPanel.tsx
/*
 * Chrome only (spec D-5). This panel exists so the cockpit has the shape it will eventually
 * have, and it says so in as many words. There is no sample METAR, no sample radar image, no
 * placeholder number, and a test asserts the rendered text contains no digits at all — because
 * the cheapest way to accidentally ship fake data is to make a screen "look finished".
 */
export const NO_FEED = "NO FEED · FUTURE INTEGRATION";

export default function WeatherPanel() {
  return (
    <div className="dash-empty">
      <div className="dash-empty-state">{NO_FEED}</div>
      <div className="dash-empty-note">PLANNED: WEATHER RADAR MOSAIC, SHARED WITH LORAN</div>
    </div>
  );
}
```

```tsx
// frontend/src/dashboard/AtcPanel.tsx
/* Chrome only (spec D-5). Same rule as WeatherPanel — see the comment there. */
import { NO_FEED } from "./WeatherPanel";

export default function AtcPanel() {
  return (
    <div className="dash-empty">
      <div className="dash-empty-state">{NO_FEED}</div>
      <div className="dash-empty-note">
        PLANNED: LIVE ATC TRANSCRIPT WITH CALLSIGN CORRELATION
      </div>
    </div>
  );
}
```

Append to `frontend/src/styles/tokens.css`:

```css
/* ---- cockpit strip: the bottom instrument shelf ---- */
.dash-strip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 6px 10px;
  pointer-events: auto;
  font-size: 11px;
}
.dash-strip-closed { justify-content: flex-start; }
.dash-strip-hide { align-self: flex-start; }
.dash-panel { padding: 0; }
.dash-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--grid);
  background: transparent;
  color: var(--text);
  font-family: var(--mono);
  padding: 3px 8px;
  cursor: pointer;
  border-radius: 0;
}
.dash-panel-header:hover { background: rgba(95, 215, 224, 0.08); }
.dash-panel-toggle { color: var(--cyan); }
.dash-panel-body { padding: 6px 8px; }
.dash-empty {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
  min-height: 74px;
  justify-content: center;
}
.dash-empty-state {
  color: var(--amber);
  letter-spacing: 0.08em;
  font-size: 10px;
}
.dash-empty-note {
  color: var(--text);
  opacity: 0.6;
  font-size: 9px;
  letter-spacing: 0.04em;
}
.controls-help {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  max-height: 150px;
  overflow-y: auto;
  font-size: 10px;
}
.controls-help-row { display: contents; }
.controls-help-keys { display: flex; gap: 3px; }
.controls-help-key {
  border: 1px solid var(--grid);
  padding: 0 4px;
  color: var(--cyan);
  font-family: var(--mono);
  border-radius: 0;
}
.controls-help-action { color: var(--text); opacity: 0.8; }
```

**StrictMode discipline for the strip's key listener.** `DashboardStrip`'s `useEffect` is this
phase's one new global-listener surface, and React 18 double-invokes it in development. The effect
above adds exactly one `keydown` listener and its cleanup removes exactly that listener, with `[]`
deps so it is added once per mount — never inside a handler, never conditionally, and never with a
dependency that would re-register it on every state change. A doubled listener would not crash;
it would toggle the strip twice per keypress and look like the key "not working", which is why
checkpoint 24 in the acceptance walkthrough presses `C` after a full pause/resume cycle rather than
trusting the code review.

`frontend/src/game/FlightSession.tsx` — import and render the strip alongside the HUD:

```tsx
import DashboardStrip from "../dashboard/DashboardStrip";
```

```tsx
      {(mode === "FLYING" || mode === "PAUSED" || mode === "ENDED") && (
        <>
          <Hud snapshot={snapshot} terrainNote={bundle?.terrainNote ?? ""} />
          <DashboardStrip snapshot={snapshot} />
        </>
      )}
```

The strip is a **sibling** of `<Hud/>`, not a child: `.hud-root` is `pointer-events: none` so the
globe stays draggable underneath it, and the strip's buttons must be clickable.

- [ ] **Step 16: Run it and see it all pass**

```bash
cd frontend && npm run test -- src/dashboard
```

Expected: `gaugeMath` 38, `SixPack` 10, `DashboardStrip` 10, `ControlsHelp` 8, `panels` 9.
Running total: **498**.

- [ ] **Step 17: Log CD-006, full suite, typecheck, one commit**

Append to `docs/decisions.md`:

```markdown
## 2026-08-07 — CD-006 · Panel collapse is local React state; it resets on QUIT by design

The cockpit strip's open/closed flags live in `useState` inside `DashboardStrip`, not in zustand.
Nothing outside that subtree reads them, they change at human cadence, and the store's remit is
session state (`mode`/`origin`/`endStats`) plus the two genuinely cross-subtree view preferences
Task 5 adds (`basemap`/`labelsOn`, which `StatusBar` needs from outside `ViewerHost`'s provider).

The consequence is deliberate and is what makes it the right call rather than merely the easy
one: because the strip stays mounted for `FLYING | PAUSED | ENDED`, folding a panel **survives a
pause and the end card**; because it unmounts when the mode returns to `BROWSE`, folding
**resets on QUIT**. A new flight therefore starts with a fresh cockpit, which is the same "no
residue" rule the whole session teardown already follows. Pinned by a test in Task 6.

The two cockpit keys (`KeyC` strip, `Slash` help) are in `KEYMAP` even though the control sampler
never reads them — `ControlsHelp` renders from `KEYMAP`, and a key documented in two places is a
key that will eventually be documented wrongly in one of them.
```

```bash
cd frontend && npm run test && npm run typecheck
```

Expected: `Test Files 40 passed (40)`, `Tests 498 passed (498)`, typecheck clean.

```bash
git add frontend/src/dashboard frontend/src/input frontend/src/game frontend/src/styles docs/decisions.md && git commit -m "feat(dashboard): collapsible cockpit strip, KEYMAP-driven help, honest weather/ATC placeholders"
```

---

### Task 3: Windscreen traffic tags and the detail card

D-3. Live contacts inside the FPV frustum get a compact screen-anchored tag; clicking one opens a
LORAN card with the feed's own fields plus the `/api/type/{hex}` enrichment. Every tag traces back
to a contact that is in the store *right now* — there is no tag cache, no last-known-position
fallback and no dead reckoning, so a tag disappears the moment its contact leaves the feed.

**One prerequisite, done first (step 5).** `contactHeightM` — the `alt_geom`-only datum rule the
globe billboards already follow — lives in `globe/contactBillboards.ts`, which imports Cesium.
Importing it from `dashboard/` would make `trafficProjection.ts` **transitively** Cesium-dependent,
which the header's zero-Cesium rule forbids and which Task 6's direct-import grep would not catch.
Duplicating the rule instead would be worse: the datum decision (decisions B-014) would then exist
in two places and drift. So it moves to a Cesium-free `data/contactGeo.ts` and
`globe/contactBillboards.ts` re-exports it — the same trick `globe/ghost.ts` already uses in the
other direction for `GHOST_ALPHA`, so every existing import keeps working untouched.

**Three shapes, one job:**
- `dashboard/trafficProjection.ts` — **pure**. Takes the contact map, own position, a viewport and
  an *injected* `project(lon, lat, height) => {x,y} | null` function, and returns the tags to draw.
  Cesium-free, therefore fully testable.
- `globe/TrafficOverlay.tsx` — the **thin** Cesium adapter. All it does is build that `project`
  function out of `SceneTransforms.worldToWindowCoordinates` plus a front-of-camera test, read the
  10 Hz snapshot and the store, and hand both to the pure module.
- `dashboard/TrafficTags.tsx` — hook-free DOM presentation of the result. **Deviation from the
  task skeleton, stated up front:** the skeleton put the tag markup inside `TrafficOverlay.tsx`.
  Splitting the presentational half into `dashboard/` is what lets it be tested at all (the
  overlay's half needs a live `Scene`), and it is what makes "thin adapter" checkable rather than
  aspirational.

Tags are **DOM overlays positioned over the canvas**, so a click is an ordinary React `onClick` —
no Cesium picking, no `ScreenSpaceEventHandler`, no interaction with the existing BROWSE-only
pick handler in `ViewerHost`.

**Files:**
- Create: `frontend/src/data/contactGeo.ts`, `frontend/src/dashboard/geoRange.ts`, `frontend/src/dashboard/trafficProjection.ts`, `frontend/src/dashboard/TrafficTags.tsx`, `frontend/src/dashboard/TrafficDetailCard.tsx`, `frontend/src/globe/TrafficOverlay.tsx`
- Test: `frontend/src/dashboard/geoRange.test.ts`, `frontend/src/dashboard/trafficProjection.test.ts`, `frontend/src/dashboard/TrafficTags.test.tsx`, `frontend/src/dashboard/TrafficDetailCard.test.tsx`, `frontend/src/data/api.test.ts`
- Modify: `frontend/src/globe/contactBillboards.ts`, `frontend/src/data/api.ts`, `frontend/src/data/types.ts`, `frontend/src/game/FlightSession.tsx`, `frontend/src/styles/tokens.css`, `docs/decisions.md`

**Interfaces:**
- Consumes: `Contact` (`data/types.ts`); `contactHeightM` (`data/contactGeo.ts`, moved in step 5); `EM_DASH`, `formatHeadingDeg` (`hud/format.ts`); `mToFt`, `ftToM` (`sim/units.ts`); `HudSnapshot` (`hud/snapshot.ts`); `useViewer` (`globe/viewerContext.ts`); `useStore` (`state/store.ts`); `SceneTransforms`, `Cartesian3` (`cesium`, **inside `globe/` only**).
- Produces:
  - `data/contactGeo.ts`: `contactHeightM(c: Contact): number | null` — moved verbatim out of `globe/contactBillboards.ts`, which now re-exports it.
  - `dashboard/geoRange.ts`: `rangeNm(aLatDeg, aLonDeg, bLatDeg, bLonDeg): number`, `bearingDeg(aLatDeg, aLonDeg, bLatDeg, bLonDeg): number`.
  - `data/types.ts`: `type TypeInfo = { type: string | null; manufacturer: string | null; registration: string | null }`.
  - `data/api.ts`: `fetchTypeInfo(hex: string): Promise<TypeInfo>`.
  - `dashboard/trafficProjection.ts`: `type ScreenXY`, `type ProjectFn`, `type TrafficTag`, `TAG_MARGIN_PX`, `TAG_MIN_SPACING_PX`, `TAG_MAX_COUNT`, `TAG_MAX_RANGE_NM`, `tagLabel(c)`, `tagTypeLine(c)`, `tagAltLine(c)`, `projectTraffic(input): TrafficTag[]`.
  - `dashboard/TrafficTags.tsx`: default export `TrafficTags({ tags, onSelect })` — hook-free.
  - `dashboard/TrafficDetailCard.tsx`: `type EnrichmentState`, `TrafficDetailBody({ contact, enrichment, onClose })` — hook-free, exported; default export `TrafficDetailCard({ hex, onClose })` — hooks.
  - `globe/TrafficOverlay.tsx`: default export `TrafficOverlay({ onSelect }: { onSelect(hex: string): void })`.

---

- [ ] **Step 1: Write the failing great-circle tests**

```ts
// frontend/src/dashboard/geoRange.test.ts
import { describe, it, expect } from "vitest";
import { rangeNm, bearingDeg } from "./geoRange";

describe("rangeNm", () => {
  it("makes one degree of latitude 60 nautical miles — that is the definition", () => {
    expect(rangeNm(30, -88, 31, -88)).toBeCloseTo(60, 0);
  });
  it("is zero for the same point", () => {
    expect(rangeNm(30.6944, -88.0399, 30.6944, -88.0399)).toBeCloseTo(0, 6);
  });
  it("is symmetric", () => {
    expect(rangeNm(30, -88, 41, -74)).toBeCloseTo(rangeNm(41, -74, 30, -88), 6);
  });
  it("agrees with a known long leg (JFK -> LHR is about 3000 NM)", () => {
    expect(rangeNm(40.64, -73.78, 51.47, -0.45)).toBeGreaterThan(2900);
    expect(rangeNm(40.64, -73.78, 51.47, -0.45)).toBeLessThan(3050);
  });
});

describe("bearingDeg", () => {
  it("is 000 due north and 180 due south", () => {
    expect(bearingDeg(30, -88, 31, -88)).toBeCloseTo(0, 3);
    expect(bearingDeg(30, -88, 29, -88)).toBeCloseTo(180, 3);
  });
  it("is 090 due east and 270 due west", () => {
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 3);
    expect(bearingDeg(0, 0, 0, -1)).toBeCloseTo(270, 3);
  });
  it("always lands in [0, 360)", () => {
    for (const [la, lo] of [[31, -87], [29, -89], [30, -89], [31, -89]] as const) {
      const b = bearingDeg(30, -88, la, lo);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
  it("is 000 for the same point rather than NaN", () => {
    expect(bearingDeg(30, -88, 30, -88)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd frontend && npm run test -- src/dashboard/geoRange.test.ts
```

Expected failure: `Error: Failed to resolve import "./geoRange"`.

- [ ] **Step 3: Write `geoRange.ts`**

```ts
// frontend/src/dashboard/geoRange.ts
/*
 * Great-circle range and bearing on a sphere, in degrees in / nautical miles out. Shared by the
 * windscreen tags and the radar scope, which is the only reason it is its own module.
 *
 * A sphere, not WGS84: at radar ranges (<= 250 NM) the ellipsoidal correction is under 0.3%,
 * well inside the resolution of a 220-pixel scope, and this keeps the module free of any
 * dependency on the sim's geodesy. The sim itself is ellipsoidal — see decisions.md G-003 — and
 * this is a DISPLAY approximation, deliberately confined to display code.
 */
const EARTH_RADIUS_NM = 3440.065; // 6371.0088 km / 1.852

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function rangeNm(aLatDeg: number, aLonDeg: number, bLatDeg: number, bLonDeg: number): number {
  const dLat = toRad(bLatDeg - aLatDeg);
  const dLon = toRad(bLonDeg - aLonDeg);
  const la1 = toRad(aLatDeg);
  const la2 = toRad(bLatDeg);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing, degrees clockwise from true north, [0, 360). */
export function bearingDeg(
  aLatDeg: number, aLonDeg: number, bLatDeg: number, bLonDeg: number,
): number {
  if (aLatDeg === bLatDeg && aLonDeg === bLonDeg) return 0;
  const la1 = toRad(aLatDeg);
  const la2 = toRad(bLatDeg);
  const dLon = toRad(bLonDeg - aLonDeg);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd frontend && npm run test -- src/dashboard/geoRange.test.ts
```

Expected: `8 passed`. Running total: **506**.

---

- [ ] **Step 5: Move `contactHeightM` out of `globe/` so `dashboard/` can use it**

A pure move plus a re-export. No behaviour changes and no test changes — the existing
`globe/contactBillboards.test.ts` keeps importing it from where it always did and must stay green
untouched, which is what proves the move was behaviour-preserving.

Create `frontend/src/data/contactGeo.ts` with the function moved **verbatim**, comment and all:

```ts
// frontend/src/data/contactGeo.ts
/*
 * Where a contact actually is, in metres — the one datum rule, in a Cesium-free module so both
 * the globe layer and the dashboard can apply it without either importing the other's world.
 *
 * Moved here from globe/contactBillboards.ts, unchanged: `dashboard/trafficProjection.ts` needs
 * the same rule, and importing it from a module that pulls in Cesium would have made the whole
 * dashboard transitively Cesium-dependent.
 */
import type { Contact } from "./types";
import { ftToM } from "../sim/units";

/**
 * Height for a contact, in metres above the ellipsoid. `alt_geom` only: it is WGS84-ellipsoidal,
 * the same datum as the terrain, so a contact placed with it sits where it actually is.
 * `alt_baro` is pressure altitude and would put aircraft at the wrong height over real relief,
 * so a contact without alt_geom is not placed in 3D at all (it still appears in the contact list,
 * with its baro altitude, honestly labelled). decisions.md B-014.
 */
export function contactHeightM(c: Contact): number | null {
  return c.alt_geom === null ? null : ftToM(c.alt_geom);
}
```

In `frontend/src/globe/contactBillboards.ts`, delete the function body and re-export instead —
`ghost.ts` and `ContactLayer.tsx` import it from here and must keep working unchanged:

```ts
/**
 * Re-exported so the globe layer still has one import for everything billboard-shaped. It now
 * LIVES in data/contactGeo.ts, which is Cesium-free, because dashboard/trafficProjection.ts
 * applies the same datum rule and must not import a module that pulls in Cesium.
 */
export { contactHeightM } from "../data/contactGeo";
```

and change `renderableContacts`'s own call site to import it from the new module (`import {
contactHeightM } from "../data/contactGeo";`) rather than referencing a local definition that no
longer exists. Drop the now-unused `ftToM` import from `contactBillboards.ts` if nothing else in
the file uses it — `noUnusedLocals` is on and will say so.

```bash
cd frontend && npm run test -- src/globe && npm run typecheck
```

Expected: `contactBillboards.test.ts` 9 passed, `ghost.test.ts` 6 passed, `icons.test.ts` 5,
`fpvCamera.test.ts` 19, `terrainPreload.test.ts` 4 — all unchanged. Typecheck clean. Running
total still **506**: a move that changes a test count is not a move.

- [ ] **Step 6: Write the failing projection tests**

```ts
// frontend/src/dashboard/trafficProjection.test.ts
import { describe, it, expect } from "vitest";
import {
  TAG_MARGIN_PX, TAG_MAX_COUNT, TAG_MAX_RANGE_NM, TAG_MIN_SPACING_PX,
  projectTraffic, tagAltLine, tagLabel, tagTypeLine, type ProjectFn,
} from "./trafficProjection";
import type { Contact } from "../data/types";
import { EM_DASH } from "../hud/format";

const own = { latDeg: 30.0, lonDeg: -88.0 };
const viewport = { widthPx: 1000, heightPx: 700 };

const c = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.05, lon: -88.0,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});

const mapOf = (...cs: Contact[]) => new Map(cs.map((x) => [x.hex, x]));
/** Everything lands dead centre unless a test says otherwise. */
const centre: ProjectFn = () => ({ x: 500, y: 350 });
const at = (x: number, y: number): ProjectFn => () => ({ x, y });

const run = (contacts: Map<string, Contact>, project: ProjectFn, o: Partial<Parameters<typeof projectTraffic>[0]> = {}) =>
  projectTraffic({ contacts, own, project, viewport, ghostHex: null, ...o });

describe("projectTraffic", () => {
  it("produces nothing at all when the feed has nothing — no cached tags, ever", () => {
    expect(run(new Map(), centre)).toEqual([]);
  });

  it("drops a contact the projector puts behind the camera", () => {
    expect(run(mapOf(c()), () => null)).toEqual([]);
  });

  it("drops a contact projected off the edge, margin included", () => {
    expect(run(mapOf(c()), at(TAG_MARGIN_PX - 1, 350))).toEqual([]);
    expect(run(mapOf(c()), at(viewport.widthPx - TAG_MARGIN_PX + 1, 350))).toEqual([]);
    expect(run(mapOf(c()), at(500, -5))).toEqual([]);
  });

  it("drops a contact with no alt_geom — the same rule the globe billboards follow", () => {
    expect(run(mapOf(c({ alt_geom: null })), centre)).toEqual([]);
  });

  it("drops a contact beyond the tag range", () => {
    // ~2 degrees of latitude is ~120 NM, well past the 40 NM default.
    expect(run(mapOf(c({ lat: 32.0 })), centre)).toEqual([]);
  });

  it("keeps a contact in frame, with its screen position and its range", () => {
    const [tag] = run(mapOf(c()), at(420, 300));
    expect(tag.hex).toBe("a1b2c3");
    expect(tag.x).toBe(420);
    expect(tag.y).toBe(300);
    expect(tag.rangeNm).toBeCloseTo(3, 0); // 0.05 deg of latitude
  });

  it("orders tags nearest first", () => {
    const near = c({ hex: "aaa111", lat: 30.02 });
    const far = c({ hex: "bbb222", lat: 30.2 });
    const tags = run(mapOf(far, near), at(400, 200));
    expect(tags.map((t) => t.hex)).toEqual(["aaa111", "bbb222"]);
  });

  it("caps the number of tags so the windscreen stays readable", () => {
    const many = Array.from({ length: TAG_MAX_COUNT + 8 }, (_, i) =>
      c({ hex: `hex${i}`, lat: 30.01 + i * 0.001 }));
    // Spread them apart so the CAP is what bites, not the declutter. Exact, not
    // toBeLessThanOrEqual — that would pass just as happily if the function returned nothing.
    let n = 0;
    const spread: ProjectFn = () => {
      const i = n++;
      return { x: 80 + (i % 8) * 105, y: 80 + Math.floor(i / 8) * 120 };
    };
    expect(run(mapOf(...many), spread)).toHaveLength(TAG_MAX_COUNT);
  });

  it("declutters overlapping tags, keeping the nearer one", () => {
    const near = c({ hex: "aaa111", lat: 30.02 });
    const far = c({ hex: "bbb222", lat: 30.2 });
    const stacked: ProjectFn = (_lon, lat) => ({ x: 500, y: lat > 30.1 ? 352 : 350 });
    const tags = run(mapOf(near, far), stacked);
    expect(TAG_MIN_SPACING_PX).toBeGreaterThan(2);
    expect(tags.map((t) => t.hex)).toEqual(["aaa111"]);
  });

  it("marks the ghost so the player's own origin aircraft is distinguishable", () => {
    const [tag] = run(mapOf(c()), centre, { ghostHex: "a1b2c3" });
    expect(tag.ghost).toBe(true);
  });

  it("carries the feed's military flag through untouched", () => {
    expect(run(mapOf(c({ military: true })), centre)[0].military).toBe(true);
  });

  it("respects an explicit range override", () => {
    // 0.05 deg of latitude is ~3 NM, so a 1 NM limit must reject it and a 5 NM limit must not.
    expect(run(mapOf(c()), centre, { maxRangeNm: 1 })).toEqual([]);
    expect(run(mapOf(c()), centre, { maxRangeNm: 5 })).toHaveLength(1);
    expect(TAG_MAX_RANGE_NM).toBe(40);
  });

  it("respects an explicit count override", () => {
    const three = [0, 1, 2].map((i) => c({ hex: `hex${i}`, lat: 30.01 + i * 0.001 }));
    let n = 0;
    const spread: ProjectFn = () => ({ x: 200 + n++ * 120, y: 300 });
    expect(run(mapOf(...three), spread, { maxCount: 2 })).toHaveLength(2);
  });
});

describe("tag text", () => {
  it("prefers the callsign and falls back to the uppercase hex", () => {
    expect(tagLabel(c({ flight: "N12345" }))).toBe("N12345");
    expect(tagLabel(c({ flight: null }))).toBe("A1B2C3");
    expect(tagLabel(c({ flight: "   " }))).toBe("A1B2C3");
  });
  it("em-dashes an unknown type rather than guessing one", () => {
    expect(tagTypeLine(c({ t: null }))).toBe(EM_DASH);
    expect(tagTypeLine(c({ t: "B738" }))).toBe("B738");
  });
  it("reads altitude in whole feet from alt_geom", () => {
    expect(tagAltLine(c({ alt_geom: 3500 }))).toBe("3500 FT");
    expect(tagAltLine(c({ alt_geom: null }))).toBe(EM_DASH);
  });
});
```

- [ ] **Step 7: Run it and see it fail**

```bash
cd frontend && npm run test -- src/dashboard/trafficProjection.test.ts
```

Expected failure: `Error: Failed to resolve import "./trafficProjection"`.

- [ ] **Step 8: Write `trafficProjection.ts`**

```ts
// frontend/src/dashboard/trafficProjection.ts
/*
 * Which live contacts get a windscreen tag, and where on the screen it goes (spec D-3).
 *
 * Cesium-free by construction: the caller injects `project`, a world -> window function, and
 * this module does the rest with plain arithmetic. That is what makes every culling and
 * decluttering rule below a unit test rather than a thing you squint at in a browser.
 *
 * Honest-data rules encoded here:
 *  - the ONLY source of tags is the contact map handed in. There is no cache, no last-known
 *    position, no dead reckoning; a contact that left the feed has no tag on the next call.
 *  - a contact without `alt_geom` gets no tag, exactly as it gets no billboard
 *    (`contactHeightM`): its 3D position is unknown, and putting it at a plausible baro height
 *    would place a real aeroplane somewhere it is not.
 *  - fields the feed does not carry render as an em-dash, never as a guess.
 */
import type { Contact } from "../data/types";
// data/contactGeo.ts, NOT globe/contactBillboards.ts: the latter imports Cesium, and importing
// it here would make this module transitively Cesium-dependent (see this task's preamble).
import { contactHeightM } from "../data/contactGeo";
import { EM_DASH } from "../hud/format";
import { mToFt } from "../sim/units";
import { rangeNm } from "./geoRange";

export type ScreenXY = { x: number; y: number };
/** Injected by the render layer. Returns null when the point cannot be put on screen. */
export type ProjectFn = (lonDeg: number, latDeg: number, heightM: number) => ScreenXY | null;

export type TrafficTag = {
  hex: string;
  x: number;
  y: number;
  rangeNm: number;
  label: string;
  typeLine: string;
  altLine: string;
  military: boolean;
  ghost: boolean;
};

/** Keep tags clear of the screen edge, where half a tag reads as a glitch. */
export const TAG_MARGIN_PX = 24;
/** Two tags closer than this collapse into one — the nearer contact wins. */
export const TAG_MIN_SPACING_PX = 34;
export const TAG_MAX_COUNT = 12;
/** Past this the tag is unreadable clutter and the radar scope is the right instrument. */
export const TAG_MAX_RANGE_NM = 40;

export function tagLabel(c: Contact): string {
  const flight = c.flight?.trim();
  return flight ? flight : c.hex.toUpperCase();
}

export function tagTypeLine(c: Contact): string {
  return c.t ?? EM_DASH;
}

export function tagAltLine(c: Contact): string {
  const h = contactHeightM(c);
  return h === null ? EM_DASH : `${Math.round(mToFt(h))} FT`;
}

export function projectTraffic(input: {
  contacts: Map<string, Contact>;
  own: { latDeg: number; lonDeg: number };
  project: ProjectFn;
  viewport: { widthPx: number; heightPx: number };
  ghostHex: string | null;
  maxRangeNm?: number;
  maxCount?: number;
}): TrafficTag[] {
  const {
    contacts, own, project, viewport, ghostHex,
    maxRangeNm = TAG_MAX_RANGE_NM, maxCount = TAG_MAX_COUNT,
  } = input;

  const candidates: TrafficTag[] = [];
  for (const [hex, c] of contacts) {
    const heightM = contactHeightM(c);
    if (heightM === null) continue;

    const r = rangeNm(own.latDeg, own.lonDeg, c.lat, c.lon);
    if (r > maxRangeNm) continue;

    const xy = project(c.lon, c.lat, heightM);
    if (xy === null) continue;
    if (
      xy.x < TAG_MARGIN_PX || xy.x > viewport.widthPx - TAG_MARGIN_PX ||
      xy.y < TAG_MARGIN_PX || xy.y > viewport.heightPx - TAG_MARGIN_PX
    ) continue;

    candidates.push({
      hex,
      x: xy.x,
      y: xy.y,
      rangeNm: r,
      label: tagLabel(c),
      typeLine: tagTypeLine(c),
      altLine: tagAltLine(c),
      military: c.military,
      ghost: hex === ghostHex,
    });
  }

  // Nearest first, then drop anything that would land on top of a nearer tag, then cap.
  candidates.sort((a, b) => a.rangeNm - b.rangeNm);
  const kept: TrafficTag[] = [];
  for (const tag of candidates) {
    if (kept.length >= maxCount) break;
    const collides = kept.some(
      (k) => Math.hypot(k.x - tag.x, k.y - tag.y) < TAG_MIN_SPACING_PX,
    );
    if (!collides) kept.push(tag);
  }
  return kept;
}
```

- [ ] **Step 9: Run it and see it pass**

```bash
cd frontend && npm run test -- src/dashboard/trafficProjection.test.ts
```

Expected: `16 passed`. Running total: **522**.

---

- [ ] **Step 10: Write the failing enrichment-client test**

```ts
// frontend/src/data/api.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchTypeInfo, FeedDownError } from "./api";

const okJson = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchTypeInfo", () => {
  it("asks the backend proxy for the hex, never adsbdb directly", async () => {
    const fetchMock = okJson({ type: "172", manufacturer: "Cessna", registration: "N12345" });
    vi.stubGlobal("fetch", fetchMock);
    await fetchTypeInfo("a1b2c3");
    expect(fetchMock).toHaveBeenCalledWith("/api/type/a1b2c3");
  });

  it("returns the three enrichment fields", async () => {
    vi.stubGlobal("fetch", okJson({ type: "172", manufacturer: "Cessna", registration: "N12345" }));
    expect(await fetchTypeInfo("a1b2c3")).toEqual({
      type: "172", manufacturer: "Cessna", registration: "N12345",
    });
  });

  it("passes an all-null answer through rather than treating it as an error", async () => {
    // adsbdb genuinely not knowing this hex is a different state from adsbdb being down, and
    // the card renders them differently. The client must not flatten them together.
    vi.stubGlobal("fetch", okJson({ type: null, manufacturer: null, registration: null }));
    expect(await fetchTypeInfo("000000")).toEqual({
      type: null, manufacturer: null, registration: null,
    });
  });

  it("throws FeedDownError when the proxy answers badly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    await expect(fetchTypeInfo("a1b2c3")).rejects.toBeInstanceOf(FeedDownError);
  });
});
```

- [ ] **Step 11: Run it and see it fail**

```bash
cd frontend && npm run test -- src/data/api.test.ts
```

Expected failure: `SyntaxError: The requested module './api' does not provide an export named
'fetchTypeInfo'`.

- [ ] **Step 12: Add `TypeInfo` and `fetchTypeInfo`**

`frontend/src/data/types.ts`:

```ts
/** adsbdb enrichment, proxied through the backend's /api/type/{hex}. Any field may be null. */
export type TypeInfo = {
  type: string | null;
  manufacturer: string | null;
  registration: string | null;
};
```

`frontend/src/data/api.ts`:

```ts
import type { Contact, TypeInfo } from "./types";
```

```ts
/**
 * adsbdb enrichment for one contact. The backend already distinguishes "adsbdb says it has never
 * heard of this hex" (a 200 with all-null fields) from "adsbdb is unreachable" (also a 200 with
 * all-null fields, but uncached) — from the browser's side the difference we CAN see is a bad
 * HTTP status, which throws. The card renders three states from that; see TrafficDetailCard.
 */
export async function fetchTypeInfo(hex: string): Promise<TypeInfo> {
  const res = await fetch(`/api/type/${hex}`);
  if (!res.ok) throw new FeedDownError(res.status);
  return res.json();
}
```

- [ ] **Step 13: Run it and see it pass**

```bash
cd frontend && npm run test -- src/data/api.test.ts
```

Expected: `4 passed`. Running total: **526**.

---

- [ ] **Step 14: Write the failing tag and detail-card tests**

```tsx
// frontend/src/dashboard/TrafficTags.test.tsx
import { describe, it, expect } from "vitest";
import TrafficTags from "./TrafficTags";
import type { TrafficTag } from "./trafficProjection";

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

function findByProp(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) findByProp(c, key, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof type === "function") return findByProp((type as (p: unknown) => unknown)(props), key, out);
  if (props && key in props) out.push(props[key]);
  if (props && "children" in props) findByProp(props.children, key, out);
  return out;
}

const tag = (o: Partial<TrafficTag> = {}): TrafficTag => ({
  hex: "a1b2c3", x: 420, y: 300, rangeNm: 12.4, label: "N12345", typeLine: "C172",
  altLine: "3500 FT", military: false, ghost: false, ...o,
});

describe("TrafficTags", () => {
  it("renders nothing when there is nothing to render", () => {
    expect(collectText(TrafficTags({ tags: [], onSelect: () => {} }))).toEqual([]);
  });

  it("shows the callsign, type and altitude on each tag", () => {
    const text = collectText(TrafficTags({ tags: [tag()], onSelect: () => {} })).join(" ");
    expect(text).toContain("N12345");
    expect(text).toContain("C172");
    expect(text).toContain("3500 FT");
  });

  it("anchors each tag at the screen position the projection gave it", () => {
    const styles = findByProp(TrafficTags({ tags: [tag()], onSelect: () => {} }), "style");
    expect(styles).toContainEqual(expect.objectContaining({ left: 420, top: 300 }));
  });

  it("calls back with the hex when a tag is clicked", () => {
    const seen: string[] = [];
    const handlers = findByProp(
      TrafficTags({ tags: [tag()], onSelect: (h) => seen.push(h) }), "onClick",
    ) as (() => void)[];
    handlers.filter((h) => typeof h === "function").forEach((h) => h());
    expect(seen).toEqual(["a1b2c3"]);
  });

  it("distinguishes the ghost and military tags by class, not by inventing a field", () => {
    const classes = findByProp(
      TrafficTags({ tags: [tag({ ghost: true }), tag({ hex: "b", military: true })], onSelect: () => {} }),
      "className",
    ).join(" ");
    expect(classes).toContain("traffic-tag-ghost");
    expect(classes).toContain("traffic-tag-mil");
  });
});
```

```tsx
// frontend/src/dashboard/TrafficDetailCard.test.tsx
import { describe, it, expect } from "vitest";
import { TrafficDetailBody, type EnrichmentState } from "./TrafficDetailCard";
import type { Contact } from "../data/types";
import { EM_DASH } from "../hud/format";

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

const c = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.05, lon: -88.0,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: -320,
  military: false, seen_pos: 2, ...o,
});

const ok: EnrichmentState = {
  kind: "ok",
  info: { type: "172S Skyhawk", manufacturer: "Cessna", registration: "N12345" },
};

const render = (contact: Contact, enrichment: EnrichmentState) =>
  collectText(TrafficDetailBody({ contact, enrichment, onClose: () => {} })).join(" ");

describe("TrafficDetailBody — feed fields", () => {
  it("shows what the feed actually sent", () => {
    const text = render(c(), ok);
    expect(text).toContain("N12345");
    expect(text).toContain("A1B2C3");
    expect(text).toContain("C172");
    expect(text).toContain("3500");
    expect(text).toContain("105");
    expect(text).toContain("270");
  });

  it("em-dashes every field the feed omitted instead of showing a zero", () => {
    const text = render(
      c({ flight: null, t: null, alt_geom: null, gs: null, track: null, baro_rate: null, seen_pos: null }),
      ok,
    );
    expect(text).toContain(EM_DASH);
    expect(text).not.toMatch(/\b0 KT\b/);
  });

  it("renders alt_baro's literal 'ground' as GROUND, not as a number", () => {
    expect(render(c({ alt_baro: "ground" }), ok)).toContain("GROUND");
  });

  it("shows the military flag only when the feed set it", () => {
    expect(render(c({ military: true }), ok)).toContain("MILITARY");
    expect(render(c({ military: false }), ok)).not.toContain("MILITARY");
  });
});

describe("TrafficDetailBody — the three adsbdb states are distinct", () => {
  it("says the lookup is in flight while it is in flight", () => {
    const text = render(c(), { kind: "loading" });
    expect(text).toContain("ADSBDB LOOKUP…");
    expect(text).not.toContain("NO ADSBDB RECORD");
    expect(text).not.toContain("ADSBDB UNREACHABLE");
  });

  it("says NO ADSBDB RECORD when adsbdb answered and has never heard of the hex", () => {
    const text = render(c(), {
      kind: "ok", info: { type: null, manufacturer: null, registration: null },
    });
    expect(text).toContain("NO ADSBDB RECORD");
    expect(text).not.toContain("ADSBDB UNREACHABLE");
  });

  it("says ADSBDB UNREACHABLE when the lookup itself failed", () => {
    const text = render(c(), { kind: "unreachable" });
    expect(text).toContain("ADSBDB UNREACHABLE");
    expect(text).not.toContain("NO ADSBDB RECORD");
  });

  it("shows the enrichment when there is some", () => {
    const text = render(c(), ok);
    expect(text).toContain("Cessna");
    expect(text).toContain("172S Skyhawk");
  });

  it("em-dashes an individual missing enrichment field without claiming the whole record is absent", () => {
    const text = render(c(), {
      kind: "ok", info: { type: "172", manufacturer: null, registration: null },
    });
    expect(text).toContain("172");
    expect(text).toContain(EM_DASH);
    expect(text).not.toContain("NO ADSBDB RECORD");
  });
});
```

- [ ] **Step 15: Run them and see them fail**

```bash
cd frontend && npm run test -- src/dashboard/TrafficTags.test.tsx src/dashboard/TrafficDetailCard.test.tsx
```

Expected failure: `Error: Failed to resolve import "./TrafficTags"` and `"./TrafficDetailCard"`.

- [ ] **Step 16: Write `TrafficTags.tsx` and `TrafficDetailCard.tsx` plus their CSS**

```tsx
// frontend/src/dashboard/TrafficTags.tsx
/*
 * The windscreen tags themselves: absolutely-positioned DOM over the Cesium canvas, so a click
 * is an ordinary React onClick and nothing has to be taught to Cesium's picking. Hook-free, and
 * given nothing but the output of `projectTraffic` — no store, no viewer, no snapshot.
 */
import type { TrafficTag } from "./trafficProjection";

export default function TrafficTags({ tags, onSelect }: {
  tags: TrafficTag[];
  onSelect(hex: string): void;
}) {
  return (
    <>
      {tags.map((t) => (
        <button
          type="button"
          key={t.hex}
          className={[
            "traffic-tag",
            t.ghost ? "traffic-tag-ghost" : "",
            t.military ? "traffic-tag-mil" : "",
          ].filter(Boolean).join(" ")}
          style={{ left: t.x, top: t.y }}
          onClick={() => onSelect(t.hex)}
        >
          <span className="traffic-tag-label">{t.label}</span>
          <span className="traffic-tag-line">{t.typeLine}</span>
          <span className="traffic-tag-line">{t.altLine}</span>
        </button>
      ))}
    </>
  );
}
```

```tsx
// frontend/src/dashboard/TrafficDetailCard.tsx
/*
 * Click a windscreen tag, get this: everything the feed said about that aircraft, plus the
 * adsbdb enrichment from the backend's /api/type/{hex}.
 *
 * THREE adsbdb states, never collapsed into one, because they mean different things:
 *   loading      the lookup is in flight
 *   ok, all null adsbdb answered and has genuinely never heard of this hex
 *   unreachable  the lookup failed - we do not know whether adsbdb knows this hex
 * Every individual field the feed or adsbdb omitted is an em-dash.
 *
 * Split as usual: `TrafficDetailBody` is hook-free and holds every element (and every test);
 * `TrafficDetailCard` owns the fetch.
 */
import { useEffect, useState } from "react";
import type { Contact, TypeInfo } from "../data/types";
import { fetchTypeInfo } from "../data/api";
import { useStore } from "../state/store";
import { EM_DASH, formatHeadingDeg } from "../hud/format";
import { degToRad } from "../sim/units";

export type EnrichmentState =
  | { kind: "loading" }
  | { kind: "ok"; info: TypeInfo }
  | { kind: "unreachable" };

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="handoff-row">
      <span className="label">{label}</span>
      <span className="handoff-value">{value}</span>
    </div>
  );
}

const orDash = (v: string | number | null | undefined, suffix = ""): string =>
  v === null || v === undefined || v === "" ? EM_DASH : `${v}${suffix}`;

function baroLine(alt: Contact["alt_baro"]): string {
  if (alt === null) return EM_DASH;
  if (alt === "ground") return "GROUND";
  return `${alt} FT`;
}

export function TrafficDetailBody({ contact, enrichment, onClose }: {
  contact: Contact;
  enrichment: EnrichmentState;
  onClose(): void;
}) {
  const info = enrichment.kind === "ok" ? enrichment.info : null;
  const emptyRecord =
    info !== null && info.type === null && info.manufacturer === null && info.registration === null;

  return (
    <div className="traffic-card panel">
      <div className="label handoff-title">CONTACT</div>

      <Row label="CALLSIGN" value={orDash(contact.flight?.trim() ?? null)} />
      <Row label="HEX" value={contact.hex.toUpperCase()} />
      <Row label="TYPE (FEED)" value={orDash(contact.t)} />
      <Row label="ALT GEOM" value={orDash(contact.alt_geom, " FT")} />
      <Row label="ALT BARO" value={baroLine(contact.alt_baro)} />
      <Row label="GROUND SPEED" value={orDash(contact.gs === null ? null : Math.round(contact.gs), " KT")} />
      <Row label="TRACK" value={contact.track === null ? EM_DASH : formatHeadingDeg(degToRad(contact.track))} />
      <Row label="VERT RATE" value={orDash(contact.baro_rate, " FPM")} />
      <Row label="POSITION AGE" value={orDash(contact.seen_pos === null ? null : Math.round(contact.seen_pos), " S")} />
      {contact.military ? <div className="handoff-note">MILITARY (dbFlags)</div> : null}

      <div className="label handoff-title">ADSBDB</div>
      {enrichment.kind === "loading" && <div className="handoff-adjustment">ADSBDB LOOKUP…</div>}
      {enrichment.kind === "unreachable" && (
        <div className="handoff-note">ADSBDB UNREACHABLE — ENRICHMENT UNKNOWN</div>
      )}
      {emptyRecord && <div className="handoff-note">NO ADSBDB RECORD FOR THIS HEX</div>}
      {info !== null && !emptyRecord && (
        <>
          <Row label="TYPE" value={orDash(info.type)} />
          <Row label="MANUFACTURER" value={orDash(info.manufacturer)} />
          <Row label="REGISTRATION" value={orDash(info.registration)} />
        </>
      )}

      <button type="button" className="control-button" onClick={onClose}>CLOSE</button>
    </div>
  );
}

export default function TrafficDetailCard({ hex, onClose }: { hex: string; onClose(): void }) {
  const contact = useStore((s) => s.contacts.get(hex));
  const [enrichment, setEnrichment] = useState<EnrichmentState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setEnrichment({ kind: "loading" });
    fetchTypeInfo(hex)
      .then((info) => { if (!cancelled) setEnrichment({ kind: "ok", info }); })
      .catch(() => { if (!cancelled) setEnrichment({ kind: "unreachable" }); });
    return () => { cancelled = true; };
  }, [hex]);

  // The contact left the feed while the card was open. Closing is the honest response: a card
  // frozen on a last-known snapshot would keep looking live.
  if (!contact) return null;

  return <TrafficDetailBody contact={contact} enrichment={enrichment} onClose={onClose} />;
}
```

Append to `frontend/src/styles/tokens.css`:

```css
/* ---- windscreen traffic tags ---- */
.traffic-tag {
  position: absolute;
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
  border: 1px solid var(--grid);
  border-left: 1px solid var(--cyan);
  background: rgba(5, 7, 10, 0.62);
  color: var(--cyan);
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  padding: 2px 5px;
  cursor: pointer;
  pointer-events: auto;
  border-radius: 0;
}
.traffic-tag:hover { background: rgba(95, 215, 224, 0.16); }
.traffic-tag-label { font-size: 10px; }
.traffic-tag-line { color: var(--text); opacity: 0.75; }
.traffic-tag-mil { color: var(--amber); border-left-color: var(--amber); }
.traffic-tag-ghost { opacity: 0.55; border-left-style: dashed; }
.traffic-overlay { position: absolute; inset: 0; pointer-events: none; }
.traffic-card {
  position: absolute;
  top: 64px;
  right: 16px;
  width: 300px;
  max-height: 70%;
  overflow-y: auto;
  padding: 10px 12px;
  font-size: 11px;
  pointer-events: auto;
}
```

- [ ] **Step 17: Run them and see them pass**

```bash
cd frontend && npm run test -- src/dashboard/TrafficTags.test.tsx src/dashboard/TrafficDetailCard.test.tsx
```

Expected: `TrafficTags` 5 passed, `TrafficDetailCard` 9 passed. Running total: **540**.

---

- [ ] **Step 18: Verify the Cesium projection API before writing the adapter**

```bash
grep -n "function worldToWindowCoordinates" frontend/node_modules/@cesium/engine/index.d.ts
```

Expected (Cesium 1.143):
`function worldToWindowCoordinates(scene: Scene, position: Cartesian3, result?: Cartesian2): Cartesian2 | undefined;`

If the signature differs, **stop and adapt the adapter only** — the pure module takes an injected
function precisely so a Cesium API change is a one-file problem.

- [ ] **Step 19: Write `globe/TrafficOverlay.tsx` and wire it into the session**

```tsx
// frontend/src/globe/TrafficOverlay.tsx
/*
 * The ONLY Cesium in the windscreen-tag feature: build a world -> window projection out of
 * SceneTransforms, hand it to the pure `projectTraffic`, and render the result as DOM.
 *
 * Two things Cesium has to answer that arithmetic cannot:
 *  - is the contact IN FRONT of the camera? `worldToWindowCoordinates` will happily project a
 *    point behind the eye onto the screen, so the adapter takes the dot product of
 *    (contact - camera position) with the camera direction first and rejects anything behind.
 *  - what are the canvas's CSS pixel dimensions right now? `clientWidth`/`clientHeight`, read
 *    per update rather than cached, so a window resize needs no listener.
 *
 * Cadence: this recomputes when the ~10 Hz snapshot changes identity or the contact map changes
 * (~0.2 Hz), NOT per rendered frame. Tags therefore lag a fast camera slew by up to 100 ms,
 * which is the documented cost of not putting a per-frame React update in the render loop.
 *
 * Known limitation, recorded in decisions.md CD-007: there is no terrain occlusion test, so a
 * contact behind a ridge inside 40 NM still gets a tag.
 */
import { useSyncExternalStore } from "react";
import { Cartesian3, SceneTransforms } from "cesium";
import { useStore } from "../state/store";
import { useViewer } from "./viewerContext";
import { hudSnapshot } from "../hud/snapshot";
import { projectTraffic, type ProjectFn } from "../dashboard/trafficProjection";
import TrafficTags from "../dashboard/TrafficTags";

export default function TrafficOverlay({ onSelect }: { onSelect(hex: string): void }) {
  const bundle = useViewer();
  const contacts = useStore((s) => s.contacts);
  const origin = useStore((s) => s.origin);
  const snapshot = useSyncExternalStore(hudSnapshot.subscribe, hudSnapshot.get, hudSnapshot.get);

  if (!bundle || snapshot === null) return null;
  const scene = bundle.viewer.scene;
  const canvas = scene.canvas;

  const project: ProjectFn = (lonDeg, latDeg, heightM) => {
    const world = Cartesian3.fromDegrees(lonDeg, latDeg, heightM);
    const toContact = Cartesian3.subtract(world, scene.camera.positionWC, new Cartesian3());
    if (Cartesian3.dot(toContact, scene.camera.directionWC) <= 0) return null; // behind the eye
    const win = SceneTransforms.worldToWindowCoordinates(scene, world);
    return win ? { x: win.x, y: win.y } : null;
  };

  const tags = projectTraffic({
    contacts,
    own: { latDeg: snapshot.latDeg, lonDeg: snapshot.lonDeg },
    project,
    viewport: { widthPx: canvas.clientWidth, heightPx: canvas.clientHeight },
    ghostHex: origin?.hex ?? null,
  });

  return (
    <div className="traffic-overlay">
      <TrafficTags tags={tags} onSelect={onSelect} />
    </div>
  );
}
```

`frontend/src/game/FlightSession.tsx` — one piece of state and two renders:

```tsx
import TrafficOverlay from "../globe/TrafficOverlay";
import TrafficDetailCard from "../dashboard/TrafficDetailCard";
```

```tsx
  const [trafficHex, setTrafficHex] = useState<string | null>(null);
```

Add `setTrafficHex(null);` to `teardown()`, next to `setResumeArmed(false)`, then render:

```tsx
      {(mode === "FLYING" || mode === "PAUSED") && (
        <>
          <TrafficOverlay onSelect={setTrafficHex} />
          {trafficHex !== null && (
            <TrafficDetailCard hex={trafficHex} onClose={() => setTrafficHex(null)} />
          )}
        </>
      )}
```

`ENDED` is deliberately excluded: the end card owns the screen and the mouse is handed back for
orbiting (decisions B-015), so clickable tags over the impact site would fight that.

- [ ] **Step 20: Full suite, typecheck, log CD-007, one commit**

```bash
cd frontend && npm run test && npm run typecheck
```

Expected: `Tests 540 passed (540)`, typecheck clean. `TrafficOverlay.tsx` has no test of its own —
it needs a live `Scene`, and every rule it applies beyond that lives in `trafficProjection.ts`,
which does. That is recorded in the decision below and checked by hand in Task 6's walkthrough.

Append to `docs/decisions.md`:

```markdown
## 2026-08-07 — CD-007 · Windscreen tags are DOM over the canvas, projected at snapshot cadence

Tags are absolutely-positioned DOM elements over the Cesium canvas, not Cesium billboards or
labels. Three reasons: a click is then an ordinary React `onClick` (no second picking path
alongside `ViewerHost`'s BROWSE-only handler); the LORAN card styling is CSS the app already has;
and the whole selection rule stays in a pure module. The Cesium half is one function —
`SceneTransforms.worldToWindowCoordinates` plus a front-of-camera dot product — in
`globe/TrafficOverlay.tsx`.

**Cadence:** tags recompute when the ~10 Hz snapshot changes identity or the contact map changes,
not per rendered frame. A fast camera slew can therefore drag its tags by up to 100 ms. That is
the accepted price of keeping React out of the render loop, which is the same rule the HUD has
followed since Phase B.

**Known limitation:** no terrain occlusion test. A contact behind a ridge inside the 40 NM tag
range still gets a tag. The fix (an `EllipsoidalOccluder` plus a terrain-height ray) is real work
for a small honesty gain — the tag is not claiming line of sight — so it is recorded here rather
than silently missing. `globe/TrafficOverlay.tsx` itself is untested (it needs a live `Scene`);
everything it decides beyond projection is in `dashboard/trafficProjection.ts`, which has 16.
```

```bash
git add frontend/src/dashboard frontend/src/globe frontend/src/data frontend/src/game frontend/src/styles docs/decisions.md && git commit -m "feat(dashboard): windscreen traffic tags and the adsbdb detail card"
```

---
### Task 4: The radar scope — real contacts, own-ship centred, heading-up

D-4. The store already holds every live contact; this task projects them onto a PPI scope. Blips
are live contacts and nothing else: no synthetic traffic, no last-known plot, and when the feed is
down the scope says so instead of showing an empty-but-nominal picture.

**SVG or canvas — SVG, and here is why.** The scope draws at most a few dozen blips at ~10 Hz,
which is nothing for the DOM. SVG buys three things canvas does not: the component stays a pure
function of its props (so the element-tree walker tests it without jsdom, whereas a canvas would
need a mocked 2D context or a real DOM); there is no imperative draw loop, no
`devicePixelRatio` handling and no resize observer to leak in StrictMode; and it is the same
idiom as `SixPack`, so `dashboard/` has exactly one way of drawing an instrument. Recorded as
CD-008.

**A contact with no `alt_geom` still gets a blip.** That is not a contradiction of the globe rule.
A billboard needs a 3D position and `alt_baro` is the wrong datum for one; a PPI plot needs
latitude and longitude, which the feed gave us. The blip is drawn and its altitude reads as an
em-dash in the detail card — an honest 2D plot, not a guessed 3D one.

**Files:**
- Create: `frontend/src/dashboard/radarMath.ts`, `frontend/src/dashboard/RadarScope.tsx`
- Test: `frontend/src/dashboard/radarMath.test.ts`, `frontend/src/dashboard/RadarScope.test.tsx`
- Modify: `frontend/src/dashboard/DashboardStrip.tsx`, `frontend/src/dashboard/DashboardStrip.test.tsx`, `frontend/src/game/FlightSession.tsx`, `frontend/src/styles/tokens.css`, `docs/decisions.md`

**Interfaces:**
- Consumes: `Contact`, `FeedStatus` (`data/types.ts`); `rangeNm`, `bearingDeg` (`dashboard/geoRange.ts`); `HudSnapshot` (`hud/snapshot.ts`); `formatHeadingDeg` (`hud/format.ts`); `radToDeg` (`sim/units.ts`).
- Produces:
  - `dashboard/radarMath.ts`:
    - `RANGE_PRESETS_NM: readonly number[]` = `[10, 40, 80, 150, 250]`
    - `DEFAULT_RANGE_NM = 40`, `SCOPE_RADIUS_PX = 96`, `MAX_BLIPS = 60`
    - `type Blip = { hex: string; x: number; y: number; rangeNm: number; military: boolean; ghost: boolean }`
    - `type ScopeStatus = { text: string | null; dim: boolean }`
    - `scopeXY(o: { rangeNm: number; bearingDeg: number; ownHeadingDeg: number; scopeRangeNm: number; radiusPx?: number }): ScreenXY`
    - `ringsFor(scopeRangeNm: number, radiusPx?: number): { radiusPx: number; labelNm: number }[]`
    - `blipsFor(o): Blip[]`
    - `scopeStatus(feedStatus: FeedStatus): ScopeStatus`
  - `dashboard/RadarScope.tsx`: default export `RadarScope({ snapshot, contacts, feedStatus, ghostHex, scopeRangeNm, onRangeChange })` — hook-free.

---

- [ ] **Step 1: Write the failing radar-math tests**

```ts
// frontend/src/dashboard/radarMath.test.ts
import { describe, it, expect } from "vitest";
import {
  RANGE_PRESETS_NM, DEFAULT_RANGE_NM, SCOPE_RADIUS_PX, MAX_BLIPS,
  scopeXY, ringsFor, blipsFor, scopeStatus,
} from "./radarMath";
import type { Contact } from "../data/types";

const own = { latDeg: 30.0, lonDeg: -88.0 };
const c = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.05, lon: -88.0,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});
const mapOf = (...cs: Contact[]) => new Map(cs.map((x) => [x.hex, x]));

describe("range presets", () => {
  it("are exactly the ladder the spec asks for", () => {
    expect([...RANGE_PRESETS_NM]).toEqual([10, 40, 80, 150, 250]);
    expect(RANGE_PRESETS_NM).toContain(DEFAULT_RANGE_NM);
  });
});

describe("scopeXY — own-ship centred, heading up", () => {
  it("puts a contact dead ahead at the top of the scope", () => {
    const p = scopeXY({ rangeNm: 20, bearingDeg: 0, ownHeadingDeg: 0, scopeRangeNm: 40 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(-SCOPE_RADIUS_PX / 2, 6);
  });

  it("is HEADING UP: flying east, a contact to the east is still dead ahead", () => {
    const p = scopeXY({ rangeNm: 20, bearingDeg: 90, ownHeadingDeg: 90, scopeRangeNm: 40 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(-SCOPE_RADIUS_PX / 2, 6);
  });

  it("puts a contact 90 degrees right on the right-hand side", () => {
    const p = scopeXY({ rangeNm: 40, bearingDeg: 90, ownHeadingDeg: 0, scopeRangeNm: 40 });
    expect(p.x).toBeCloseTo(SCOPE_RADIUS_PX, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it("puts a contact behind at the bottom", () => {
    const p = scopeXY({ rangeNm: 40, bearingDeg: 180, ownHeadingDeg: 0, scopeRangeNm: 40 });
    expect(p.y).toBeCloseTo(SCOPE_RADIUS_PX, 6);
  });

  it("scales linearly with range, hitting the rim at the selected range", () => {
    const half = scopeXY({ rangeNm: 40, bearingDeg: 0, ownHeadingDeg: 0, scopeRangeNm: 80 });
    const rim = scopeXY({ rangeNm: 80, bearingDeg: 0, ownHeadingDeg: 0, scopeRangeNm: 80 });
    expect(Math.abs(half.y)).toBeCloseTo(SCOPE_RADIUS_PX / 2, 6);
    expect(Math.abs(rim.y)).toBeCloseTo(SCOPE_RADIUS_PX, 6);
  });

  it("puts own ship exactly at the centre", () => {
    const p = scopeXY({ rangeNm: 0, bearingDeg: 0, ownHeadingDeg: 123, scopeRangeNm: 40 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
});

describe("ringsFor", () => {
  it("draws three rings at thirds of the selected range", () => {
    const rings = ringsFor(150);
    expect(rings).toHaveLength(3);
    expect(rings.map((r) => r.labelNm)).toEqual([50, 100, 150]);
  });
  it("puts the outer ring on the scope's own radius", () => {
    expect(ringsFor(40)[2].radiusPx).toBeCloseTo(SCOPE_RADIUS_PX, 6);
  });
  it("labels a range that does not divide evenly without inventing precision", () => {
    expect(ringsFor(10).map((r) => r.labelNm)).toEqual([3, 7, 10]);
  });
});

describe("blipsFor", () => {
  const run = (contacts: Map<string, Contact>, o: Record<string, unknown> = {}) =>
    blipsFor({ contacts, own, ownHeadingDeg: 0, scopeRangeNm: 40, ghostHex: null, ...o });

  it("shows nothing when the feed has nothing — no residual plots", () => {
    expect(run(new Map())).toEqual([]);
  });

  it("plots a contact inside the selected range", () => {
    const blips = run(mapOf(c()));
    expect(blips).toHaveLength(1);
    expect(blips[0].hex).toBe("a1b2c3");
    expect(blips[0].rangeNm).toBeCloseTo(3, 0);
  });

  it("drops a contact beyond the selected range", () => {
    expect(run(mapOf(c({ lat: 32.0 })), { scopeRangeNm: 10 })).toEqual([]);
    expect(run(mapOf(c({ lat: 32.0 })), { scopeRangeNm: 250 })).toHaveLength(1);
  });

  it("keeps a contact whose ALTITUDE is unknown — a PPI plot needs position, not altitude", () => {
    expect(run(mapOf(c({ alt_geom: null })))).toHaveLength(1);
  });

  it("carries the military flag and the ghost flag through", () => {
    expect(run(mapOf(c({ military: true })))[0].military).toBe(true);
    expect(run(mapOf(c()), { ghostHex: "a1b2c3" })[0].ghost).toBe(true);
  });

  it("rotates the picture with own heading", () => {
    const north = run(mapOf(c()))[0];             // contact due north, flying north
    const east = run(mapOf(c()), { ownHeadingDeg: 90 })[0]; // same contact, flying east
    expect(north.y).toBeLessThan(0);
    expect(east.x).toBeLessThan(0); // north is now off the left wing
  });

  it("caps the plot count so a 250 NM sweep cannot flood the scope", () => {
    const many = Array.from({ length: MAX_BLIPS + 20 }, (_, i) =>
      c({ hex: `hex${i}`, lat: 30.0 + i * 0.002 }));
    expect(run(mapOf(...many), { scopeRangeNm: 250 }).length).toBe(MAX_BLIPS);
  });

  it("keeps the NEAREST when it has to cap", () => {
    const many = Array.from({ length: MAX_BLIPS + 5 }, (_, i) =>
      c({ hex: `hex${i}`, lat: 30.0 + (i + 1) * 0.01 }));
    const blips = run(mapOf(...many), { scopeRangeNm: 250 });
    expect(blips[0].hex).toBe("hex0");
    expect(blips.map((b) => b.hex)).not.toContain(`hex${MAX_BLIPS + 4}`);
  });
});

describe("scopeStatus", () => {
  it("says nothing extra when the feed is live", () => {
    expect(scopeStatus("live")).toEqual({ text: null, dim: false });
  });
  it("states the offline case explicitly rather than showing a clean empty scope", () => {
    expect(scopeStatus("offline").text).toBe("RADAR OFFLINE · NO FEED");
    expect(scopeStatus("offline").dim).toBe(true);
  });
  it("says the plots are frozen when the feed is stale", () => {
    expect(scopeStatus("stale").text).toBe("FEED STALE · BLIPS FROZEN");
    expect(scopeStatus("stale").dim).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd frontend && npm run test -- src/dashboard/radarMath.test.ts
```

Expected failure: `Error: Failed to resolve import "./radarMath"`.

- [ ] **Step 3: Write `radarMath.ts`**

```ts
// frontend/src/dashboard/radarMath.ts
/*
 * PPI scope geometry (spec D-4): own ship at the centre, heading up, linear range rings.
 * Cesium-free and React-free — the scope is a coordinate transform plus three filters, and all
 * three are tested here rather than eyeballed on a globe.
 *
 * Honest-data rules encoded here:
 *  - blips come from the contact map handed in and from nowhere else. No plot history, no
 *    extrapolation, no synthetic returns.
 *  - a contact whose ALTITUDE is unknown is still plotted: a PPI plot needs lat/lon, which the
 *    feed gave us. (That is different from the globe billboards, which need a 3D position and so
 *    skip a contact without alt_geom.)
 *  - `scopeStatus` turns the feed's own state into a statement on the face, so an empty scope is
 *    never ambiguous between "no traffic" and "no feed".
 */
import type { Contact, FeedStatus } from "../data/types";
import { bearingDeg, rangeNm } from "./geoRange";
import type { ScreenXY } from "./trafficProjection";

export const RANGE_PRESETS_NM: readonly number[] = [10, 40, 80, 150, 250];
export const DEFAULT_RANGE_NM = 40;
export const SCOPE_RADIUS_PX = 96;
export const MAX_BLIPS = 60;

export type Blip = {
  hex: string;
  x: number;
  y: number;
  rangeNm: number;
  military: boolean;
  ghost: boolean;
};

export type ScopeStatus = { text: string | null; dim: boolean };

/** Scope-centred pixels: +x right, +y down (SVG's own axes), origin = own ship. */
export function scopeXY(o: {
  rangeNm: number;
  bearingDeg: number;
  ownHeadingDeg: number;
  scopeRangeNm: number;
  radiusPx?: number;
}): ScreenXY {
  const radiusPx = o.radiusPx ?? SCOPE_RADIUS_PX;
  const r = (o.rangeNm / o.scopeRangeNm) * radiusPx;
  const relRad = ((o.bearingDeg - o.ownHeadingDeg) * Math.PI) / 180;
  return { x: r * Math.sin(relRad), y: -r * Math.cos(relRad) };
}

/** Three rings at thirds of the selected range; labels are whole NM, never fake decimals. */
export function ringsFor(
  scopeRangeNm: number,
  radiusPx: number = SCOPE_RADIUS_PX,
): { radiusPx: number; labelNm: number }[] {
  return [1, 2, 3].map((i) => ({
    radiusPx: (radiusPx * i) / 3,
    labelNm: Math.round((scopeRangeNm * i) / 3),
  }));
}

export function blipsFor(o: {
  contacts: Map<string, Contact>;
  own: { latDeg: number; lonDeg: number };
  ownHeadingDeg: number;
  scopeRangeNm: number;
  ghostHex: string | null;
  radiusPx?: number;
  maxBlips?: number;
}): Blip[] {
  const { contacts, own, ownHeadingDeg, scopeRangeNm, ghostHex } = o;
  const maxBlips = o.maxBlips ?? MAX_BLIPS;

  const out: Blip[] = [];
  for (const [hex, c] of contacts) {
    const r = rangeNm(own.latDeg, own.lonDeg, c.lat, c.lon);
    if (r > scopeRangeNm) continue;
    const b = bearingDeg(own.latDeg, own.lonDeg, c.lat, c.lon);
    const xy = scopeXY({
      rangeNm: r, bearingDeg: b, ownHeadingDeg, scopeRangeNm, radiusPx: o.radiusPx,
    });
    out.push({
      hex, x: xy.x, y: xy.y, rangeNm: r, military: c.military, ghost: hex === ghostHex,
    });
  }
  // Nearest first, so the cap drops the far edge of a 250 NM sweep rather than a Map-order
  // arbitrary subset.
  out.sort((a, b) => a.rangeNm - b.rangeNm);
  return out.slice(0, maxBlips);
}

/** The feed's state, said out loud on the scope face. Same semantics as the status-bar chip. */
export function scopeStatus(feedStatus: FeedStatus): ScopeStatus {
  if (feedStatus === "offline") return { text: "RADAR OFFLINE · NO FEED", dim: true };
  if (feedStatus === "stale") return { text: "FEED STALE · BLIPS FROZEN", dim: true };
  return { text: null, dim: false };
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd frontend && npm run test -- src/dashboard/radarMath.test.ts
```

Expected: `21 passed`. Running total: **561**.

---

- [ ] **Step 5: Write the failing scope-component test**

```tsx
// frontend/src/dashboard/RadarScope.test.tsx
import { describe, it, expect } from "vitest";
import RadarScope from "./RadarScope";
import { RANGE_PRESETS_NM } from "./radarMath";
import type { Contact } from "../data/types";
import type { HudSnapshot } from "../hud/snapshot";
import { ktToMs, ftToM, degToRad } from "../sim/units";

const snap = (o: Partial<HudSnapshot> = {}): HudSnapshot => ({
  iasMs: ktToMs(100), tasMs: ktToMs(110), altitudeM: ftToM(3500), verticalSpeedMs: 0,
  headingRad: 0, pitchRad: 0, rollRad: 0, turnRateRadS: 0, sideslipRad: 0,
  latDeg: 30.0, lonDeg: -88.0, aoaRad: degToRad(3), loadFactor: 1, throttle: 0.6,
  flapLabel: "0", gear: "fixed", stalled: false, overspeed: false, gLimited: false,
  terrainClearanceM: ftToM(2000), terrainUnverified: false, simRate: 1, airtimeS: 0,
  classLabel: "C172S", callsign: "SIM-A1B2C3", modelNote: "C172 MODEL THIS BUILD", ...o,
});

const c = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.05, lon: -88.0,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2, ...o,
});

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const x of node) collectText(x, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

function collectProp(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const x of node) collectProp(x, key, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof type === "function") return collectProp((type as (p: unknown) => unknown)(props), key, out);
  if (props && key in props) out.push(props[key]);
  if (props && "children" in props) collectProp(props.children, key, out);
  return out;
}

const base = {
  snapshot: snap(),
  contacts: new Map([["a1b2c3", c()]]),
  feedStatus: "live" as const,
  ghostHex: null,
  scopeRangeNm: 40,
  onRangeChange: () => {},
};

describe("RadarScope", () => {
  it("labels the three range rings in nautical miles", () => {
    const text = collectText(RadarScope(base)).join(" ");
    expect(text).toContain("13");
    expect(text).toContain("27");
    expect(text).toContain("40");
  });

  it("offers every range preset as its own button", () => {
    const text = collectText(RadarScope(base)).join(" ");
    for (const nm of RANGE_PRESETS_NM) expect(text).toContain(String(nm));
  });

  it("marks the selected range", () => {
    const classes = collectProp(RadarScope({ ...base, scopeRangeNm: 150 }), "className").join(" ");
    expect(classes).toContain("status-chip-button-active");
  });

  it("plots one blip per contact in range", () => {
    const hexes = collectProp(RadarScope(base), "data-hex");
    expect(hexes).toEqual(["a1b2c3"]);
  });

  it("says RADAR OFFLINE · NO FEED rather than showing a clean empty scope", () => {
    const text = collectText(
      RadarScope({ ...base, contacts: new Map(), feedStatus: "offline" }),
    ).join(" ");
    expect(text).toContain("RADAR OFFLINE · NO FEED");
  });

  it("says the plots are frozen when the feed is stale", () => {
    const text = collectText(RadarScope({ ...base, feedStatus: "stale" })).join(" ");
    expect(text).toContain("FEED STALE · BLIPS FROZEN");
  });

  it("says neither when the feed is live and there simply is no traffic", () => {
    const text = collectText(RadarScope({ ...base, contacts: new Map() })).join(" ");
    expect(text).not.toContain("OFFLINE");
    expect(text).not.toContain("STALE");
  });

  it("always draws the own-ship mark, even with no snapshot", () => {
    const classes = collectProp(RadarScope({ ...base, snapshot: null }), "className").join(" ");
    expect(classes).toContain("radar-own");
  });

  it("plots nothing at all without a snapshot — there is no own position to measure from", () => {
    expect(collectProp(RadarScope({ ...base, snapshot: null }), "data-hex")).toEqual([]);
  });
});
```

- [ ] **Step 6: Run it and see it fail**

```bash
cd frontend && npm run test -- src/dashboard/RadarScope.test.tsx
```

Expected failure: `Error: Failed to resolve import "./RadarScope"`.

- [ ] **Step 7: Write `RadarScope.tsx` and its CSS**

```tsx
// frontend/src/dashboard/RadarScope.tsx
/*
 * The PPI scope (spec D-4). SVG rather than canvas (decisions.md CD-008): a few dozen blips at
 * 10 Hz is nothing for the DOM, it keeps this a pure function of its props — which is what makes
 * it testable without jsdom — and it is the same drawing idiom as SixPack.
 *
 * Hook-free. The selected range is state in DashboardStrip, handed down and changed by callback,
 * for the same reason panel collapse is (CD-006).
 */
import type { Contact, FeedStatus } from "../data/types";
import type { HudSnapshot } from "../hud/snapshot";
import { formatHeadingDeg } from "../hud/format";
import { radToDeg } from "../sim/units";
import {
  RANGE_PRESETS_NM, SCOPE_RADIUS_PX, blipsFor, ringsFor, scopeStatus,
} from "./radarMath";

const SIZE = SCOPE_RADIUS_PX * 2 + 16; // a little bezel outside the outer ring
const C = SIZE / 2;

export default function RadarScope({
  snapshot, contacts, feedStatus, ghostHex, scopeRangeNm, onRangeChange,
}: {
  snapshot: HudSnapshot | null;
  contacts: Map<string, Contact>;
  feedStatus: FeedStatus;
  ghostHex: string | null;
  scopeRangeNm: number;
  onRangeChange(nm: number): void;
}) {
  const status = scopeStatus(feedStatus);
  const ownHeadingDeg = snapshot === null ? 0 : radToDeg(snapshot.headingRad);
  const blips =
    snapshot === null
      ? []
      : blipsFor({
          contacts,
          own: { latDeg: snapshot.latDeg, lonDeg: snapshot.lonDeg },
          ownHeadingDeg,
          scopeRangeNm,
          ghostHex,
        });

  return (
    <div className="radar">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={status.dim ? "radar-face radar-dim" : "radar-face"} role="img">
        {ringsFor(scopeRangeNm).map((ring) => (
          <g key={ring.labelNm}>
            <circle cx={C} cy={C} r={ring.radiusPx} className="radar-ring" />
            <text x={C + 3} y={C - ring.radiusPx + 9} className="radar-ring-label">
              {ring.labelNm}
            </text>
          </g>
        ))}
        <line x1={C} y1={C - SCOPE_RADIUS_PX} x2={C} y2={C + SCOPE_RADIUS_PX} className="radar-ring" />
        <line x1={C - SCOPE_RADIUS_PX} y1={C} x2={C + SCOPE_RADIUS_PX} y2={C} className="radar-ring" />

        {blips.map((b) => (
          <rect
            key={b.hex}
            data-hex={b.hex}
            x={C + b.x - 2}
            y={C + b.y - 2}
            width={4}
            height={4}
            className={[
              "radar-blip",
              b.military ? "radar-blip-mil" : "",
              b.ghost ? "radar-blip-ghost" : "",
            ].filter(Boolean).join(" ")}
          />
        ))}

        <path d={`M ${C} ${C - 7} L ${C - 5} ${C + 5} L ${C} ${C + 2} L ${C + 5} ${C + 5} Z`}
          className="radar-own" />
      </svg>

      <div className="radar-footer">
        <span className="radar-heading">HDG {formatHeadingDeg(snapshot?.headingRad ?? null)}</span>
        {status.text !== null && <span className="radar-status">{status.text}</span>}
      </div>

      <div className="radar-ranges">
        {RANGE_PRESETS_NM.map((nm) => (
          <button
            type="button"
            key={nm}
            className={
              nm === scopeRangeNm
                ? "status-chip-button status-chip-button-active"
                : "status-chip-button"
            }
            onClick={() => onRangeChange(nm)}
          >
            {nm}
          </button>
        ))}
        <span className="radar-range-unit">NM</span>
      </div>
    </div>
  );
}
```

Append to `frontend/src/styles/tokens.css`:

```css
/* ---- radar scope: PPI, own ship centred, heading up ---- */
.radar { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.radar-face { width: 168px; height: 168px; }
.radar-dim { opacity: 0.45; }
.radar-ring { fill: none; stroke: var(--grid); stroke-width: 1; }
.radar-ring-label {
  fill: var(--text);
  opacity: 0.55;
  font-family: var(--mono);
  font-size: 9px;
}
.radar-blip { fill: var(--cyan); }
.radar-blip-mil { fill: var(--amber); }
.radar-blip-ghost { fill: var(--amber); opacity: 0.45; }
.radar-own { fill: none; stroke: var(--amber); stroke-width: 1.5; }
.radar-footer { display: flex; gap: 8px; font-size: 9px; letter-spacing: 0.06em; }
.radar-heading { color: var(--cyan); }
.radar-status { color: var(--amber); }
.radar-ranges { display: flex; align-items: center; gap: 3px; }
.radar-range-unit { color: var(--text); opacity: 0.6; font-size: 9px; }
.status-chip-button-active {
  background: rgba(95, 215, 224, 0.2);
  border-color: var(--cyan);
}
```

- [ ] **Step 8: Run it and see it pass**

```bash
cd frontend && npm run test -- src/dashboard/RadarScope.test.tsx
```

Expected: `9 passed`. Running total: **570**.

---

- [ ] **Step 9: Write the failing strip-integration test**

Append to `frontend/src/dashboard/DashboardStrip.test.tsx`:

```tsx
describe("the radar panel joins the strip", () => {
  it("titles it, between the instruments and the placeholders", () => {
    const text = body();
    expect(text).toContain("RADAR");
    expect(text.indexOf("INSTRUMENTS")).toBeLessThan(text.indexOf("RADAR"));
    expect(text.indexOf("RADAR")).toBeLessThan(text.indexOf("WEATHER"));
  });

  it("collapses on its own like every other panel", () => {
    const text = body(togglePanel(defaultStripState(), "radar"));
    expect(text).toContain("RADAR");
    expect(text).not.toContain("NM");
  });

  it("starts on the 40 NM range", () => {
    expect(DEFAULT_RANGE_NM).toBe(40);
    expect(defaultStripState().scopeRangeNm).toBe(40);
  });
});
```

Add `DEFAULT_RANGE_NM` to the file's imports from `./radarMath`, and extend the `body()` helper's
argument object with the three new props:

```tsx
const body = (state = defaultStripState()) =>
  collectText(
    DashboardStripBody({
      state, snapshot: null, params: P, contacts: new Map(), feedStatus: "live", ghostHex: null,
      onTogglePanel: () => {}, onToggleStrip: () => {}, onRangeChange: () => {},
    }),
  ).join(" ");
```

- [ ] **Step 10: Run it and see it fail**

```bash
cd frontend && npm run test -- src/dashboard/DashboardStrip.test.tsx
```

Expected failure: `expected "…INSTRUMENTS WEATHER ATC CONTROLS…" to contain "RADAR"`, plus
`expected undefined to be 40` on the range test.

- [ ] **Step 11: Add the radar panel to the strip**

`frontend/src/dashboard/DashboardStrip.tsx` — the state gains the selected range (same locality
argument as collapse: one subtree, human cadence, resets with the flight):

```ts
export type StripState = {
  open: boolean;
  collapsed: Record<PanelId, boolean>;
  scopeRangeNm: number;
};

export function defaultStripState(): StripState {
  return {
    open: true,
    collapsed: { gauges: false, radar: false, weather: false, atc: false, help: true },
    scopeRangeNm: DEFAULT_RANGE_NM,
  };
}

export function setScopeRange(s: StripState, nm: number): StripState {
  return { ...s, scopeRangeNm: nm };
}
```

`DashboardStripBody` gains the three feed props and the radar frame, placed between the
instruments and the placeholders:

```tsx
export function DashboardStripBody({
  state, snapshot, params, contacts, feedStatus, ghostHex,
  onTogglePanel, onToggleStrip, onRangeChange,
}: {
  state: StripState;
  snapshot: HudSnapshot | null;
  params: ClassParams;
  contacts: Map<string, Contact>;
  feedStatus: FeedStatus;
  ghostHex: string | null;
  onTogglePanel(id: PanelId): void;
  onToggleStrip(): void;
  onRangeChange(nm: number): void;
}) {
```

```tsx
      <PanelFrame title="RADAR" collapsed={state.collapsed.radar}
        onToggle={() => onTogglePanel("radar")}>
        <RadarScope
          snapshot={snapshot}
          contacts={contacts}
          feedStatus={feedStatus}
          ghostHex={ghostHex}
          scopeRangeNm={state.scopeRangeNm}
          onRangeChange={onRangeChange}
        />
      </PanelFrame>
```

and the container reads the feed from the store — the only three store subscriptions the strip has:

```tsx
export default function DashboardStrip({ snapshot }: { snapshot: HudSnapshot | null }) {
  const [state, setState] = useState<StripState>(defaultStripState);
  const contacts = useStore((s) => s.contacts);
  const feedStatus = useStore((s) => s.feedStatus);
  const origin = useStore((s) => s.origin);
  const params = loadC172();
  // ... the keydown effect is unchanged ...
  return (
    <DashboardStripBody
      state={state}
      snapshot={snapshot}
      params={params}
      contacts={contacts}
      feedStatus={feedStatus}
      ghostHex={origin?.hex ?? null}
      onTogglePanel={(id) => setState((s) => togglePanel(s, id))}
      onToggleStrip={() => setState(toggleStrip)}
      onRangeChange={(nm) => setState((s) => setScopeRange(s, nm))}
    />
  );
}
```

- [ ] **Step 12: Run it and see it pass**

```bash
cd frontend && npm run test -- src/dashboard
```

Expected: `DashboardStrip.test.tsx` 13 passed, everything else in `src/dashboard` unchanged.
Running total: **573**.

- [ ] **Step 13: Log CD-008, full suite, typecheck, one commit**

Append to `docs/decisions.md`:

```markdown
## 2026-08-07 — CD-008 · The radar scope is SVG, not canvas

Both were on the table (spec §3 says "2D canvas or SVG"). SVG wins on three counts and loses on
none that matter at this scale: the component stays a pure function of its props, so the
element-tree walker tests it with no jsdom and no mocked 2D context; there is no imperative draw
loop, no `devicePixelRatio` handling and no resize observer to leak under StrictMode; and it is
the same idiom as `SixPack`, so `dashboard/` has one way of drawing an instrument rather than two.
The load is at most `MAX_BLIPS` (60) rectangles updated at ~10 Hz, which is not a DOM problem.

Two smaller calls recorded with it. **A contact with no `alt_geom` still gets a blip** — a PPI
plot needs latitude and longitude, which the feed gave us, unlike the globe billboards which need
a 3D position and correctly skip it. **The scope caps at 60 nearest blips**, so a 250 NM sweep
over a busy area degrades by dropping the far edge rather than by turning into a smear; the cap is
on nearest-first order, not on Map iteration order, so what is dropped is predictable.
```

```bash
cd frontend && npm run test && npm run typecheck
```

Expected: `Tests 573 passed (573)`, typecheck clean.

```bash
git add frontend/src/dashboard frontend/src/styles docs/decisions.md && git commit -m "feat(dashboard): PPI radar scope over the live contact feed"
```

---

### Task 5: Place/airport labels and the SAT↔CHART basemap toggle

D-7 and D-8. Two real data sources, two status-bar chips, one attribution line that tells the
truth about whichever layers are actually on.

**The airports dataset is a bundled static file, generated once.** `scripts/fetch-ourairports.sh`
downloads OurAirports' public-domain `airports.csv`, keeps `large_airport` and `medium_airport`,
rounds coordinates to 4 decimal places (~11 m — far finer than a label needs) and writes
`frontend/src/data/airports-world.json`, which is **committed**. The browser never fetches it, never
parses CSV, and there is no runtime dependency on OurAirports being up. The size budget is asserted
by a test (< 600 KB raw, which gzips to roughly a third); if a future OurAirports release pushes it
over, the honest fix is to narrow the filter and say so, not to raise the assertion quietly.

Why large+medium and not everything: `small_airport` and `heliport` together are ~60,000 records,
which is both a multi-megabyte bundle and an unreadable label soup at any camera height a player
actually flies at. Large+medium is roughly 5,400 records — every airport with a runway you could
plausibly aim a C172 at.

**Attribution lives in a Cesium-free module.** `globe/mapSources.ts` holds the URLs, the basemap
kind and `attributionFor()`. `StatusBar` (a flex sibling of `ViewerHost`, outside the provider) and
`Hud` both import it without dragging Cesium into their bundles or their tests;
`globe/basemap.ts` and `globe/labelLayers.ts` import the URLs from it and add the Cesium.

**Files:**
- Create: `scripts/fetch-ourairports.sh`, `frontend/src/data/airports-world.json` (generated, committed), `frontend/src/data/airports.ts`, `frontend/src/globe/mapSources.ts`, `frontend/src/globe/basemap.ts`, `frontend/src/globe/labelLayers.ts`, `frontend/src/globe/OverlayLayers.tsx`
- Test: `frontend/src/data/airports.test.ts`, `frontend/src/globe/mapSources.test.ts`
- Modify: `frontend/src/state/store.ts`, `frontend/src/state/store.test.ts`, `frontend/src/panels/StatusBar.tsx`, `frontend/src/panels/StatusBar.test.ts`, `frontend/src/hud/Hud.tsx`, `frontend/src/hud/Hud.test.tsx`, `frontend/src/game/FlightSession.tsx`, `frontend/src/App.tsx`, `frontend/src/styles/tokens.css`, `README.md`, `docs/decisions.md`

**Interfaces:**
- Consumes: `rangeNm` (`dashboard/geoRange.ts`); `useStore` (`state/store.ts`); `useViewer` (`globe/viewerContext.ts`); `ArcGisMapServerImageryProvider`, `ImageryLayer`, `LabelCollection`, `Label`, `Cartesian3`, `Color`, `LabelStyle`, `VerticalOrigin`, `Cartesian2` (`cesium`, **inside `globe/` only**).
- Produces:
  - `globe/mapSources.ts`: `type BasemapKind = "SAT" | "CHART"`, `SAT_URL`, `CHART_URL`, `PLACES_URL`, `BASEMAP_CREDIT`, `PLACES_CREDIT`, `AIRPORTS_CREDIT`, `TRAFFIC_CREDIT`, `attributionFor({ basemap, labelsOn, terrainNote }): string`.
  - `data/airports.ts`: `type Airport`, `validateAirports(raw: unknown): Airport[]`, `loadAirports(): Airport[]`, `airportLabelText(a: Airport): string`, `visibleAirports({ airports, cameraHeightM, centerLatDeg, centerLonDeg, maxLabels? }): Airport[]`, `AIRPORT_LABEL_MAX = 60`.
  - `state/store.ts`: `basemap: BasemapKind`, `labelsOn: boolean`, `setBasemap(k)`, `setLabelsOn(b)`.
  - `panels/StatusBar.tsx`: `basemapChipLabel(k): string`, `labelsChipLabel(on): string`, `nextBasemap(k): BasemapKind`.
  - `globe/basemap.ts`: `type BasemapRef`, `createBasemapRef()`, `applyBasemap(viewer, kind, ref)`, `disposeBasemap(viewer, ref)`.
  - `globe/labelLayers.ts`: `type PlacesRef`, `createPlacesRef()`, `applyPlacesLayer(viewer, on, ref)`, `syncAirportLabels(labels, ref, visible)`, `clearAirportLabels(labels, ref)`.
  - `globe/OverlayLayers.tsx`: default export `OverlayLayers()`.
  - `hud/Hud.tsx`: the `terrainNote` prop becomes `attribution: string`.

---

- [ ] **Step 1: Write the one-time generator script**

```bash
# scripts/fetch-ourairports.sh
#!/usr/bin/env bash
#
# ONE-TIME generator for frontend/src/data/airports-world.json (spec D-7).
#
# This is NOT run at build time and NOT run in the browser. Run it by hand when you want to
# refresh the airport labels against a newer OurAirports release, then commit the JSON it
# writes. The app imports that JSON as a bundled static asset and never touches the network for
# it, so labels keep working with the backend down and OurAirports unreachable.
#
# Source: https://ourairports.com/data/ - public domain (OurAirports "no copyright" dedication).
# Attribution is still shown in the app when the labels layer is on, because credit is cheap and
# the data is someone's work.
#
# Filter: large_airport + medium_airport only. small_airport and heliport add ~60k records - a
# multi-megabyte bundle and an unreadable label soup at any useful camera height.
#
# Usage:  bash scripts/fetch-ourairports.sh
set -euo pipefail

SRC_URL="${OURAIRPORTS_URL:-https://davidmegginson.github.io/ourairports-data/airports.csv}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO_ROOT/frontend/src/data/airports-world.json"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "fetching $SRC_URL"
curl -fsSL "$SRC_URL" -o "$TMP"

python3 - "$TMP" "$OUT" <<'PY'
import csv, json, sys

src, out = sys.argv[1], sys.argv[2]
KEEP = {"large_airport": "large", "medium_airport": "medium"}
rows = []

with open(src, newline="", encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        size = KEEP.get(r.get("type", ""))
        if size is None:
            continue
        try:
            lat = round(float(r["latitude_deg"]), 4)
            lon = round(float(r["longitude_deg"]), 4)
        except (TypeError, ValueError, KeyError):
            continue
        ident = (r.get("ident") or "").strip()
        if not ident:
            continue
        iata = (r.get("iata_code") or "").strip() or None
        name = (r.get("name") or "").strip()[:48]
        rows.append({
            "ident": ident, "iata": iata, "name": name,
            "latDeg": lat, "lonDeg": lon, "size": size,
        })

rows.sort(key=lambda a: a["ident"])
with open(out, "w", encoding="utf-8") as fh:
    json.dump(rows, fh, separators=(",", ":"), ensure_ascii=False)
    fh.write("\n")
print(f"wrote {len(rows)} airports")
PY

ls -l "$OUT"
```

- [ ] **Step 2: Run it once and record what it produced**

```bash
bash scripts/fetch-ourairports.sh
```

Expected: `wrote NNNN airports` with N around 5,000–6,000, and a file under 600 KB. Note the
actual count and byte size — step 4's test asserts a band around them, and the README section in
step 18 quotes them.

```bash
wc -c frontend/src/data/airports-world.json
```

If the file is over 600 KB, **stop and narrow the filter** (drop `name` for `medium`, or drop
medium airports without an `iata_code`) rather than raising the budget in the test. Record
whichever you did in CD-009.

- [ ] **Step 3: Write the failing airports test**

```ts
// frontend/src/data/airports.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  AIRPORT_LABEL_MAX, airportLabelText, loadAirports, validateAirports, visibleAirports,
  type Airport,
} from "./airports";

const AIRPORTS = loadAirports();
const ap = (o: Partial<Airport> = {}): Airport => ({
  ident: "KMOB", iata: "MOB", name: "Mobile Regional Airport",
  latDeg: 30.6912, lonDeg: -88.2428, size: "medium", ...o,
});

describe("the bundled OurAirports extract", () => {
  it("validates against the schema the app expects", () => {
    expect(() => validateAirports(AIRPORTS)).not.toThrow();
  });

  it("holds a plausible number of airports — large + medium, not the whole 80k file", () => {
    expect(AIRPORTS.length).toBeGreaterThan(3000);
    expect(AIRPORTS.length).toBeLessThan(12000);
  });

  it("contains only large and medium airports", () => {
    expect(new Set(AIRPORTS.map((a) => a.size))).toEqual(new Set(["large", "medium"]));
  });

  it("has a usable ident and an in-range position for every record", () => {
    for (const a of AIRPORTS) {
      expect(a.ident.length).toBeGreaterThan(0);
      expect(Number.isFinite(a.latDeg) && a.latDeg >= -90 && a.latDeg <= 90).toBe(true);
      expect(Number.isFinite(a.lonDeg) && a.lonDeg >= -180 && a.lonDeg <= 180).toBe(true);
    }
  });

  it("is real data, not a stub — the obvious airports are in it", () => {
    const idents = new Set(AIRPORTS.map((a) => a.ident));
    for (const known of ["KJFK", "EGLL", "KMOB"]) expect(idents.has(known)).toBe(true);
  });

  it("stays inside the bundle budget", () => {
    const bytes = readFileSync("src/data/airports-world.json").byteLength;
    expect(bytes).toBeLessThan(600_000);
  });

  it("rejects a malformed record instead of shipping it to Cesium", () => {
    expect(() => validateAirports([{ ident: "X", latDeg: "north" }])).toThrow();
    expect(() => validateAirports([{ ...ap(), size: "tiny" }])).toThrow(/size/);
  });
});

describe("visibleAirports — declutter by camera height", () => {
  const airports = [
    ap({ ident: "KMOB", size: "medium", latDeg: 30.69, lonDeg: -88.24 }),
    ap({ ident: "KATL", size: "large", latDeg: 33.64, lonDeg: -84.43 }),
    ap({ ident: "KPNS", size: "medium", latDeg: 30.47, lonDeg: -87.19 }),
  ];
  const at = (cameraHeightM: number, maxLabels = AIRPORT_LABEL_MAX) =>
    visibleAirports({
      airports, cameraHeightM, centerLatDeg: 30.69, centerLonDeg: -88.24, maxLabels,
    }).map((a) => a.ident);

  it("shows nothing from orbit — a whole-globe label soup is not information", () => {
    expect(at(900_000)).toEqual([]);
  });

  it("shows only the large airports from high up", () => {
    expect(at(300_000)).toEqual(["KATL"]);
  });

  it("brings the medium airports in below the 40 km tier boundary", () => {
    expect(at(30_000).sort()).toEqual(["KATL", "KMOB", "KPNS"]);
  });

  it("still shows large airports only just ABOVE that boundary", () => {
    expect(at(50_000)).toEqual(["KATL"]);
  });

  it("caps the labels, nearest to the camera centre first", () => {
    expect(at(30_000, 2)).toEqual(["KMOB", "KPNS"]);
  });
});

describe("airportLabelText", () => {
  it("prefers the IATA code, which is what a pilot reads on a chart", () => {
    expect(airportLabelText(ap({ ident: "KMOB", iata: "MOB" }))).toBe("MOB");
  });
  it("falls back to the ICAO ident when there is no IATA code — never to a blank", () => {
    expect(airportLabelText(ap({ ident: "KMOB", iata: null }))).toBe("KMOB");
  });
});
```

- [ ] **Step 4: Run it and see it fail**

```bash
cd frontend && npm run test -- src/data/airports.test.ts
```

Expected failure: `Error: Failed to resolve import "./airports"`.

- [ ] **Step 5: Write `data/airports.ts`**

```ts
// frontend/src/data/airports.ts
/*
 * The bundled OurAirports extract and the rules for showing it (spec D-7).
 *
 * `airports-world.json` is GENERATED and COMMITTED — see scripts/fetch-ourairports.sh. It is
 * never fetched at runtime and the CSV is never parsed in the browser, so airport labels work
 * with the backend down and OurAirports unreachable. Public domain; credited anyway when the
 * layer is on.
 *
 * Cesium-free on purpose: `visibleAirports` is the whole declutter policy and it is arithmetic,
 * so it is unit-tested rather than eyeballed on a globe.
 */
import raw from "./airports-world.json";
import { rangeNm } from "../dashboard/geoRange";

export type Airport = {
  /** ICAO or local ident, e.g. "KMOB". Always present. */
  ident: string;
  /** IATA code where one exists, e.g. "MOB". */
  iata: string | null;
  name: string;
  latDeg: number;
  lonDeg: number;
  size: "large" | "medium";
};

export const AIRPORT_LABEL_MAX = 60;

/**
 * Camera-height tiers, metres. Above the top one the globe is a marble and labels are noise;
 * below the bottom one everything we have is legible.
 */
const LARGE_ONLY_ABOVE_M = 40_000;
const NOTHING_ABOVE_M = 500_000;

function fail(msg: string): never {
  throw new Error(`airports-world.json: ${msg}`);
}

export function validateAirports(value: unknown): Airport[] {
  if (!Array.isArray(value)) fail("must be an array");
  return value.map((r, i) => {
    if (typeof r !== "object" || r === null) fail(`[${i}] must be an object`);
    const o = r as Record<string, unknown>;
    const ident = o.ident;
    const lat = o.latDeg;
    const lon = o.lonDeg;
    const size = o.size;
    if (typeof ident !== "string" || ident.length === 0) fail(`[${i}].ident must be a non-empty string`);
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      fail(`[${i}].latDeg must be a latitude`);
    }
    if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      fail(`[${i}].lonDeg must be a longitude`);
    }
    if (size !== "large" && size !== "medium") fail(`[${i}].size must be "large" or "medium"`);
    return {
      ident,
      iata: typeof o.iata === "string" && o.iata.length > 0 ? o.iata : null,
      name: typeof o.name === "string" ? o.name : "",
      latDeg: lat,
      lonDeg: lon,
      size,
    };
  });
}

let cached: Airport[] | null = null;

export function loadAirports(): Airport[] {
  if (cached === null) cached = validateAirports(raw);
  return cached;
}

/** What the label reads: the IATA code where there is one, otherwise the ICAO ident. */
export function airportLabelText(a: Airport): string {
  return a.iata ?? a.ident;
}

export function visibleAirports(o: {
  airports: Airport[];
  cameraHeightM: number;
  centerLatDeg: number;
  centerLonDeg: number;
  maxLabels?: number;
}): Airport[] {
  const maxLabels = o.maxLabels ?? AIRPORT_LABEL_MAX;
  if (o.cameraHeightM > NOTHING_ABOVE_M) return [];

  const tier =
    o.cameraHeightM > LARGE_ONLY_ABOVE_M
      ? o.airports.filter((a) => a.size === "large")
      : o.airports;

  return tier
    .map((a) => ({ a, r: rangeNm(o.centerLatDeg, o.centerLonDeg, a.latDeg, a.lonDeg) }))
    .sort((x, y) => x.r - y.r)
    .slice(0, maxLabels)
    .map((x) => x.a);
}
```

- [ ] **Step 6: Run it and see it pass**

```bash
cd frontend && npm run test -- src/data/airports.test.ts
```

Expected: `14 passed`. Running total: **587**.

---

- [ ] **Step 7: Write the failing map-sources test**

```ts
// frontend/src/globe/mapSources.test.ts
import { describe, it, expect } from "vitest";
import {
  CHART_URL, PLACES_URL, SAT_URL, attributionFor,
} from "./mapSources";

describe("imagery sources are keyless Esri REST services", () => {
  it("carry no token, key or secret in the URL", () => {
    for (const url of [SAT_URL, CHART_URL, PLACES_URL]) {
      expect(url.startsWith("https://")).toBe(true);
      expect(url).not.toMatch(/token|api[_-]?key|access[_-]?token|\?/i);
    }
  });
  it("are the exact services the spec names", () => {
    expect(SAT_URL).toBe(
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer");
    expect(CHART_URL).toBe(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer");
    expect(PLACES_URL).toBe(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer");
  });
});

describe("attributionFor", () => {
  const terrainNote = "RE:EARTH TERRAIN · MAPTERHORN CC BY 4.0";

  it("names the satellite basemap and the terrain and the traffic feeds", () => {
    const line = attributionFor({ basemap: "SAT", labelsOn: false, terrainNote });
    expect(line).toContain("IMAGERY © ESRI");
    expect(line).toContain("MAPTERHORN");
    expect(line).toContain("AIRPLANES.LIVE");
  });

  it("changes when the basemap changes, rather than crediting a layer that is not on", () => {
    const chart = attributionFor({ basemap: "CHART", labelsOn: false, terrainNote });
    expect(chart).toContain("DARK GRAY CANVAS");
    expect(chart).not.toContain("IMAGERY © ESRI ·");
  });

  it("credits places and OurAirports ONLY when the labels layer is on", () => {
    const off = attributionFor({ basemap: "SAT", labelsOn: false, terrainNote });
    expect(off).not.toMatch(/OURAIRPORTS/i);
    expect(off).not.toMatch(/PLACES/i);
    const on = attributionFor({ basemap: "SAT", labelsOn: true, terrainNote });
    expect(on).toMatch(/OURAIRPORTS/i);
    expect(on).toMatch(/PLACES/i);
  });

  it("says the terrain is still loading rather than crediting a source that has not attached", () => {
    const line = attributionFor({ basemap: "SAT", labelsOn: false, terrainNote: null });
    expect(line).toContain("TERRAIN LOADING…");
  });

  it("keeps the terrain note verbatim, including the honest flat-ellipsoid fallback", () => {
    const line = attributionFor({
      basemap: "SAT", labelsOn: false, terrainNote: "TERRAIN UNAVAILABLE — FLAT ELLIPSOID",
    });
    expect(line).toContain("TERRAIN UNAVAILABLE — FLAT ELLIPSOID");
  });

  it("separates every credit with the same divider", () => {
    const line = attributionFor({ basemap: "SAT", labelsOn: true, terrainNote });
    expect(line.split(" · ").length).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 8: Run it and see it fail**

```bash
cd frontend && npm run test -- src/globe/mapSources.test.ts
```

Expected failure: `Error: Failed to resolve import "./mapSources"`.

- [ ] **Step 9: Write `globe/mapSources.ts`**

```ts
// frontend/src/globe/mapSources.ts
/*
 * Where the imagery comes from, and how the app says so. Deliberately CESIUM-FREE, even though
 * it lives in globe/: `StatusBar` is a flex sibling of `ViewerHost` (decisions B-015) and `Hud`
 * is a dumb overlay, and neither should pull Cesium into its bundle or its test just to print a
 * credit line. `basemap.ts` and `labelLayers.ts` import the URLs from here and add the Cesium.
 *
 * All three services are keyless ArcGIS REST endpoints — Ion.defaultAccessToken stays null and
 * nothing here carries a token or an API key. The test asserts that.
 */
export type BasemapKind = "SAT" | "CHART";

export const SAT_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
export const CHART_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer";
export const PLACES_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer";

export const BASEMAP_CREDIT: Readonly<Record<BasemapKind, string>> = {
  SAT: "IMAGERY © ESRI",
  CHART: "BASEMAP © ESRI DARK GRAY CANVAS",
};
export const PLACES_CREDIT = "PLACES © ESRI";
export const AIRPORTS_CREDIT = "AIRPORTS: OURAIRPORTS (PUBLIC DOMAIN)";
export const TRAFFIC_CREDIT = "TRAFFIC: AIRPLANES.LIVE / ADSB.LOL / ADSB.FI";

/**
 * The one attribution builder. Both the status bar and the HUD call it, so switching basemap or
 * turning labels on updates both in the same render, and a layer that is NOT on is never
 * credited.
 */
export function attributionFor(o: {
  basemap: BasemapKind;
  labelsOn: boolean;
  terrainNote: string | null;
}): string {
  const parts = [BASEMAP_CREDIT[o.basemap], o.terrainNote ?? "TERRAIN LOADING…"];
  if (o.labelsOn) parts.push(PLACES_CREDIT, AIRPORTS_CREDIT);
  parts.push(TRAFFIC_CREDIT);
  return parts.join(" · ");
}
```

- [ ] **Step 10: Run it and see it pass**

```bash
cd frontend && npm run test -- src/globe/mapSources.test.ts
```

Expected: `8 passed`. Running total: **595**.

---

- [ ] **Step 11: Write the failing store and status-bar tests**

Append to `frontend/src/state/store.test.ts`:

```ts
describe("view preferences", () => {
  it("starts on the satellite basemap with the labels layer OFF", () => {
    const s = useStore.getState();
    expect(s.basemap).toBe("SAT");
    expect(s.labelsOn).toBe(false);
  });
  it("switches the basemap", () => {
    useStore.getState().setBasemap("CHART");
    expect(useStore.getState().basemap).toBe("CHART");
    useStore.getState().setBasemap("SAT");
  });
  it("turns the labels layer on and off", () => {
    useStore.getState().setLabelsOn(true);
    expect(useStore.getState().labelsOn).toBe(true);
    useStore.getState().setLabelsOn(false);
    expect(useStore.getState().labelsOn).toBe(false);
  });
  it("leaves them alone when the session resets — they are preferences, not session state", () => {
    useStore.getState().setBasemap("CHART");
    useStore.getState().setLabelsOn(true);
    useStore.getState().resetSession();
    expect(useStore.getState().basemap).toBe("CHART");
    expect(useStore.getState().labelsOn).toBe(true);
    useStore.getState().setBasemap("SAT");
    useStore.getState().setLabelsOn(false);
  });
});
```

Append to `frontend/src/panels/StatusBar.test.ts`:

```ts
describe("basemap and labels chips", () => {
  it("names the active basemap", () => {
    expect(basemapChipLabel("SAT")).toBe("MAP SAT");
    expect(basemapChipLabel("CHART")).toBe("MAP CHART");
  });
  it("toggles between the two basemaps", () => {
    expect(nextBasemap("SAT")).toBe("CHART");
    expect(nextBasemap("CHART")).toBe("SAT");
  });
  it("states the labels layer's actual state, both ways", () => {
    expect(labelsChipLabel(true)).toBe("LABELS ON");
    expect(labelsChipLabel(false)).toBe("LABELS OFF");
  });
});
```

- [ ] **Step 12: Run them and see them fail**

```bash
cd frontend && npm run test -- src/state/store.test.ts src/panels/StatusBar.test.ts
```

Expected failure: `expected undefined to be "SAT"`, and
`SyntaxError: The requested module './StatusBar' does not provide an export named
'basemapChipLabel'`.

- [ ] **Step 13: Add the two view preferences and the two chips**

`frontend/src/state/store.ts` — in the `State` type, next to `radiusNm`:

```ts
  /**
   * View preferences, NOT session state — which is why `resetSession` does not touch them.
   * They live in the store, unlike the cockpit strip's collapse flags, because `StatusBar` is a
   * flex sibling of `ViewerHost` (decisions B-015) and has no other route to the viewer.
   */
  basemap: BasemapKind;
  labelsOn: boolean;
  setBasemap(k: BasemapKind): void;
  setLabelsOn(on: boolean): void;
```

with `import type { BasemapKind } from "../globe/mapSources";` at the top, the initial values
`basemap: "SAT",` / `labelsOn: false,` beside `radiusNm: 80,`, and:

```ts
  setBasemap(k) {
    set({ basemap: k });
  },

  setLabelsOn(on) {
    set({ labelsOn: on });
  },
```

`frontend/src/panels/StatusBar.tsx`:

```ts
import { attributionFor, type BasemapKind } from "../globe/mapSources";

export function basemapChipLabel(k: BasemapKind): string {
  return `MAP ${k}`;
}

/** Two basemaps, so the chip is a straight toggle rather than the radius chip's ladder. */
export function nextBasemap(k: BasemapKind): BasemapKind {
  return k === "SAT" ? "CHART" : "SAT";
}

export function labelsChipLabel(on: boolean): string {
  return on ? "LABELS ON" : "LABELS OFF";
}
```

and in the component, two more chips beside the radius chip plus the attribution line rebuilt from
the one builder:

```tsx
  const basemap = useStore((s) => s.basemap);
  const setBasemap = useStore((s) => s.setBasemap);
  const labelsOn = useStore((s) => s.labelsOn);
  const setLabelsOn = useStore((s) => s.setLabelsOn);
```

```tsx
      <button type="button" className="status-chip-button"
        onClick={() => setBasemap(nextBasemap(basemap))}>
        {basemapChipLabel(basemap)}
      </button>
      <button
        type="button"
        className={labelsOn ? "status-chip-button status-chip-button-active" : "status-chip-button"}
        onClick={() => setLabelsOn(!labelsOn)}
      >
        {labelsChipLabel(labelsOn)}
      </button>
      <span>{formatUtcClock(now)}</span>
      <span className="flex-1" />
      <span>{attributionFor({ basemap, labelsOn, terrainNote })}</span>
```

The old hard-coded `IMAGERY © ESRI · {terrainNote ?? "TERRAIN LOADING…"}` span is replaced by that
last line — there is now exactly one place that composes an attribution string.

- [ ] **Step 14: Run them and see them pass**

```bash
cd frontend && npm run test -- src/state/store.test.ts src/panels/StatusBar.test.ts
```

Expected: `store.test.ts` 15 passed, `StatusBar.test.ts` 13 passed. Running total: **602**.

---

- [ ] **Step 15: Write the two Cesium adapters**

```ts
// frontend/src/globe/basemap.ts
/*
 * SAT <-> CHART (spec D-8). An IMAGERY LAYER swap and nothing else: the terrain provider, the
 * camera, the primitives and the poller are all untouched, because a provider swap forces a full
 * tile reload and jumps the camera (parent spec §3, the same reason terrain attaches at app
 * start and not at takeover).
 *
 * CHART is added ABOVE the base layer created in ViewerHost, and the base is hidden rather than
 * destroyed — so switching back is one `show = true` and nothing has to be rebuilt or refetched.
 */
import { ArcGisMapServerImageryProvider, ImageryLayer, type Viewer } from "cesium";
import { CHART_URL, type BasemapKind } from "./mapSources";

export type BasemapRef = { chart: ImageryLayer | null };

export function createBasemapRef(): BasemapRef {
  return { chart: null };
}

export function applyBasemap(viewer: Viewer, kind: BasemapKind, ref: BasemapRef): void {
  if (viewer.isDestroyed()) return;
  const layers = viewer.imageryLayers;
  const base = layers.length > 0 ? layers.get(0) : null;

  if (kind === "CHART") {
    if (ref.chart === null) {
      // Same call ViewerHost already makes for the base layer on Cesium 1.143:
      // fromProviderAsync takes the provider promise and returns the layer synchronously.
      ref.chart = ImageryLayer.fromProviderAsync(
        ArcGisMapServerImageryProvider.fromUrl(CHART_URL),
        {},
      );
      layers.add(ref.chart);
    }
    if (base && base !== ref.chart) base.show = false;
    return;
  }

  if (ref.chart !== null) {
    layers.remove(ref.chart, true);
    ref.chart = null;
  }
  if (base) base.show = true;
}

/**
 * Cleanup must leave the globe with imagery on it. Removing the chart layer without un-hiding
 * the base would strand a StrictMode re-mount (or any unmount while CHART is active) on a black
 * globe, so the base layer is restored FIRST and unconditionally.
 */
export function disposeBasemap(viewer: Viewer, ref: BasemapRef): void {
  if (viewer.isDestroyed()) {
    ref.chart = null;
    return;
  }
  const layers = viewer.imageryLayers;
  if (ref.chart !== null) layers.remove(ref.chart, true);
  ref.chart = null;
  if (layers.length > 0) layers.get(0).show = true;
}
```

```ts
// frontend/src/globe/labelLayers.ts
/*
 * Place names and airport labels (spec D-7).
 *
 * Two different mechanisms on purpose:
 *  - PLACE names come from Esri's keyless "World Boundaries and Places" REFERENCE layer — an
 *    imagery layer drawn over the basemap. Esri renders and declutters them; we just add and
 *    remove the layer.
 *  - AIRPORT labels come from the bundled OurAirports extract and are LORAN-styled Cesium
 *    labels, so they look like the rest of the app rather than like Esri's cartography. Which
 *    ones are visible is decided by `visibleAirports` in data/airports.ts, which is pure and
 *    tested; this module only mutates primitives in place, the contactBillboards lesson.
 */
import { Cartesian2, Color, ImageryLayer, LabelStyle, VerticalOrigin } from "cesium";
import { ArcGisMapServerImageryProvider, type Label, type LabelCollection, type Viewer } from "cesium";
import { PLACES_URL } from "./mapSources";
import { airportLabelText, type Airport } from "../data/airports";

export type PlacesRef = { layer: ImageryLayer | null };
export type AirportLabelRef = { byIdent: Map<string, Label> };

export function createPlacesRef(): PlacesRef {
  return { layer: null };
}
export function createAirportLabelRef(): AirportLabelRef {
  return { byIdent: new Map() };
}

export function applyPlacesLayer(viewer: Viewer, on: boolean, ref: PlacesRef): void {
  if (viewer.isDestroyed()) return;
  if (on && ref.layer === null) {
    ref.layer = ImageryLayer.fromProviderAsync(
      ArcGisMapServerImageryProvider.fromUrl(PLACES_URL),
      {},
    );
    viewer.imageryLayers.add(ref.layer);
    return;
  }
  if (!on && ref.layer !== null) {
    viewer.imageryLayers.remove(ref.layer, true);
    ref.layer = null;
  }
}

/** Add, move and remove airport labels in place — never rebuild the collection. */
export function syncAirportLabels(
  labels: LabelCollection,
  ref: AirportLabelRef,
  visible: Airport[],
): void {
  const wanted = new Map(visible.map((a) => [a.ident, a]));

  for (const [ident, label] of ref.byIdent) {
    if (!wanted.has(ident)) {
      labels.remove(label);
      ref.byIdent.delete(ident);
    }
  }

  for (const [ident, a] of wanted) {
    const existing = ref.byIdent.get(ident);
    if (existing) continue; // airports do not move
    ref.byIdent.set(
      ident,
      labels.add({
        position: Cartesian3.fromDegrees(a.lonDeg, a.latDeg, 0),
        text: airportLabelText(a),
        font: "10px monospace",
        fillColor: Color.fromCssColorString("#5fd7e0").withAlpha(0.85),
        style: LabelStyle.FILL,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -4),
      }),
    );
  }
}

export function clearAirportLabels(labels: LabelCollection, ref: AirportLabelRef): void {
  for (const label of ref.byIdent.values()) labels.remove(label);
  ref.byIdent.clear();
}
```

Add `Cartesian3` to that file's `cesium` import — it is used by `syncAirportLabels`.

- [ ] **Step 16: Write `globe/OverlayLayers.tsx` and wire it into `App.tsx`**

```tsx
// frontend/src/globe/OverlayLayers.tsx
/*
 * Store toggles -> Cesium layers. One component, three effects, each of which removes exactly
 * what it created so React 18's StrictMode double-invoke leaves one live instance (the same
 * discipline ViewerHost follows).
 *
 * The airport-label effect also listens to camera movement, because "declutter by camera height"
 * has to react to the camera, not to a store change. `camera.percentageChanged = 0.2` keeps that
 * to a handful of updates per pan rather than one per frame.
 */
import { useEffect, useRef } from "react";
import { Math as CesiumMath } from "cesium";
import { useStore } from "../state/store";
import { useViewer } from "./viewerContext";
import { applyBasemap, createBasemapRef, disposeBasemap } from "./basemap";
import {
  applyPlacesLayer, clearAirportLabels, createAirportLabelRef, createPlacesRef, syncAirportLabels,
} from "./labelLayers";
import { loadAirports, visibleAirports } from "../data/airports";

export default function OverlayLayers() {
  const bundle = useViewer();
  const basemap = useStore((s) => s.basemap);
  const labelsOn = useStore((s) => s.labelsOn);

  const basemapRef = useRef(createBasemapRef());
  const placesRef = useRef(createPlacesRef());
  const airportRef = useRef(createAirportLabelRef());

  useEffect(() => {
    if (!bundle) return;
    const viewer = bundle.viewer;
    const ref = basemapRef.current;
    applyBasemap(viewer, basemap, ref);
    return () => disposeBasemap(viewer, ref);
  }, [bundle?.viewer, basemap]);

  useEffect(() => {
    if (!bundle) return;
    const viewer = bundle.viewer;
    const ref = placesRef.current;
    applyPlacesLayer(viewer, labelsOn, ref);
    return () => applyPlacesLayer(viewer, false, ref);
  }, [bundle?.viewer, labelsOn]);

  useEffect(() => {
    if (!bundle) return;
    const viewer = bundle.viewer;
    const labels = bundle.labels;
    const ref = airportRef.current;

    if (!labelsOn) {
      clearAirportLabels(labels, ref);
      return;
    }

    const airports = loadAirports();
    const update = () => {
      if (viewer.isDestroyed()) return;
      const carto = viewer.camera.positionCartographic;
      syncAirportLabels(
        labels,
        ref,
        visibleAirports({
          airports,
          cameraHeightM: carto.height,
          centerLatDeg: CesiumMath.toDegrees(carto.latitude),
          centerLonDeg: CesiumMath.toDegrees(carto.longitude),
        }),
      );
    };

    const previousPercentage = viewer.camera.percentageChanged;
    viewer.camera.percentageChanged = 0.2;
    viewer.camera.changed.addEventListener(update);
    update();

    return () => {
      viewer.camera.changed.removeEventListener(update);
      viewer.camera.percentageChanged = previousPercentage;
      clearAirportLabels(labels, ref);
    };
  }, [bundle?.viewer, bundle?.labels, labelsOn]);

  return null;
}
```

`frontend/src/App.tsx` — one line, next to `ContactLayer`:

```tsx
          <ViewerHost onTerrainNoteChange={setTerrainNote}>
            <ContactLayer />
            <OverlayLayers />
            <FlightSession />
          </ViewerHost>
```

Neither adapter gets a unit test: both need a live `Viewer`, and everything they decide — the
URLs, the attribution string, which airports are visible, the schema of the data file — is in
`mapSources.ts`, `airports.ts` and their tests. Recorded in CD-009/CD-010 and checked by hand in
Task 6's walkthrough.

- [ ] **Step 17: Make the HUD's attribution line follow the same builder**

`Hud.test.tsx` has **no `render` helper** — it makes nine inline `collectText(Hud({ snapshot,
terrainNote }))` calls against its local `snap()` factory. Follow that existing pattern rather than
introducing a helper. Append inside the existing `describe("Hud", ...)`:

```tsx
  it("prints the attribution it is given, so it cannot disagree with the status bar", () => {
    const text = collectText(
      Hud({
        snapshot: snap(),
        attribution: "BASEMAP © ESRI DARK GRAY CANVAS · TERRAIN LOADING… · TRAFFIC: AIRPLANES.LIVE",
      }),
    ).join(" ");
    expect(text).toContain("DARK GRAY CANVAS");
    expect(text).not.toContain("IMAGERY © ESRI");
  });
```

Run it (`cd frontend && npm run test -- src/hud/Hud.test.tsx`) and expect a TypeScript error on the
unknown `attribution` prop plus the `not.toContain` assertion failing against the hard-coded line.
Then in `frontend/src/hud/Hud.tsx` replace the `terrainNote` prop with `attribution`:

```tsx
export default function Hud({
  snapshot,
  attribution,
}: {
  snapshot: HudSnapshot | null;
  attribution: string;
}) {
```

```tsx
      <div className="hud-attribution">{attribution}</div>
```

and update **all nine** existing `Hud({ ..., terrainNote: X })` call sites in `Hud.test.tsx` to
`attribution: X` — including the one at line ~72 that asserts the terrain source appears in the
line, which keeps working verbatim because the string is now passed in whole. In
`frontend/src/game/FlightSession.tsx`:

```tsx
import { attributionFor } from "../globe/mapSources";
```

```tsx
  const basemap = useStore((s) => s.basemap);
  const labelsOn = useStore((s) => s.labelsOn);
```

```tsx
          <Hud
            snapshot={snapshot}
            attribution={attributionFor({
              basemap, labelsOn, terrainNote: bundle?.terrainNote ?? null,
            })}
          />
```

- [ ] **Step 18: Full suite, typecheck, README, two decisions, one commit**

```bash
cd frontend && npm run test && npm run typecheck && npm run build
```

Expected: `Tests 603 passed (603)` (602 plus the one Hud assertion added in step 17; the three
Cesium adapters contribute none), typecheck clean, and a successful production build — this is the
first task that adds a bundled data file, so the build is worth running here rather than only in
Task 6.
Check the reported bundle size delta against the JSON's raw size.

Add to `README.md`, under the existing feature/usage section:

```markdown
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
never fetches it and never parses CSV.
```

Append to `docs/decisions.md`:

```markdown
## 2026-08-07 — CD-009 · Airport labels ship as a committed generated extract, never a runtime fetch

`frontend/src/data/airports-world.json` is generated once by `scripts/fetch-ourairports.sh` from
OurAirports' public-domain CSV and committed. The browser never fetches it, never parses CSV, and
the labels keep working with the backend down and OurAirports unreachable. It is also the only
way to have airport labels without adding a CSV parser to the dependency list, which ground rule
3 would have required asking about.

**Filter: `large_airport` + `medium_airport` only** (~5,400 records, under the 600 KB budget the
schema-guard test asserts). Adding `small_airport` and `heliport` is ~60,000 more records: a
multi-megabyte bundle and an unreadable label soup at every camera height a C172 actually flies
at. If a future OurAirports release pushes the file over budget, narrow the filter and say so
here — do not raise the assertion.

Declutter is by camera height and is pure (`visibleAirports` in `data/airports.ts`, tested):
nothing above 500 km, large airports only above 40 km, everything below that, capped at the 60
nearest to the camera centre. Attribution is appended to the status bar and the HUD only while
the layer is actually on.

## 2026-08-07 — CD-010 · CHART is an imagery-layer swap with the SAT base hidden, not a rebuild

The SAT↔CHART toggle adds Esri's Dark Gray Canvas layer above the base imagery and sets the base
layer's `show = false`; switching back removes the chart layer and shows the base again. It does
**not** destroy and recreate the base layer, and it does not touch the terrain provider, the
camera, the primitives or the poller — a provider swap forces a full tile reload and jumps the
camera, which is the same reason terrain attaches at app start rather than at takeover (parent
spec §3).

`attributionFor()` in `globe/mapSources.ts` is the single builder for the credit line, called by
both `StatusBar` and `Hud`, so the two can never disagree and a layer that is off is never
credited. `mapSources.ts` is deliberately Cesium-free even though it lives in `globe/`, because
`StatusBar` is a flex sibling of `ViewerHost` (decisions B-015) and should not pull Cesium in to
print a string.

Neither `globe/basemap.ts` nor `globe/labelLayers.ts` nor `globe/OverlayLayers.tsx` has a unit
test — all three need a live `Viewer`. Everything they *decide* (URLs, the attribution string,
which airports are visible, the data file's schema) is in `mapSources.ts` and `data/airports.ts`,
which have 20 tests between them. The rest is covered by the acceptance walkthrough.
```

```bash
git add scripts frontend/src/data frontend/src/globe frontend/src/state frontend/src/panels frontend/src/hud frontend/src/game frontend/src/App.tsx frontend/src/styles README.md docs/decisions.md && git commit -m "feat(globe): place/airport labels and the SAT/CHART basemap toggle"
```

---
### Task 6: Integration, the guards that keep the constraints real, and the acceptance addendum

Nothing new is designed here. This task proves the constraints in the header are true of the code
rather than true of the plan, pins the one behaviour that spans mode changes, and writes the
walkthrough the owner signs off against.

**Files:**
- Modify: `frontend/src/dashboard/DashboardStrip.tsx`, `frontend/src/dashboard/DashboardStrip.test.tsx`, `frontend/src/game/FlightSession.tsx`, `docs/summaries/phase-b-acceptance-runbook.md`, `docs/summaries/CHECKLIST.md`, `README.md`, `docs/decisions.md`

**Interfaces:**
- Produces: `dashboard/DashboardStrip.tsx` gains `stripMountedForMode(mode: Mode): boolean`.
- Consumes: `Mode` (`game/machine.ts`).

---

- [ ] **Step 1: Prove there is no Cesium outside `globe/`**

Run all of these **from the repository root** (the neighbouring build steps `cd frontend`; these
deliberately do not, so the paths in the output are the ones this plan quotes):

```bash
grep -rn "from \"cesium\"" frontend/src --include="*.ts" --include="*.tsx" | grep -v "^frontend/src/globe/"
```

Expected: **no output** (exit status 1). Any line here is a constraint violation, and the fix is to
move the logic into a pure module and inject what it needed from Cesium — the pattern
`trafficProjection.ts` + `TrafficOverlay.tsx` already demonstrates.

A direct-import grep does **not** catch a transitive one, which is exactly how
`dashboard/trafficProjection.ts` could have picked up Cesium through
`globe/contactBillboards.ts` (Task 3 step 5). So also check that `dashboard/` reaches into
`globe/` for nothing at all:

```bash
grep -rn "from \"\.\./globe/" frontend/src/dashboard
```

Expected: **no output**. `dashboard/` may be imported BY `globe/`, never the other way round.
Run the mirror check too:

```bash
ls frontend/src/dashboard | wc -l && grep -rln "cesium" frontend/src/dashboard | wc -l
```

Expected: `24` then `0` — twenty-four files in `dashboard/` (12 modules and their 12 test files,
counting `panels.test.tsx` as the test for both placeholder panels and `PanelFrame`), none of
which so much as mentions Cesium.

- [ ] **Step 2: Prove no dependency was added**

```bash
git diff --stat main -- frontend/package.json frontend/package-lock.json backend/requirements.txt
```

Expected: **no output**. If `package-lock.json` moved at all, find out why before continuing —
ground rule 3 requires asking before any dependency beyond the approved list.

```bash
grep -rn "jsdom\|@testing-library\|happy-dom" frontend/package.json frontend/vite.config.ts frontend/src
```

Expected: **no output**. `frontend/src` is in the list because a per-file
`// @vitest-environment jsdom` docblock would switch environments without touching
`package.json` or `vite.config.ts` — the config-only grep would miss it entirely. The component
tests are call-as-a-function plus an element-tree walk, and that is the whole test tooling story.

- [ ] **Step 3: Walk the wiring by hand and tick every line**

Read the four wiring sites and confirm each one. This is a reading task, not a command:

| Where | What must be true |
|---|---|
| `App.tsx` | `<OverlayLayers />` sits inside `<ViewerHost>`, beside `<ContactLayer />`, so it can reach `useViewer()` |
| `App.tsx` | `<StatusBar terrainNote={terrainNote} />` still gets the bridged prop (B-015) and now renders the two new chips |
| `FlightSession.tsx` | `<DashboardStrip>` renders for `FLYING | PAUSED | ENDED`, as a SIBLING of `<Hud>` (not a child — `.hud-root` is `pointer-events: none`) |
| `FlightSession.tsx` | `<TrafficOverlay>` and `<TrafficDetailCard>` render for `FLYING | PAUSED` only, and `teardown()` clears `trafficHex` |
| `FlightSession.tsx` | `<Hud>` receives `attribution={attributionFor(...)}`, not `terrainNote` |
| `DashboardStrip.tsx` | subscribes to exactly `contacts`, `feedStatus` and `origin` from the store, and to nothing at sim cadence |

- [ ] **Step 4: Write the failing mount-rule test**

Append to `frontend/src/dashboard/DashboardStrip.test.tsx`:

```tsx
describe("when the cockpit exists at all", () => {
  it("is up for the whole flight, including the pause and the end card", () => {
    expect(stripMountedForMode("FLYING")).toBe(true);
    expect(stripMountedForMode("PAUSED")).toBe(true);
    expect(stripMountedForMode("ENDED")).toBe(true);
  });

  it("is NOT up in BROWSE or COUNTDOWN — which is exactly what makes QUIT reset the cockpit", () => {
    // Collapse flags and the scope range live in useState inside DashboardStrip (CD-006), so
    // unmounting IS the reset. Pinning the mount rule pins the reset; React supplies the rest.
    expect(stripMountedForMode("BROWSE")).toBe(false);
    expect(stripMountedForMode("COUNTDOWN")).toBe(false);
  });

  it("keeps a folded panel folded across a pause, because the strip never unmounts to pause", () => {
    const folded = togglePanel(defaultStripState(), "weather");
    expect(stripMountedForMode("FLYING")).toBe(stripMountedForMode("PAUSED"));
    expect(folded.collapsed.weather).toBe(true);
  });
});
```

with `stripMountedForMode` added to the imports from `./DashboardStrip`.

- [ ] **Step 5: Run it and see it fail**

```bash
cd frontend && npm run test -- src/dashboard/DashboardStrip.test.tsx
```

Expected failure: `SyntaxError: The requested module './DashboardStrip' does not provide an export
named 'stripMountedForMode'`.

- [ ] **Step 6: Add the mount rule and use it in `FlightSession`**

`frontend/src/dashboard/DashboardStrip.tsx`:

```ts
import type { Mode } from "../game/machine";
```

```ts
/**
 * Which modes have a cockpit. FLYING, PAUSED and ENDED do; BROWSE and COUNTDOWN do not.
 *
 * This is also the reset rule (decisions.md CD-006): collapse flags and the selected radar range
 * live in `useState` inside `DashboardStrip`, so leaving the mounted set discards them. Folding a
 * panel therefore survives a pause and the end card, and QUIT gives the next flight a fresh
 * cockpit — the same "no residue" rule `FlightSession.teardown()` follows for everything else.
 */
export function stripMountedForMode(mode: Mode): boolean {
  return mode === "FLYING" || mode === "PAUSED" || mode === "ENDED";
}
```

`frontend/src/game/FlightSession.tsx` — use it rather than repeating the mode list:

```tsx
      {stripMountedForMode(mode) && (
        <>
          <Hud
            snapshot={snapshot}
            attribution={attributionFor({
              basemap, labelsOn, terrainNote: bundle?.terrainNote ?? null,
            })}
          />
          <DashboardStrip snapshot={snapshot} />
        </>
      )}
```

- [ ] **Step 7: Run it and see it pass**

```bash
cd frontend && npm run test -- src/dashboard/DashboardStrip.test.tsx
```

Expected: `16 passed`. Running total: **606**.

---

- [ ] **Step 8: Append the acceptance checkpoints**

Append to `docs/summaries/phase-b-acceptance-runbook.md`:

```markdown
---

## Cockpit dashboard addendum (checkpoints 14–25)

Source: the cockpit-dashboard plan, Task 6. Same rules as above — servers already running,
screenshot each checkpoint, stop at the end and wait for sign-off.

  14. **The strip is there** — take controls of a GA contact and fly. A bottom strip carries, left
      to right: INSTRUMENTS, RADAR, WEATHER, ATC, CONTROLS. Every panel header has a `[-]`; click
      one and only that panel folds, its title still visible. Press `C`: the whole strip collapses
      to a single `COCKPIT [C]` chip. Press `C` again: it comes back **with your folds intact**.
  15. **The six-pack tracks the HUD** — the ASI needle and the HUD's `IAS` agree; the altimeter
      drum and the HUD's `ALT` agree digit for digit; the DG's window and the HUD's `HDG` agree
      including the 359→000 wrap. Climb: the VSI needle rises and the HUD's `VSI` goes positive
      together. **If any pair disagrees, that is a bug in `gaugeMath.ts`, not a rounding quirk** —
      they read the same snapshot through the same formatters.
  16. **The attitude indicator matches the real horizon** — roll right: the drawn horizon tips the
      opposite way and the real horizon out the windscreen does the same thing. Pitch up: the
      horizon drops. Peg the VSI in a dive (past 2000 fpm down): the needle sits on the stop, turns
      amber, and a `PEG` legend appears — it does not sit quietly at the bottom pretending.
  17. **The slip ball's sign** — in level flight, hold **right rudder**. The ball must fall to the
      **LEFT** ("step on the ball" = you would push right rudder to re-centre it). If it is
      mirrored, flip `SLIP_BALL_SIGN` in `dashboard/gaugeMath.ts` — **never** by negating the
      snapshot or the component.
  18. **The turn coordinator** — roll into a steady turn and hold the aeroplane symbol on the
      index. Time 360° of heading change: it should take about 2 minutes (standard rate). Rolled up
      steeply on a wingtip with the nose coming through, the symbol must NOT swing wildly — it
      reads rate of turn about the vertical, not body yaw rate.
  19. **Windscreen tags are real traffic** — with the feed LIVE, fly toward another contact.
      A compact tag appears over it carrying callsign (or hex), type, and altitude in feet. It
      **moves with the aircraft** and **disappears when the contact leaves the feed** — no ghost
      tag left behind. Turn away: the tag disappears when the contact leaves the frame.
  20. **The detail card** — click a tag. A LORAN card opens on the right with the feed's own
      fields, then the adsbdb block resolves. Confirm the three adsbdb states are distinguishable
      by finding: (a) an aircraft adsbdb knows (type/manufacturer/registration filled), and (b) an
      obscure hex where the card reads `NO ADSBDB RECORD FOR THIS HEX`. Then **stop the backend**
      (`docker compose stop backend` or Ctrl-C the uvicorn) and click another tag: the card must
      read `ADSBDB UNREACHABLE — ENRICHMENT UNKNOWN`, not `NO ADSBDB RECORD`. Restart the backend.
  21. **The radar shows the same traffic** — the blips on the scope are the same aircraft the
      windscreen is tagging. Own ship is the amber mark at the centre; the picture is heading-up
      (turn and the whole plot rotates with you); the ghost is the dimmed amber blip; military
      contacts are amber. Click through 10 / 40 / 80 / 150 / 250 NM: the ring labels change with
      the range and distant contacts come and go accordingly.
  22. **The radar is honest when the feed is not** — stop the backend and wait for the status bar
      to reach `OFFLINE` (three failed polls, ~15 s). The scope dims and reads
      `RADAR OFFLINE · NO FEED`; the windscreen tags disappear. It must never show a clean, empty,
      nominal-looking scope. Restart the backend and confirm both recover.
  23. **Weather, ATC and the controls help** — both placeholder panels read
      `NO FEED · FUTURE INTEGRATION` with a one-line statement of what is planned, and contain
      **no numbers of any kind**. Press `?`: the CONTROLS panel unfolds and lists every key —
      compare it against `input/controls.ts`'s `KEYMAP` and confirm nothing is missing and nothing
      is invented.
  24. **StrictMode and the strip's key listener** — reload the page (dev build, StrictMode on) and
      take controls. Press `C`: the strip must fold **once**, not fold-and-immediately-unfold. Then
      `Esc` to pause, RESUME, click the globe, and press `C` again — still once. A doubled listener
      does not crash, it just makes the key look broken every second press, and this is the only
      thing that catches it. In devtools, confirm no listener-leak warnings after a full
      fly → quit → fly-again cycle.
  25. **Labels and the basemap** — in the status bar, click `LABELS OFF` → `LABELS ON`: place names
      appear (Esri) and airport idents appear in LORAN cyan. Zoom out past ~500 km: the airport
      labels drop away rather than turning into soup. Click `MAP SAT` → `MAP CHART`: the imagery
      becomes the dark grey canvas, **the terrain relief is unchanged**, and the camera does not
      jump. Watch the attribution line at the bottom right through all four states — it must name
      Dark Gray Canvas when CHART is on, and must mention Esri Places and OurAirports **only**
      while labels are on. Then QUIT and take controls of a second contact: the map toggles are
      still where you left them (they are preferences), and the cockpit strip is back to its
      defaults (it is not).
```

- [ ] **Step 9: README and checklist**

Add to `README.md` immediately after the Map layers section from Task 5:

```markdown
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
```

Rewrite `docs/summaries/CHECKLIST.md` to mark all six tasks complete, with an
`_Updated: 2026-08-07 — hindustanis_` line, per the repo's checklist convention.

- [ ] **Step 10: Full verification — everything, in one pass**

```bash
cd frontend && npm run test && npm run typecheck && npm run build
```

Expected: `Tests 606 passed (606)` across 49 files, typecheck silent, build succeeds.

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
```

Expected: `21 passed` — **unchanged**. This phase adds no backend code and consumes only the
existing `/api/type/{hex}`. If this number moved, something was touched that should not have been.

```bash
grep -rn "from \"cesium\"" frontend/src --include="*.ts" --include="*.tsx" | grep -v "^frontend/src/globe/"
git diff --stat main -- frontend/package.json frontend/package-lock.json
```

Expected: no output from either.

- [ ] **Step 11: Commit, show it running, then STOP**

```bash
git add frontend/src docs README.md && git commit -m "feat(dashboard): wire the cockpit end to end + acceptance addendum"
```

```bash
bash scripts/dev.sh
```

Open http://localhost:5173, walk checkpoints 14–25, screenshot each one — then **stop and wait for
owner sign-off** (CLAUDE.md ground rule 5). Do not start Phase D.

---

## Definition of done

- [ ] Every D-1 … D-8 clause has a step against it in the requirement map above, and that step ran.
- [ ] `cd frontend && npm run test` → **606 passed across 49 files**, zero failures, zero skips.
- [ ] `cd frontend && npm run typecheck` → silent.
- [ ] `cd frontend && npm run build` → succeeds; the bundle grows by roughly the size of
      `airports-world.json` and nothing else unexpected.
- [ ] `cd backend && .venv/bin/python -m pytest tests/ -q` → **21 passed**, unchanged.
- [ ] `grep -rn 'from "cesium"' frontend/src --include="*.ts" --include="*.tsx" | grep -v '^frontend/src/globe/'` → no output.
- [ ] `git diff --stat main -- frontend/package.json frontend/package-lock.json` → no output. No new dependency, no jsdom, no testing-library.
- [ ] The weather and ATC panels contain the literal string `NO FEED · FUTURE INTEGRATION` and **no digits**, asserted by `dashboard/panels.test.tsx`.
- [ ] The radar reaches `RADAR OFFLINE · NO FEED` and `FEED STALE · BLIPS FROZEN` from the real feed status, asserted by `radarMath.test.ts` and `RadarScope.test.tsx` and verified live in checkpoint 22.
- [ ] The detail card's three adsbdb states (loading / no record / unreachable) are distinct in the tests and verified live in checkpoint 20.
- [ ] `attributionFor()` is the only place an attribution line is composed; both `StatusBar` and `Hud` call it; Cesium's own credit container is still visible and unrestyled beyond `tokens.css`'s font rules.
- [ ] Six commits, one per task, each on a green suite.
- [ ] `docs/decisions.md` carries CD-001 … CD-010.
- [ ] `docs/summaries/phase-b-acceptance-runbook.md` carries checkpoints 14–25; `README.md` carries the Map layers and cockpit sections; `docs/summaries/CHECKLIST.md` is current.
- [ ] Owner has walked checkpoints 14–25 and signed off. **Stop here.**

## Known limitations to carry forward (write these into the sign-off, do not hide them)

- **No terrain occlusion on the windscreen tags** (CD-007) — a contact behind a ridge inside 40 NM
  still gets a tag. The tag does not claim line of sight, but it looks like it does.
- **Tags lag the camera by up to 100 ms** (CD-007) — they recompute on snapshot identity, not per
  frame. Visible only during a fast slew.
- **The slip ball is sideslip, not lateral acceleration** (CD-002) — correct within this model,
  which has no crosswind, P-factor or engine torque. The moment any of those is added, this
  instrument must be re-derived.
- **No barometric setting, no heading bug, no vacuum/gyro annunciators** (CD-004) — deliberately
  absent rather than drawn inert.
- **Vfe and Vno are markings, not limits** (CD-003) — the white arc does not enforce anything, and
  exceeding it has no consequence in the sim.
- **Three Cesium adapters are untested** — `globe/TrafficOverlay.tsx`, `globe/basemap.ts`,
  `globe/labelLayers.ts` (plus `globe/OverlayLayers.tsx`). All four need a live `Viewer`; every
  decision they make lives in a tested pure module, and the rest is covered by checkpoints 19–25.
- **`geoRange.ts` is spherical, not WGS84** — under 0.3% error at 250 NM, confined to display code
  while the sim itself stays ellipsoidal (G-003).
- **Airport labels are a snapshot of OurAirports at generation time** — they go stale silently
  until someone re-runs `scripts/fetch-ourairports.sh`. Acceptable because airport positions do
  not move; worth remembering if a new airport is missing.
