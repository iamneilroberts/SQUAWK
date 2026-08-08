# Item 2 — Precipitation-radar overlay on NavMap (#17)

**Branch:** `weather-radar` · **Base:** `main` (c98bc4e)

## Goal
Overlay real precipitation radar on the 2D nav-map (`dashboard/NavMap.tsx`). Honest offline.
Attribution shown. No new npm dependency. Keep the existing test suite green + add tests.

## Source decision (owner-approved)
**RainViewer** public weather-maps API — global, keyless. NOT LORAN's Iowa-State NEXRAD
(US-only). Radar only; no METAR text panel.

- Manifest: `GET https://api.rainviewer.com/public/weather-maps.json` → `{host, radar:{past:[{time,path}],nowcast:[...]}}`.
- Tile URL (standard XYZ / Web-Mercator): `{host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png`
  (size 256, color scheme 2 "Universal Blue", smooth 1, snow 1 — tune later).
- Global coverage. Attribution string: `Weather data © RainViewer` (link rainviewer.com),
  in the same attribution slot idiom as `globe/mapSources.ts` `attributionFor()` /
  `TRAFFIC_CREDIT`. Add RainViewer to the data-sources documentation too.

## The projection problem (THE core design call — record in docs/decisions.md)
NavMap is a pure-SVG, own-ship-centered, **north-up, linear-range NM polar** plot
(`navMath.ts navXY`), radius `NAV_RADIUS_PX=96`, default range `50 NM`, presets `[10,25,50,100,200]`.
RainViewer tiles are Web-Mercator raster — **NOT pixel-compatible** with the polar face.

**Chosen approach = correct reprojection (honest-data ground rule), NOT flat-paste:**
For each output pixel inside the `NAV_RADIUS_PX` circle: px → (range,bearing) → destination
lat/lon (reverse of `navXY` + `geoRange`) → Web-Mercator pixel in a composited tile canvas →
sample. Render the resulting canvas absolutely-positioned/`<foreignObject>` UNDER the SVG range
rings and airports, clipped to the circle, alpha ~0.5 so it reads as overlay not basemap.
Reject the cheap "treat tiles as locally planar" hack — it implies precision the projection
doesn't have at 50–200 NM ranges.

Put the pure warp math in a new `dashboard/navWeatherMath.ts` (sibling to `navMath.ts`),
fully unit-tested (no jsdom, no Cesium — same discipline as `navMath.ts`).

## Layering & seam
- New canvas/`<image>` layer inside NavMap's `<svg>`, **between range rings and airport marks**
  (after the "N" label ~line 61, before airports ~line 63). Precip under airports/traffic,
  above the ring grid.
- Center = ownship (`snapshot.latDeg/lonDeg`); if `snapshot === null`, plot nothing.

## Honest-offline (clone WeatherPanel.tsx, NOT navStatus — RainViewer is a 3rd-party feed
independent of the ADS-B `feedStatus`)
- State machine like `WeatherState`: `no-position | loading | unreachable | ok`.
- `unreachable` ("NO RADAR FEED") = manifest fetch failed OR no usable frame. Distinct wording
  from ADS-B's `FEED OFFLINE · TRAFFIC FROZEN`.
- No fake tiles / placeholder precip on any non-`ok` state — reuse the `<Empty>` component idiom.
- Surface the chip in NavMap's existing `<span className="navmap-status">` slot.
- **Frame age:** display the chosen frame's `time` (unix). Never show a stale frame silently.
- **Coverage honesty:** mirror `coverageNote` — if nav range exceeds usable radar coverage/zoom,
  say so rather than showing empty-as-if-confirmed sky.

## Staleness / refresh (pattern from LORAN radarLayer.ts, reference-only)
- Re-fetch the manifest on a timer (~a couple min); **rebuild** the layer keyed to the newest
  frame timestamp (drop + recreate, cache-bust), never mutate a stale frame in place.
- Cap max zoom level (RainViewer `z`) against upscaled-tile false precision.

## Toggle
- Check for an existing dashboard **WX toggle** (handoff mentions "WX/CTRL toggles" in the glass
  dashboard). Reuse it if present; else add a WX toggle, **off by default** (like LORAN `showRadar`).
- Attribution credit shown only while the overlay is active.

## Fetching
- Tiles = imagery, browser-direct (like Esri basemap), no backend change expected.
- Manifest JSON: try browser-direct first (RainViewer sends CORS). **If CORS-blocked**, add a
  thin backend proxy route mirroring the existing ADS-B/adsbdb proxy pattern — do NOT ship a
  browser call that will fail in prod. Verify.

## Definition of done
- `cd frontend && npx vitest run` green (baseline ~939 + new tests). New pure-math tests are
  broken-arm style (fail if the warp is wrong, not just "renders").
- `tsc` + `vite build` clean. **Zero new npm deps.**
- Honest-offline proven by test (unreachable → NO RADAR FEED, no fake tiles).
- `docs/decisions.md` dated entry: RainViewer-over-NEXRAD + reproject-over-flat-paste.
- RainViewer added to attribution + data-sources docs.
- Ground rules held: only-real-data (no synthesized precip), SIM machinery untouched.
