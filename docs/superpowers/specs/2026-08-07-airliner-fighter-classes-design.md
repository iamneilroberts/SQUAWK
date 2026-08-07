# Design: Airliner (737-800) + Fighter (F-5E) controllable classes

**Date:** 2026-08-07
**Status:** DESIGN — pending owner review (this file is the brainstorming output; the
implementation plan follows once approved).
**Related:** issues #2 (supersonic, deferred), #7 (control-state indicators — shows
afterburner state), #8 (expanded roster — this feature builds the fixed-wing multi-class
infra those later data files reuse).

---

## 1. Outcome

TAKE CONTROLS of a real airliner or fast-jet seen in the live ADS-B feed. The flight model
is **inferred from the contact's real type designator**, and the handoff card **discloses the
substitution** (e.g. `A320 → 737-800 MODEL`). The sim keeps its ground rule: **one fixed-wing
6-DOF force model, parameterized entirely by data files — no per-class code branches.** This
feature adds two sourced data files and five small shared code seams; every class difference
stays data.

Owner decisions folded in (2026-08-07 brainstorm):
- Build **both** classes this phase (737-800 and F-5E), not the 737 alone.
- Class is **inferred from type; unknown/missing/unmatched → C172** default, disclosed.
- Afterburner is a **separate dry/wet toggle** (a plain boolean, per the F-5 owner decision —
  no FBW/FLCS path).
- F-5E is **capped subsonic** (the model has no wave-drag physics); supersonic is deferred to
  issue #2 so the sim never runs where it would silently lie.
- The **attitude indicator is per-class**: C172 keeps its minimalist line horizon; the jets
  get a filled "horizon ball" ADI rendered in the mission-terminal palette.

---

## 2. The five code seams (all data-selected, no branches)

### 2.1 Turbofan power lapse
- `LapseModel` gains `"turbofan"` (`sim/types.ts`); add `POWER_LAPSE_MODELS.turbofan` in
  `forces.ts` (flat rated thrust up to a corner altitude, then a σ-relative falloff above);
  add `"turbofan"` to the validator's `LAPSE_MODELS` array in `params.ts`.
- **Constant-thrust with no new thrust code:** the existing `T = η·P/max(V, propPeakSpeedMs)`
  already yields constant thrust when `propPeakSpeedMs` is set above the max flight TAS — then
  `max(V, Vpeak) = Vpeak` and `T = η·P/Vpeak`, independent of speed. So a flat-rated turbofan is
  expressed by tuning `maxPowerW` + `propPeakSpeedMs` (documented knobs), reusing the prop
  formula. This keeps the "one shape" rule; the alternative (a jet-specific thrust branch) is
  rejected.
- The turbofan lapse curve (corner altitude + falloff exponent) is a **documented tuning knob**,
  verified by the envelope tests (737 must trim at cruise ~M0.78 at FL350). One shared curve
  for both jets in v1 (both are flat-rated turbofans); parameterizing per-jet is deferred as
  YAGNI unless an envelope test demands it.

### 2.2 Afterburner (F-5E)
- `ControlVector` gains `afterburner: boolean` (`sim/types.ts`); `propulsion.afterburnerFactor`
  (data, **required in every file**, `1.0` where there is no afterburner).
- `thrustNewtons` multiplies shaft power by `afterburner ? afterburnerFactor : 1`. Classes with
  factor 1 are unaffected — no branch.
- New edge-triggered toggle key `KeyB` (burner) — added to `GAME_KEY_CODES` + `KEYMAP` +
  `ControlsHelp`, guarded against Ctrl/Cmd/Alt like the other keys. (Note: `KeyL` is taken by
  the return-to-level assist from the polish batch; verify `KeyB` is free at implementation.)
  HUD shows `DRY`/`WET`; classes with `afterburnerFactor` 1.0 show nothing.

### 2.3 Mach limit
- `limits.mmo` (data, **required everywhere**). C172 gets a value it never reaches (documented);
  jets get their real Mmo (737 ≈ 0.82; F-5E capped ≈ 0.95).
- Add speed-of-sound `a = √(γ·R·T)` from the existing `isaTemperatureK` (γ=1.4, R=287.05287),
  and Mach = TAS/a, in `isa.ts` / the force result.
- HUD gains a **Mach-overspeed annunciator** alongside the current IAS/Vne overspeed. The
  analog ASI face is unchanged (Mach is a HUD annunciator, not painted on the steam gauge).

### 2.4 Per-class ASI gauge face
- `gaugeMath.ts` currently hardcodes `ASI_MIN_KT = 40 / ASI_MAX_KT = 180` as module constants.
  Move the range into a per-class **`display` block** on `ClassParams` (`asiMinKt`, `asiMaxKt`);
  `asiNeedle`/`asiDegFor`/`asiArcs` take the range; `SixPack` threads it; tick labels derive.
- The four painted arcs still come from the V-speeds already in `limits`
  (Vs0/Vfe/Vs1/Vno/Vne) — they simply render at jet speeds. This is the hard gate from prior
  reviews: an airliner cannot fly the 40–180 kt face.

### 2.5 Per-class attitude indicator ("horizon ball")
- `display.attitudeStyle: "line" | "ball"` (data). **C172 = `"line"`** (the existing minimalist
  horizon, unchanged). **b738 / f5e = `"ball"`**: a filled ADI — sky above / ground below the
  horizon, bright horizon line, roll pointer + bank scale.
- **Palette-safe** (owner choice): dim cyan-tinted sky, darker/olive ground — reads instantly as
  an attitude ball but stays in the mission-terminal monochrome language (NOT garish
  blue/brown; NO shadows). Rendered in `SixPack.tsx`, driven by `attitudeStyle`.

---

## 3. Two data files

`params/b738.json` and `params/f5e.json`, following `c172.json`'s discipline **exactly**: every
number carries a `sources` entry (book value, JSBSim/OpenAP cross-check, or "TUNING KNOB" with
the envelope-test target it was tuned against). Target numbers (to be sourced/verified in the
plan's envelope tests — treat as design intent, not final):

- **737-800 (B738):** ~79 t operating mass, turbofan lapse, `afterburnerFactor` 1.0, Vmo ≈ 340
  KIAS / Mmo 0.82, +2.5/−1.0 g, service ceiling ~41,000 ft, large roll inertia (low
  `rollRateMaxRadS` + high `rollDampingPerS`), ~8 flap detents (0/1/2/5/10/15/25/30/40), ASI
  face ~60–400 kt, `attitudeStyle: "ball"`.
- **F-5E:** turbofan lapse, `afterburnerFactor` ~1.5 (dry→wet), Mmo capped ~0.95, high roll rate,
  fighter g-limits (~+7.3/−3), maneuvering + landing flap detents, ASI face ~80–800 kt,
  `attitudeStyle: "ball"`. **Fighter numbers need Phase-B source verification** (CLAUDE.md).

`c172.json` gains the three new required fields: `limits.mmo`, `propulsion.afterburnerFactor`
(1.0), `display` (`asiMinKt` 40, `asiMaxKt` 180, `attitudeStyle` "line").

---

## 4. Class resolution & disclosure

`takeover/eligibility.ts` grows from a GA-only gate into a resolver:

- **`resolveClass(contact) → classId`** using three designator lists (data files, like
  `ga-types.json`): fighter/fast-jet designators → `f5e`; airliner/regional/jet designators →
  `b738`; existing GA list → `c172s`; **unknown / missing type / unmatched → `c172s`** default.
- **Drop the military hard-block** (`contact.military` no longer refuses — the F-5E is military).
  A military fast-jet designator resolves to `f5e`; an unmatched military type falls to the
  `c172s` default (disclosed).
- **Keep every physical gate** (on-ground, stale position > `MAX_SEEN_POS_S`, no altitude, no
  ground speed, no track) — those still refuse honestly.
- **Disclosure:** the handoff card always shows `<REAL TYPE> → <MODEL> MODEL` (e.g.
  `C130 → C172 MODEL (NO MATCHING CLASS)`), using the resolved class's `modelNote`.

The `TAKE CONTROLS` button + tooltip keep using the SAME predicate for disabled-state and
reason string (the existing invariant).

---

## 5. Envelope tests (per class)

Extend the existing trim-search / envelope suite:
- **b738:** trims at cruise ~M0.78 @ FL350; Vmo and Mmo both bite (whichever is lower in IAS
  terms at altitude); service ceiling behaves; g-clamp at +2.5/−1.0.
- **f5e:** climb performance sane; **dry-vs-wet thrust delta** measurable (afterburner raises
  thrust by ~`afterburnerFactor`); Mmo cap holds; fighter g-limits clamp.
- **params.test.ts:** the new required fields (`mmo`, `afterburnerFactor`, `display`,
  `lapseModel: "turbofan"`) validate, and their absence is a load-time error.

---

## 6. Hard gates (carried from prior reviews)

- The validator **REQUIRES** `limits.mmo`, `propulsion.afterburnerFactor`, and the `display`
  block in **every** params file — no silent defaults, same discipline as `lapseModel`. This
  forces `c172.json` to be updated too.
- The **per-class ASI face** and **per-class attitude style** ship in this feature (no jet flies
  the C172 gauge).

---

## 7. Non-goals / deferred

- **Supersonic + wave drag** → issue #2. F-5E stays subsonic-capped until then.
- **No FBW/FLCS** (owner decision) — the F-5E is a plain stable jet with a dry/wet toggle.
- **No jet-specific thrust branch** — flat thrust comes from the prop formula via a high
  `propPeakSpeedMs`.
- **ASI stays the analog four-arc face** — no barber-pole tape; Mach is a HUD annunciator only.
- **C172 keeps its line horizon** — the ball is jets-only.
- **Rotorcraft and other roster types** (issue #8) are out of scope — this feature only builds
  the fixed-wing multi-class infra.

---

## 8. Decisions to log (docs/decisions.md, on implementation)

1. Turbofan modeled as constant thrust via a high `propPeakSpeedMs` on the existing prop
   formula (no jet thrust branch); `maxPowerW`/`propPeakSpeedMs` are documented knobs.
2. One shared turbofan lapse curve for both jets in v1 (per-jet parameterization deferred).
3. Afterburner as `boolean × afterburnerFactor` data, required (1.0) in every file.
4. Class inferred from type; unknown/unmatched → C172, disclosed on the handoff card; military
   hard-block dropped.
5. F-5E capped subsonic (issue #2 for supersonic).
6. Per-class ASI face + per-class attitude style ("line" vs palette-safe "ball").

---

## 9. Open items / risks

- Exact turbofan lapse curve (corner altitude, falloff) — nail via the b738 cruise envelope
  test in the plan.
- F-5E aero/thrust numbers are the least-sourced; the plan must cite sources or mark TUNING
  KNOB with a measured target.
- Afterburner toggle key binding + HUD `DRY/WET` placement — minor, decide in the plan.
- Designator→class lists start small and grow (data); coverage is honest via disclosure, not
  completeness.
