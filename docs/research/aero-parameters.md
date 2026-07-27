# 6-DOF parameter research: C172 / 737-800-class / F-16-class

Research-agent output, 2026-07-27, verbatim. **Note:** the fighter class was re-based to
F-5/T-38 (stable airframe) *after* this pass (decision G-002) — the F-16 section below is
kept because its NOTES explain exactly why, and its thrust/limit figures remain useful
reference. F-5E/T-38 numbers still need their own source pass in Phase B.

## 1. Cessna 172 (piston GA) — representative: 172S, Lycoming IO-360-L2A

| Parameter | Value | Unit | Source |
|---|---|---|---|
| Max takeoff mass | 1,157 (2,550) | kg (lb) | POH/type data — cross-checked: Purdue/globalair specs |
| Typical operating mass | ~950–1,050 (2,100–2,300) | kg (lb) | typical 2-pax + fuel load, estimate |
| Wing area S | 16.2 (174) | m² (ft²) | JSBSim c172x.xml; Roskam table (independent match) |
| Wingspan b | 11.0 (36.0) | m (ft) | JSBSim c172x.xml (Roskam gives 35.8 ft — close) |
| Aspect ratio | 7.45 | — | derived, b²/S |
| CLmax clean | ~1.5 (range 1.47–1.58) | — | JSBSim (1.47); NACA 2412 airfoil data (1.58) |
| CLmax flaps (40°) | ~2.0 | — | **estimate** — no direct source, typical GA flap increment |
| CL_alpha | ~4.9 | /rad | derived from NACA 2412 2D slope + finite-AR correction; JSBSim table range 4.5–4.7/rad |
| Stall AoA | ~15–16.5 | deg | NACA 2412 critical AoA (~15°); wind-tunnel model data (16.5° at CLmax=1.58) |
| CD0 | 0.032 | — | JSBSim c172x.xml (0.032); independent aero model (0.0329) |
| Induced drag k / Oswald e | k≈0.060, e≈0.70 | — | derived from published model (CD0=0.0329, K=0.0599, S=15.98 m², m=907 kg) |
| Engine power | 180 (134) | hp (kW) | Lycoming IO-360-L2A spec, well-sourced |
| Static thrust | ~670–785 | lbf | MT/Hartzell prop test data (backcountrypilot.org) |
| Prop efficiency assumption | η≈0.80 cruise | — | **assumption**, typical fixed-pitch/CS GA prop |
| Thrust model | power-limited: T=η·P/V, capped at static thrust | — | derived requirement |
| Vs1 (clean stall) | 48 | KIAS | 172S POH |
| Vs0 (flaps stall) | 40 | KIAS | 172S POH |
| Vne | 163 | KIAS | 172S POH |
| Service ceiling | 14,000 | ft | 172S POH |
| Cruise TAS | 122–124 | kt | 172S POH, 75% power @ 8,000 ft |
| Limit load factor | +3.8 / −1.52 | g | FAR/CS-23 Normal category cert limit |
| Max roll rate | ~30–45 (est.) | deg/s | **estimate** — no POH figure found; typical light-GA full-aileron rate |

## 2. A320/737-800-class airliner — primary: 737-800; A320 cross-checked

| Parameter | Value | Unit | Source |
|---|---|---|---|
| Max takeoff mass | 79,000 (174,200) | kg (lb) | 737-800 spec; A320-200 cross-check ≈78,000 kg. (One search hit gave A320 MTOW 93.5 t — inconsistent with standard A320-200 figures, likely variant mismatch — **flagged, not used**) |
| Typical mid-cruise mass | ~65,000 | kg | estimate, ~80% MTOW |
| Wing area S | 125 (1,344) | m² (ft²) | 737-800 multiple specs agree (124.6–125.0 m²); A320 cross-check 122.6–128 m² |
| Wingspan b | 34.3 (112'7") | m | 737-800 (35.9 m with split winglets); A320 35.8 m |
| Aspect ratio | ~9.4 | — | derived, b²/S (737-800) |
| CLmax clean | ~1.4–1.6 | — | **textbook estimate** — typical swept transport wing |
| CLmax takeoff flaps | ~2.0–2.2 | — | **estimate** |
| CLmax landing (full flap/slat) | ~2.6–3.0 | — | **estimate**, from "80–110% increase over clean" for slotted Fowler flaps |
| CL_alpha clean | ~5.5 | /rad | **textbook estimate** for moderate-sweep transport wing |
| Stall AoA (clean) | ~14–16 | deg | **estimate**, typical swept transport wing pre-slat |
| CD0 (clean cruise) | ~0.020–0.024 | — | **estimate** — Roskam/Raymer-class jet-transport range |
| Oswald e | 0.80 | — | Roskam's standard jet-transport sizing assumption |
| Induced drag k | 0.042 | — | derived, k=1/(π·e·AR), AR=9.45 |
| Engine (737-800) | CFM56-7B26/27 | — | well-sourced |
| Max thrust per engine | 26,300–27,300 | lbf | CFM56-7B spec sheet (aircraft-commerce.com); Wikipedia cross-check consistent |
| Thrust model | flat-rated turbofan | — | thrust ≈ constant up to flat-rate temp/altitude, then falls with density altitude; also falls with Mach (ram drag) — **must be a lapse curve, not constant** |
| Vmo/Mmo | 340 KIAS / 0.82 | — | well-established published figure (a 480–490 KIAS search artifact was discarded as invalid) |
| Service ceiling | 41,000 | ft | 737-800 spec, cross-checked A320 (39,100–41,000 ft) |
| Cruise TAS | 455–470 | kt | typical FL350–390, M0.78–0.80 |
| Limit load factor | +2.5 / −1.0 | g | FAR/CS-25 transport category standard |
| Max roll rate | ~15–20 (est. at approach), ~2–8 at cruise altitude | deg/s | **estimate**, forum/general aero discussion; no OEM spec; cert only requires 60° bank in 5–10 s |

## 3. F-16-class fighter — Block 30/32, F100-PW-229 (reference only, see header)

| Parameter | Value | Unit | Source |
|---|---|---|---|
| Empty mass | ~8,270 (18,238) | kg (lb) | F-16.net Block 30/32 |
| Typical combat mass (A/A config) | ~12,000 (26,463) | kg (lb) | F-16.net Block 30/32 |
| Max takeoff mass | ~19,200 (42,300) | kg (lb) | F-16.net Block 30/32 (earlier blocks lower) |
| Wing area S | 27.87 (300) | m² (ft²) | JSBSim f16.xml — matches public figure |
| Wingspan b | 9.14 (30.0) | m (ft) | JSBSim f16.xml |
| Aspect ratio | 3.0 | — | derived — notably low, defines this class |
| CLmax (linear-region) | ~1.2–1.5 | — | **estimate** — usable lift is FLCS-AoA-limited, not classic CLmax |
| CL_alpha (linear region) | ~3.5–4.0 | /rad | **estimate**, low-AR theory; strongly nonlinear above ~10–15° AoA |
| AoA limiter | 25 | deg | FLCS software limit, not the aerodynamic stall |
| CD0 (clean, subsonic) | ~0.020–0.025 | — | **estimate** — typical clean-fighter range |
| Oswald e / k | e≈0.85 (est.), k≈0.125 | — | **estimate** — LEX wing doesn't follow elliptic-polar assumptions well |
| Engine | F100-PW-229 | — | well-sourced |
| Max thrust, afterburner | 129.7 kN (29,160 lbf) | — | Pratt & Whitney spec sheet |
| Max thrust, dry (mil power) | 79 kN (17,800 lbf) | — | same source, cross-checked |
| Thrust model | afterburning turbofan | — | strongly nonlinear in Mach + altitude; constant thrust invalid across envelope |
| Mmax | ~Mach 2.0 (clean) | — | widely cited Lockheed figure |
| Corner velocity | 330–440 | KCAS | f-16.net forum — informal |
| Service ceiling | >50,000 | ft | Lockheed Martin fact sheets |
| Cruise TAS (no A/B) | ~500–560 (M0.85–0.9) | kt | estimate |
| Max g | 9 | g | FLCS-limited, well-established |
| Max roll rate | ~240 (onset up to ~300+ before AoA cutback) | deg/s | f-16.net / Falcon BMS dev notes — consistent, not official |

## NOTES

**Well-sourced:** C172 mass/wing/engine/V-speeds/ceiling/cruise/load limit; 737 mass/wing/
thrust/ceiling/cruise/load limit; F-16 wing (JSBSim), mass (F-16.net), thrust (P&W),
9 g / 25° AoA limits, ceiling.

**Estimated / derived (treat as tunable, not ground truth):** all classes' CD0 and
Oswald e/k; airliner CLmax/CL_alpha by flap setting; F-16 CLmax/CL_alpha (real reference —
Stevens & Lewis / NASA TP-1538 — uses full nonlinear lookup tables); GA and airliner roll
rates. Two scraped numbers were internally inconsistent and discarded (A320 93.5 t MTOW;
737 Vmo 480–490 KIAS) — not every scraped number should be trusted at face value.

**Where a simplified parabolic-polar 6-DOF commonly goes wrong per class:**

1. **C172 / GA prop:** thrust must be power-limited (T ≈ η·P/V) with a static cap as V→0 —
   constant thrust gives absurd static acceleration and no top-speed asymptote. Flaps
   change CD0 as well as CLmax/CL_alpha. Real stall is a soft mushy break, not a CL cliff.
2. **Airliner:** flap/slat regimes are discrete and large (CLmax and CD0 both shift).
   Flat-rated thrust is only flat to a threshold, then falls; also falls with airspeed.
   Compressibility drag rise near Mmo — fixed CD0 badly underestimates drag near cruise
   Mach. A320-style FBW envelope protection won't emerge from the plant model. Roll is
   inertia-dominated — porting fighter roll constants makes it far too twitchy.
3. **F-16 (why it was dropped as the class basis):** relaxed static stability — unflyable
   without an active control law; vortex lift makes CL(α) strongly nonlinear exactly in
   the maneuvering regime; the 25° limit is software, not stall; CD0 strongly
   Mach-dependent; 9 g is instantaneous/structural, sustainable only in the corner
   plateau; NASA TP-1538 documents pitch departures from inertia coupling during rapid
   low-speed rolls, which a rate-damping-only moment model won't reproduce.
