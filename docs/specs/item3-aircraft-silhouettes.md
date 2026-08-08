# Item 3 (Route B) — distinct per-type aircraft silhouettes (#15)

**Branch:** `gltf-models` (name is legacy — this is the procedural Route B, NOT glTF; owner chose
Route B because the flat amber/cyan tint discards textures, so glTF would only add silhouette,
which we get here with zero external assets/licenses). **Base:** `main` (46eb15b).

## Goal
Make the three exterior-cam airframes read as clearly different aircraft types, keeping the
existing pure/Cesium-free/watertight/data-driven mesh. NO external assets, NO new deps, NO glTF.
The player-amber / ghost-cyan single-instance tint must keep working unchanged (geometry-only).

## Why the current mesh reads as "one blob" (root causes to fix)
1. **All wings sit on the fuselage centreline (z=0).** The single biggest type cue is missing:
   C172 = HIGH wing (on top), 737 = LOW wing (under belly), F-5 = low/mid wing.
2. **No engines.** A 737's two podded underwing nacelles are its clearest signature.
3. **Constant-chord wings.** Real wings taper; the F-5's low-aspect trapezoidal wing especially.

## Work — all data-driven (new `ModelDims` fields, NO `if (class===)` branches)
Add fields to `globe/aircraftModelDims.ts` `ModelDims` + fill per class, and extend
`globe/aircraftGeometry.ts` `buildAirframe`/`horizontalSurface` to consume them. Priority order
(do 1–3; 4 is optional tuning):

1. **Wing vertical placement** — new `wingZFrac` (fraction of fuselageRadius; negative = up/high,
   positive = low). C172 high (~ -1.0), 737 low (~ +0.9), F-5 low/mid (~ +0.3). Offset the wing
   slab in Z. Same for a sensible fin/tail baseline. THIS IS THE BIGGEST WIN.
2. **Underwing engine nacelles for the 737** — new optional `engine?: {count, spanFracs:[…],
   lengthM, radiusM}` (or similar). Two podded nacelles slung under+ahead of the 737 wing.
   c172s/f5e omit it (field absent → no nacelle, data not branch). Each nacelle = a small closed
   prism/cylinder-ish box, watertight, outward-wound.
3. **Wing taper** — new `wingTipChordFrac` (tip chord ÷ root chord). C172 ~0.95 (near constant),
   737 ~0.35 (tapered), F-5 ~0.4 (trapezoidal). Extend `horizontalSurface` so tip chord differs
   from root chord (currently constant). Keep the leading-edge sweep math.
4. **(optional) nose/fin nuance** — F-5 sharper/longer nose point; C172 blunter. Tuning knob only.

## Hard invariants (existing tests enforce these — keep them green + add per-feature tests)
- Every triangle wound **outward** (CCW seen from outside); mesh **watertight**; per-face normals
  point away from skin (the positive-signed-volume / winding tests in `aircraftGeometry.test.ts`).
- Pure + Cesium-free; `MODEL_DIMS` and `buildAirframe` stay unit-testable.
- Data-driven: adding/removing a feature is a dims-record change, never a code branch on classId.
- `modelDimsForClass` still throws on unknown id.

## Definition of done
- New geometry tests: each new feature has a broken-arm test (e.g. C172 wing vertices are ABOVE
  centreline / 737 nacelle vertices exist below the wing / F-5 tip chord < root chord) — fails if
  the feature is wrong, not merely "builds".
- `cd frontend && npx vitest run` green (baseline 969 + new). `tsc --noEmit` clean. `vite build`
  clean. Zero new deps.
- `docs/decisions.md` dated entry: Route-B-over-glTF (assets unfetchable + flat-tint makes glTF's
  textures moot) + the wingZFrac/nacelle/taper additions.
- Ground rules held: only-real-data, SIM machinery + ghost tint untouched.
- NOT browser-verifiable here (no X server) — geometry invariants are unit-tested; the actual
  look is owner-eyeballed on deploy (exterior cam, press E). State that boundary in the report.
