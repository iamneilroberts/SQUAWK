# Gulf Coast place labels — design

**Date:** 2026-08-12 · **Branch:** `mongols-rich-hud` (live prod) · **Issue:** place labels to help navigate.

Owner approved variant **B** (glyph + text) via mock. All labels ride the existing **LABELS** toggle.

## Goal

Give the flyer ground orientation over the northern Gulf Coast: town names, curated landmarks
(bays, islands, rivers, keys), airports by shortened name, and VOR-family navaids by code.
Extends the existing labels pipeline (`labelLayers.ts`, `data/airports.ts`, `OverlayLayers.tsx`,
`mapSources.ts`) — no new toggle, no new store state.

## Decisions

| Choice | Decision |
|---|---|
| Towns/landmarks | **Curated Gulf Coast** set (not global). bbox ≈ lat 29.0–31.5, lon −91.5…−84.5 (New Orleans → Panama City). |
| Navaids | **VOR family only**: VOR, VORTAC, VOR-DME, TACAN. Labeled by **ident/code** (chart standard — overrides names-not-codes for navaids). |
| Airports | Keep large+medium extract (**no small fields**). Switch labels from code → **shortened name**. |
| Symbols | **Unicode glyph prefix** in the label text (not billboards): `▪` airport, `⬡` navaid, `•` landmark; towns have no glyph. |
| Colors | towns steel-gray `#93a6ad` · landmarks dim cyan (cyan @ ~0.72) · airports bright cyan `#5fd7e0` · navaids green `#7ec87e`. |
| Toggle | Single existing **LABELS** button (`store.labelsOn`). All four categories on/off together. |
| Esri place raster | Retained for coverage outside the curated Gulf Coast set. |

## Components

### Data (Cesium-free, unit-tested — mirrors `data/airports.ts`)

1. **`data/places.ts` + `data/places-gulf.json`** (committed, hand-curated)
   - `Place = { name: string; kind: "town" | "landmark"; latDeg; lonDeg }`
   - `visiblePlaces({ places, cameraHeightM, centerLatDeg, centerLonDeg, maxLabels? })` → nearest-N,
     camera-height tier (towns+landmarks below a mid tier; nothing above a marble tier). Pure, tested.
   - `loadPlaces()` validates + caches the JSON (fail-fast validator like `validateAirports`).
   - ~30–45 towns + ~15–25 landmarks across the Gulf Coast bbox.

2. **`data/navaids.ts` + `data/navaids-vor.json`** (generated + committed)
   - `Navaid = { ident: string; name: string; type: string; latDeg; lonDeg }`
   - `scripts/fetch-ournavaids.sh` — mirrors `scripts/fetch-ourairports.sh`; downloads OurAirports
     `navaids.csv`, filters to VOR/VORTAC/VOR-DME/TACAN, emits the JSON. Not fetched at runtime.
   - `visibleNavaids({ navaids, cameraHeightM, center…, maxLabels? })` → nearest-N + camera tier. Pure, tested.
   - `navaidLabelText(n)` → `n.ident`.

3. **`data/airports.ts`** (modify)
   - New pure `shortenAirportName(name, ident, iata)`: strip trailing "Airport"; Regional→Rgnl,
     International→Intl, Municipal→Muni, "Intl Airport"→"Intl", collapse whitespace; fall back to
     ident if the result is empty. Unit-tested table of cases.
   - `airportLabelText` returns `shortenAirportName(...)` instead of `iata ?? ident`.

### Cesium layer — `globe/labelLayers.ts` (additions)

- `createPlaceLabelRef()`, `syncPlaceLabels(labels, ref, visible)` — glyph-prefixed, per-kind color,
  LORAN style (uppercase, letter-spaced via the existing label style), mutate-in-place (ref Map keyed
  by name); never rebuild the collection (the contactBillboards lesson, same as airports).
- `createNavaidLabelRef()`, `syncNavaidLabels(labels, ref, visible)` — `⬡ IDENT`, green.
- `clearPlaceLabels` / `clearNavaidLabels`.
- All reuse the shared `bundle.labels` LabelCollection (airports already do).

### Wiring — `globe/OverlayLayers.tsx`

Extend the existing `labelsOn` camera-driven effect: on `camera.changed` (and once on mount),
compute `visiblePlaces` + `visibleNavaids` from the camera cartographic and call the two new sync
fns alongside `syncAirportLabels`. Clear all three on cleanup / labels-off. Keep `percentageChanged`
throttle. One effect, three label families sharing the camera hook.

### Attribution — `globe/mapSources.ts`

- Add `NAVAIDS_CREDIT = "NAVAIDS: OURAIRPORTS (PUBLIC DOMAIN)"` and (if desired) keep places under a
  `PLACES_CURATED_CREDIT = "PLACES: CURATED"`; OurAirports already covers airports.
- `attributionFor({ labelsOn })` appends navaids (+ curated) credit when labels on.

## Testing

- Pure fns unit-tested: `visiblePlaces`, `visibleNavaids`, `shortenAirportName`, validators.
- Sync fns follow the existing airport-label test approach (mutate-in-place assertions) where present.
- Full gate: `typecheck` (app+worker), `test:unit` (all green), `lint` (≤8 warns, add none).

## Out of scope

- Separate per-category toggles (all under LABELS for now).
- Billboard/pixel symbols (unicode glyphs instead; revisit if the owner wants compass roses).
- Small airfields / heliports; NDBs; global (non-Gulf) curated places.
- Runways, approach fixes, airspace.

## Task breakdown (TDD, one commit each)

1. `shortenAirportName` + switch airport labels to names (test-first).
2. `data/places.ts` + curated `places-gulf.json` + `visiblePlaces` (test-first).
3. `scripts/fetch-ournavaids.sh` + generated `navaids-vor.json` + `data/navaids.ts` + `visibleNavaids` (test-first).
4. `labelLayers.ts`: `syncPlaceLabels` + `syncNavaidLabels` (+ refs/clear) with glyphs & colors.
5. `OverlayLayers.tsx` wiring + `mapSources.ts` attribution.
6. Gate green → live-verify in FREE FLIGHT (chrome-devtools) → owner signoff → deploy.
