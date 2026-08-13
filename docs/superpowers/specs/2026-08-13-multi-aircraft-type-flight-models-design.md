# Multi-Aircraft-Type Flight Models — Design

**Date:** 2026-08-13
**Status:** Approved (brainstorming), pre-plan
**Branch:** mongols-rich-hud (live prod — fly.voygent.app)
**Epic goal:** Take over *any* fixed-wing ADS-B contact and fly a reasonably high-fidelity
model of it, instead of only the 3 hardcoded classes.

---

## 1. Problem

`resolveClass(contact)` (`frontend/src/takeover/eligibility.ts:33`) maps the ICAO type
designator `contact.t` through 3 designator Sets → `f5e` / `b738` / `c172s`, else
`UNSUPPORTED AIRCRAFT TYPE`. Current bucket sizes: 86 GA / 32 airliner / 13 fighter.

Measured current-state pain (verified against the params JSON, 2026-08-13):

- **Business jets** (Citation, Gulfstream, Learjet, Phenom, Challenger): **all UNSUPPORTED** —
  not flyable at all today. Very common ADS-B contacts. Biggest gap.
- **Light/mid turboprops** (PC-12, Caravan/C208, TBM, King Air/B350, Saab): **UNSUPPORTED**.
- **Regional turboprops** (Q400/DH8D, ATR/AT72/AT76): in the airliner bucket → fly as a **737**
  (too heavy/fast for the feel, but airliner-adjacent — acceptable for v1).
- **Widebodies** (777/787/A330/A350): in the airliner bucket → fly as a 737 (wrong inertia,
  same speed regime). **A380/747** are UNSUPPORTED.

## 2. Approach (chosen)

Add **3 new archetype data files** and broaden the designator buckets so nearly every
fixed-wing contact resolves to one of **6 classes**. This is the "few new archetypes + broaden
buckets" balance point — chosen over (a) broaden-only (too low fidelity) and (c) per-airframe
parametric scaling from adsbdb (more sophistication than warranted for v1).

**Invariant preserved:** class differences are **data, not branches**. The flight model in
`sim/` (Cesium-free, fixed 60 Hz) is untouched — a new class is new JSON + allowlist entries +
one envelope test. No new physics code path. No new 3D asset (geometry is dimensions-driven).

**Explicitly out of scope for v1:**
- Helicopters / rotorcraft — needs a separate flight-model path (no fixed-wing lift/stall);
  would break "data not branches". Its own future decision.
- Per-airframe parametric scaling via adsbdb enrichment. `resolveClass` stays designator-Set
  based; adsbdb is *not* consulted. A future v2 could use it as a fallback for
  `MISSING AIRCRAFT TYPE` / unmatched designators.

## 3. The three new archetypes

Each class is anchored to **one specific representative airframe**, exactly as c172s/b738/f5e
already are. Everything else maps to the nearest.

| Class id | Representative | Feel | Absorbs (designators reassigned/added) |
|---|---|---|---|
| `biz`   | **Cessna Citation Latitude-class** mid-size jet | ~M0.80, 2× flat-rated turbofan, retractable, T-tail-ish | Citation family, Learjet, Phenom, Challenger, Gulfstream (nearest) — all currently UNSUPPORTED |
| `tprop` | **Beechcraft King Air 350-class** twin turboprop | ~310 kt, power-limited prop (like C172, bigger), retractable | PC-12, Caravan, TBM, King Air, Saab — currently UNSUPPORTED. **Regional Q400/ATR stay in the airliner bucket** (decision B). |
| `heavy` | **Boeing 777-300ER-class** widebody | ~M0.84, very high roll inertia | Move 777/787/A330/A350 out of the airliner bucket into `heavy`; add A380/747 |

Decisions locked in brainstorming:
- **A — bizjet size:** mid-size Citation Latitude (not large-cabin Gulfstream).
- **B — turboprop split:** `tprop` = light/mid turboprops only. Q400/ATR regionals remain in
  the airliner (`b738`) bucket — one archetype cannot span a 4-ton Caravan and a 30-ton Q400.
- **C — build order:** `biz` → `tprop` → `heavy` (biggest coverage gap first).

## 4. Per-class touchpoints (the mechanical work)

`classId` (`AircraftClassId`) is a hardcoded union that propagates to ~35 files. Adding a class
touches this bounded, well-defined set — most are single-line allowlist edits, and TypeScript's
exhaustive checks guide the rest:

**New data files (per class):**
1. `frontend/src/params/<id>.json` — full `ClassParams` (mass, wing area/span/AR, aero cl0 /
   clAlphaPerRad / stallAlphaRad / cd0 / gearDragCd0 / oswaldE / cyBeta, control rates+damping+
   stiffness+trim, propulsion maxPowerW / lapseModel / propEfficiency / propPeakSpeedMs /
   afterburnerFactor, limits Vne/Vno/Vfe/g/ceiling/Mmo/Vle, flaps detents, gear, display
   ASI range + attitudeStyle, `sources`). `lapseModel`: `turbofan` for `biz`/`heavy`,
   `piston` (prop) for `tprop` — confirm the prop lapse model fits a turboprop or add a
   `turboprop` lapse variant to `POWER_LAPSE_MODELS`/`LAPSE_MODELS` (implementation-time call,
   documented in decisions.md).
2. `frontend/src/mission/profiles/<id>.json` — `MissionProfile` (reachability speeds, runway
   min length/width/elevation + allowed sizes/surfaces, ranking weights). Bigger/faster classes
   demand longer/harder runways.
3. `MODEL_DIMS` entry in `frontend/src/globe/aircraftModelDims.ts` — wingspan/length/etc. for
   the dims-driven low-poly geometry. No GLB.

**Allowlist / mapping edits (per class):**
4. `AircraftClassId` union — `frontend/src/mission/types.ts:1`.
5. `loadClassById` switch — `frontend/src/sim/params.ts` (+ a `load<Id>()` + cache).
6. `validateMissionProfile` class allowlist — `frontend/src/mission/profiles.ts`.
7. Worker mission validator — `worker/http/routes/missions.ts:121` (`classId === ...` chain).
8. `CLASS_LABELS` — `frontend/src/briefing/MissionTray.tsx`.
9. `resolveClass` buckets — new designator JSON lists
   (`params/biz-types.json`, `params/tprop-types.json`, `params/heavy-types.json`), and
   **reassign** the widebody designators out of `airliner-types.json` into `heavy-types.json`.

**Tests (per class):**
10. `frontend/src/sim/<id>-envelope.test.ts` — following `b738-envelope.test.ts` /
    `f5e-envelope.test.ts`. Acceptance envelope (see §6).

## 5. Leaderboards

Leaderboards partition by `classId` (`frontend/src/leaderboards/`, `worker`). Six classes → six
boards. New-type boards **start sparse** and are **not** merged into existing boards — an honest
empty/short board is correct (matches the "unknown fields render as em-dash, never synthesize"
ground rule). No leaderboard schema change beyond the widened `classId` allowlist.

## 6. Envelope acceptance (per archetype, TDD)

Each `<id>-envelope.test.ts` asserts the model is *plausible*, not exact — the same bar the
existing envelope tests hold b738/f5e to:

- **Trimmed level flight** exists at a representative cruise IAS/altitude (solver converges,
  finite pitch, |vertical speed| ≈ 0).
- **Stall speed** (clean, sea level) lands in the right ballpark for the class
  (`biz` ~95–110 kt, `tprop` ~75–90 kt, `heavy` ~130–150 kt) — sanity bounds, not point values.
- **Climb** — positive rate of climb at best-climb speed, sea level.
- **Vne not exceeded** in a trimmed cruise; `mmo` respected for the jets.
- **Roll authority** — `heavy` rolls markedly slower than `biz`/`b738` (inertia sanity).

Exact numbers are sourced during implementation and cited in each params `sources` field +
`docs/decisions.md`. Per CLAUDE.md, non-GA performance numbers need source verification;
treat published type certificate / POH / manufacturer figures as the reference.

## 7. Sequencing

One archetype at a time, each a full loop: TDD envelope test → params/profile/dims → allowlist
edits → bucket assignment → `npm run typecheck && test:unit && lint` → `deploy:production` →
push → owner device-verify (fly a real contact of that type). Order: **biz → tprop → heavy**.

Each archetype is independently shippable; a partial epic still ships value (bizjets flyable
after step 1). Append a `docs/decisions.md` entry per archetype (representative choice + number
sources + any lapse-model decision).

## 8. Success criteria

- A live business jet / turboprop / widebody contact on the map can be taken over and flies a
  believable model of its type (was UNSUPPORTED or 737-as-everything before).
- `UNSUPPORTED AIRCRAFT TYPE` becomes rare for fixed-wing contacts (helicopters/gliders/unknown
  still honestly unsupported).
- `sim/` stays Cesium-free and fully unit-tested; envelope tests green for all 6 classes.
- No new runtime dependency (spec §14 gate).
