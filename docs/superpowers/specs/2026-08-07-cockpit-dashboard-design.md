# Cockpit dashboard + traffic view (post-Phase-B spec delta)

**Date:** 2026-08-07 · **Status:** owner-approved direction (3 design answers), spec under review
**Parent:** `2026-08-05-phase-b-first-flyable-design.md` — all Phase B rules carry forward.

## 1. Owner decisions

| # | Decision |
|---|---|
| D-1 | **Bottom cockpit strip**, collapsible: six-pack left, radar center, weather right, controls-help toggle at the edge. Each panel individually collapsible; whole strip toggles. _(Update 2026-08-07, #12: the ATC panel was removed — no honest live ATC source exists — so weather now sits alone on the right.)_ |
| D-2 | **Analog six-pack**, SVG in LORAN line style (1px strokes, cyan/amber on near-black): ASI, artificial horizon, altimeter, turn coordinator, heading (DG), VSI. Driven by the real ~10 Hz HUD snapshot. |
| D-3 | **Windscreen traffic is real and interactive**: any live contact inside the FPV frustum gets a compact screen-anchored indicator (callsign/type/alt); click → LORAN-style detail card (feed fields + `/api/type/{hex}` enrichment). No synthesis — indicators exist only for contacts on the live feed. |
| D-4 | **Radar scope renders real contacts** (they're already in the store): PPI-style range rings, selectable range (10/40/80/150/250 NM buttons), own-ship centered, heading-up. Blips = live contacts only; feed OFFLINE → scope shows explicit OFFLINE state, blips freeze/dim per the browse stale policy. |
| D-5 | **Weather panel is chrome-only**: full LORAN panel framing with an explicit `NO FEED · FUTURE INTEGRATION` empty state (weather radar feed from LORAN — future). Nothing fake ever renders. _(Update 2026-08-07, #12: the parallel ATC placeholder was removed — research found no honest live ATC source: LiveATC ToU forbids third-party product use, SDR covers only local airspace, STT WER 15–30% garbles callsigns. Weather feed integration is still tracked (#10).)_ |
| D-6 | **Controls help**: collapsible keymap panel generated from the real `KEYMAP` constant (single source of truth — no hand-copied key list). |

## 2. Honest-data notes (binding)

- Six-pack and windscreen indicators read the same sim snapshot / live feed as the HUD — no derived fiction.
- Weather/ATC placeholders may not contain sample imagery, fake METARs, or fake transmissions. Empty-state text only.
- Radar blips and windscreen tags appear/disappear exactly with the feed; staleness follows the existing feed-status chip semantics.
- Detail card fields that the feed/adsbdb lack render as em-dash.

## 3. Scope

**In:** `dashboard/` component family (strip, collapse state in zustand or local state — NOT the sim loop), six SVG gauges, windscreen projection of contacts (Cesium `SceneTransforms` world→screen, done in the render layer — `sim/` stays Cesium-free), traffic detail card, radar scope (2D canvas or SVG, range selector), weather/ATC placeholder panels, controls-help panel, per-panel collapse, strip toggle key.
**Out (unchanged/future):** weather radar integration, ATC transcript feed + color-coded correlation, ADS-B radar app extraction, any new backend endpoints (only existing `/api/type/{hex}` is consumed).

## 4. Constraints carried

LORAN visual language · no new deps (SVG/canvas hand-rolled) · no jsdom (pure helpers + element-tree tests; gauge needle math, projection math, range scaling all pure + tested) · StrictMode-safe · gauges read the 10 Hz snapshot, never 60 Hz sim state · attribution/status bar unchanged · Phase B suites stay green.

## 5. Acceptance sketch

Fly the C172: six-pack needles track HUD numbers (AI horizon matches the real horizon); a live contact crossing the windscreen gets a tag; clicking it opens the detail card with real feed + adsbdb data; radar shows the same traffic at the selected range; weather/ATC panels show honest FUTURE states; `?` (or button) toggles controls help; every panel collapses; browse mode unaffected.

## 6. Addendum (owner, 2026-08-07): labels + light basemap

| # | Decision |
|---|---|
| D-7 | **Place/airport names toggle**: Esri "World Boundaries & Places" keyless reference layer for place names + bundled OurAirports public-domain extract for airport names/idents (LORAN-styled Cesium labels, declutter by camera height). Off by default; toggle in the status bar/dashboard. Attribution appended when active. |
| D-8 | **Alternative basemap toggle for low load**: `SAT` (Esri World Imagery, current) ↔ `CHART` (Esri Dark Gray Canvas, keyless — lighter tiles, LORAN-compatible dark look). Imagery layer swap only; terrain unchanged. Attribution line follows the active basemap. Honest fallback rules unchanged. |

Both are real data sources (no synthesis); both toggles live with the radius chip's pattern.
