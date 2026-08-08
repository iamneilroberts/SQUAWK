# Mobile-Optimized Version (+ phone tilt controls) — Design Spec

**Date:** 2026-08-07
**Status:** draft for owner review
**Issue:** #13 — "Mobile-optimized version (+ phone accelerometer for control?)"
**Feature branch:** `mobile-spec` (this document only; no code)

## Problem

The game is desktop-only by construction: keyboard-driven input, a wide two-column
browse layout, hover affordances, and a Cesium viewer rendering continuously at 60 Hz.
The founding spec (`2026-07-27-adsb-game-design.md` §12) lists **"mobile controls
(interface reserved)"** as an explicit v1 non-goal — and its founding-decisions table
promised "input layer abstracted for later touch/tilt". Issue #13 is the trigger the
non-goal anticipated: revisit it, and decide whether the phone accelerometer /
device-orientation API can drive flight.

**This spec revisits, but does not unilaterally overturn, that non-goal.** Flipping it
is an owner decision (§Open Decisions D1).

## Goal

Make the game playable and legible on a phone/tablet browser without weakening any
ground rule, and give an honest verdict on tilt-to-fly. Concretely:

- HUD + dashboard strip readable and operable on a small screen (portrait and/or
  landscape).
- Every control the keyboard has, reachable by touch.
- Tilt-to-fly evaluated for feasibility and, if viable, specified as an **opt-in** mode
  layered on top of touch — never the only way in.
- No new runtime dependency without owner approval (CLAUDE.md rule 3).

## Ground rules carried from the project (binding)

- **The only synthesized object is the player's aircraft** (CLAUDE.md #1). Touch and
  tilt are *player-aircraft input*; they never touch feed data. Live contacts stay real
  or absent, unknown fields stay em-dash (—), feeds-down stays an explicit offline state.
  Nothing in this spec adds a synthesized contact or a "demo" feed to make a small screen
  look busy.
- **Sim state stays unmistakable** (CLAUDE.md #2): the `SIM` banner, amber SIM accent,
  `SIM-<hex>` callsign, and the live ghost of the genuine aircraft all render on mobile
  exactly as on desktop. A smaller screen shrinks them; it never drops them. If the HUD
  must shed elements to fit (§2), the SIM banner and the honest feed-status indicator are
  the **last** things dropped, never the first.
- **Ask before adding any dependency** (CLAUDE.md #3, spec §14). See §5 — the recommended
  path needs none; anything beyond it is an Open Decision.
- **Boring, legible code; one codebase.** No parallel mobile fork to drift out of sync
  (rules out approach (c) below). Responsive CSS + one conditional input source.
- **LORAN visual language holds on mobile**: near-black, amber warnings/SIM, cyan nominal
  data, monospace, 1px borders, bracket corners, no radius > 2px, no shadows. Touch
  affordances are instrumentation, not app-store chrome — no rounded pill buttons, no
  drop shadows, no material ripples.

---

## 1. Feasibility of accelerometer / tilt control

### 1.1 What the APIs actually give you

| API | Provides | Use for flight |
|---|---|---|
| `DeviceOrientationEvent` | `alpha` (0–360°, yaw/compass around screen-normal), `beta` (−180…180°, front-back tilt), `gamma` (−90…90°, left-right tilt) | **beta → pitch, gamma → roll.** The natural, low-latency mapping. |
| `DeviceMotionEvent` | `accelerationIncludingGravity` (m/s²), `rotationRate` (deg/s) | Worse fit: acceleration is noisy and gravity-contaminated; `rotationRate` is a *rate* that must be integrated and drifts. Not recommended as the primary tilt source. |

The usable signal is **`DeviceOrientationEvent` `beta`/`gamma`** — absolute tilt angles
derived from the accelerometer + gyro fusion the OS already does. `alpha` is unreliable
without an absolute-orientation sensor and magnetometer calibration, so **do not** use it
for yaw/rudder.

### 1.2 The hard requirements and gotchas (all verified against the platform, not a device)

1. **iOS 13+ permission gesture.** `DeviceOrientationEvent.requestPermission()` returns a
   promise (`"granted"`/`"denied"`) and **must be called from inside a user gesture**
   (a tap handler). It cannot be requested silently on load. On iOS the user must also
   have Safari's "Motion & Orientation Access" enabled at the OS level, which we cannot
   detect or fix — only message honestly if denied. Android Chrome does not prompt (it
   gates via Permissions-Policy) but still requires the events be same-origin/secure.
2. **HTTPS / secure context, always.** Device-orientation events **do not fire outside a
   secure context.** `localhost` counts as secure; a phone hitting `http://<lan-ip>:5173`
   over the LAN **does not** — the events silently never arrive. This collides directly
   with the self-hosting story (§Open Decision D2): touch works over plain HTTP, tilt does
   not.
3. **Screen-orientation axis remap.** `beta`/`gamma` are defined relative to the *device's*
   natural orientation, not the *screen's*. When the player rotates to landscape (the
   expected flight-sim grip), the physical tilt axes rotate 90° relative to what they see.
   The handler must read `screen.orientation.angle` and swap/negate beta↔gamma accordingly,
   or roll and pitch come out transposed in landscape. This is solvable but is real code,
   not a one-liner.
4. **Neutral-attitude / calibration problem.** Players hold a phone at an arbitrary,
   comfortable angle (commonly 45–70° of beta), not flat. Raw beta/gamma cannot map
   directly to stick deflection or the aircraft pitches down the moment you pick it up.
   Required: capture a **zero reference** on a "calibrate / center" tap, then feed
   *deviation from that reference* into the control axes. Provide a re-center control,
   because grip drifts over a flight.
5. **Latency & jitter.** Events fire at ~60 Hz on most hardware (throttled), so latency is
   acceptable for a stable-jet/GA sim (not for a twitch FBW fighter — and we don't have
   one: the fighter is a stable F-5/T-38 with no FLCS path, per CLAUDE.md). Raw signal is
   noisy: a small **deadzone around center + a low-pass filter (EMA)** are mandatory or
   the aircraft hunts. These are a few lines in the tilt source, no dependency.
6. **What tilt cannot do.** Tilt gives you at most two comfortable analog axes (pitch,
   roll). It cannot sanely provide throttle, rudder, flaps, gear, afterburner,
   take-controls, pause, or free-look. Those **must** come from touch regardless (§3), so
   tilt is never a complete control scheme on its own.

### 1.3 How tilt maps onto the existing control model

The physics consumes a `ControlVector` (`sim/types.ts`): `pitch`/`roll`/`yaw` ∈ [−1,1],
`throttle` ∈ [0,1], plus `flapDetent`, `trim`, `gearDown`, `afterburner`. The flight loop
(`game/flightLoop.ts`) samples input **once per physics tick** via the control sampler
(`input/controls.ts`), whose current seam is `heldKeys: ReadonlySet<string>`.

**Critical seam observation.** The founding decision said "input layer abstracted for
later touch/tilt," but the *implemented* seam is a **digital** held-key set fed through a
**sprung** sampler (`stepAxis` ramps a held key toward ±1 and self-centers on release).
That is correct for a keyboard and *wrong* for an analog source: tilt (and a virtual
analog stick) produce a **continuous target deflection**, which the spring would fight and
distort. So tilt needs the seam widened, not just a new caller. See §6 for the two ways to
do that and the recommendation.

Mapping, once an analog path exists: `pitch = clamp((beta − betaZero)/betaRange, −1, 1)`
and `roll = clamp((gamma − gammaZero)/gammaRange, −1, 1)`, after deadzone + EMA, with
`betaRange`/`gammaRange` tunable sensitivity (~25–35° to full deflection is a sane start;
owner-tunable). Sign matches the existing convention (`pitch` positive = nose up).

### 1.4 Verdict

**Viable as an opt-in secondary control mode; NOT viable as the primary or sole control.**

Reasoning: the beta/gamma → pitch/roll mapping is genuinely good and low-latency for the
stable aircraft this sim models, and calibration/filtering are cheap and dependency-free.
But the iOS permission gesture, the hard HTTPS requirement (which fights self-hosting over
LAN HTTP), the landscape axis remap, the calibration burden, and the fact that tilt covers
only 2 of ~10 controls mean it cannot be the baseline. The honest baseline is on-screen
**touch**, which works over plain HTTP with no permission prompt; tilt rides on top for
players who opt in, calibrate, and are on an HTTPS instance.

---

## 2. Responsive layout

Target the existing screens without a second codebase. Tailwind (already approved,
layout-only) plus the hand-written CSS tokens carry the responsive work; the LORAN look is
unchanged, only reflowed.

### 2.1 Browse screen (`App.tsx`)

Desktop is a flex row: globe + a fixed `w-80` `ContactList` sidebar. On a narrow viewport:

- Collapse the contact list from a persistent sidebar into a **bottom sheet / drawer**
  toggled by a `CONTACTS [n]` chip in the status bar (n = live count). The globe gets the
  full viewport; picking a contact on the globe or in the drawer opens the same
  take-controls affordance.
- `StatusBar` stays pinned (it carries the honest feed-status + attribution — non-
  negotiable, §honest rules). It may wrap to two lines on the narrowest widths rather than
  truncate the feed source or attribution.

### 2.2 HUD (`hud/Hud.tsx`)

The HUD is six positioned clusters (banner, left readouts, right readouts, heading,
bottom control line, warnings) + attribution. It already uses `position: absolute` corner
anchoring, which reflows naturally. On small screens:

- **Keep always:** SIM banner (top), the warnings cluster, heading, and the attribution
  line. These encode the honesty + SIM-unmistakable rules and safety-of-flight; they never
  drop.
- **Shrink:** readout font via a `clamp()` token; tighten `hud-readout` gaps.
- **Demote on the narrowest portrait:** the four-item left/right readout stacks can drop to
  the two highest-value each (left: IAS, AOA; right: ALT, AGL) with the rest available by
  tapping the instruments panel. This is a *layout* decision, flagged for the owner
  (D6) — it is the only place mobile removes information, and it removes it from the
  glance-HUD only, never from the data.
- Touch targets: any HUD element that becomes tappable gets a ≥44×44 px hit area (Apple
  HIG / WCAG target-size floor), even if the ink is smaller, using transparent padding so
  the LORAN 1px-border look is preserved.

### 2.3 Dashboard strip (`dashboard/DashboardStrip.tsx`)

Already the most mobile-ready piece: four independently foldable panels (INSTRUMENTS,
RADAR, WEATHER, CONTROLS) + a whole-strip fold, all local `useState`, no store coupling.
On mobile:

- Default the strip **folded** (`open: false`) in FLYING so the small screen is flying-
  first; the existing `COCKPIT [C]` chip reopens it. Tapping the chip replaces the `[C]`
  keyboard hint.
- When open on a narrow screen, the four panels stack vertically as an overlay sheet
  rather than a bottom strip, or become a horizontal swipe carousel — layout choice for
  the implementer, both preserve the `PanelFrame` chrome.
- Panel fold/unfold toggles are already buttons (`PanelFrame` `onToggle`), so they are
  touch-ready; just enforce the 44 px target.

### 2.4 Orientation

**Recommend landscape-first, portrait-tolerant.** A first-person flight sim wants the wide
axis. Simplest honest behavior: full support in **landscape**; in **portrait** show a
non-blocking "ROTATE TO LANDSCAPE" instrumentation card over the globe (LORAN style) while
still rendering. Full portrait flight layout is a larger effort and is an Open Decision
(D4).

---

## 3. Touch controls

Everything tilt cannot cover, and the whole scheme when tilt is off. On-screen, LORAN-
styled (1px borders, monospace labels, amber/cyan, translucent). Sketch (landscape):

```
 ┌ SIM  C172  SIM-a1b2 ──────────────────────── HDG 087 ┐
 │ IAS ..   ALT ..                                        │
 │ AOA ..   AGL ..                                        │
 │                                                        │
 │  ╔═══════╗                              ▲  THR ▓▓▓░░   │   left thumb: virtual stick (pitch/roll)
 │  ║   ·   ║  <- stick                    │  85%          │   right edge: throttle slider (drag)
 │  ╚═══════╝                              ▼               │
 │  [RDR][A] [FLP-][FLP+] [GEAR] [AB]        [LVL] [❙❙]    │   button row: rudder L/R, flaps, gear, AB, level, pause
 └────────────── Esri · Re:Earth Terrain ────────────────┘
```

- **Virtual stick (left thumb):** an analog pad → `pitch`/`roll` targets, continuous. This
  is the touch baseline for the two axes tilt would otherwise own; when tilt is enabled it
  can hide or stay as a fallback (D3).
- **Throttle (right edge):** a vertical drag slider → `throttle` [0,1] absolute (not
  sprung — throttle is a lever, matching `controls.ts`).
- **Rudder:** two hold-buttons (`[A]`/`[D]` equivalent) → `yaw`, OR omit and auto-
  coordinate on mobile (D7). Rudder is the least-used axis and the most awkward on touch.
- **Flaps −/+**, **Gear**, **Afterburner (dry/wet)**: discrete tap buttons; flaps/gear/AB
  are edge-triggered in the sampler already, so a tap = one detent / one toggle. Gear
  button is inert (shown disabled) on fixed-gear aircraft, matching `KeyG` behavior.
- **Return-to-level [LVL]** and **Pause [❙❙]**: tap buttons mapping to the existing
  `KeyL` assist and pause.
- **Take controls** (browse) and **Resume** (paused) become large primary tap targets;
  Resume already needs a canvas click/tap per spec §6, which a touch tap satisfies.
- **Free-look:** desktop uses hold-`KeyQ` + pointer-lock (`FlightSession`). Pointer-lock
  is meaningless on touch; replace with a **two-finger drag** on the canvas to glance,
  releasing to re-center — or defer free-look on mobile (D6). Do not try to reuse
  pointer-lock.

All touch buttons use Pointer Events (`pointerdown`/`pointerup`), not click, for latency,
and `touch-action: none` on the flight surfaces so the browser doesn't steal drags for
scroll/zoom.

---

## 4. Honest-data + SIM rules on mobile (confirmation)

Nothing in this spec weakens any rule. Explicitly:

- **Only the player aircraft is synthesized.** Touch/tilt are input to that one aircraft;
  no feed data is mocked to fill a small screen. If the contact list is empty on mobile it
  shows the same honest "no contacts / feed offline" state as desktop.
- **SIM unmistakable:** banner, amber accent, `SIM-<hex>` callsign, and the live ghost all
  render on mobile; they are the last HUD elements dropped under space pressure, never the
  first (§2.2).
- **Unknown → em-dash (—)** unchanged; the formatters (`hud/format.ts`) are shared, not
  reimplemented for mobile.
- **Feeds real-or-absent / attribution shown:** `StatusBar` (browse) and the HUD
  attribution line (flight) stay pinned on every mobile layout. Esri + Re:Earth
  attribution is mandatory and survives every breakpoint.

---

## 5. Dependencies

**The recommended path (approach (b), §6) needs NO new dependency.**

- Tilt: native `DeviceOrientationEvent` — no library.
- Touch: native Pointer Events + CSS — no library.
- Responsive: Tailwind (already approved, layout-only) + existing CSS tokens.
- Calibration, deadzone, EMA filter, axis-remap: a few lines of plain TS in a new input
  source module.

Per CLAUDE.md rule 3, **any** addition beyond the approved list (§14) needs owner
approval, so if the implementer later wants a gesture/gamepad/virtual-joystick library
(e.g. `nipplejs`) that is an **Open Decision (D5)**, not an assumption. The recommendation
is to write the virtual stick by hand (it is small, and hand-rolled matches the "boring,
legible, DBA-owner" rule and the existing hand-written gauges/annunciators).

---

## 6. Approaches & recommendation

### (a) Responsive CSS + on-screen touch only; tilt deferred
Responsive layout (§2) + touch controls (§3). Works over plain HTTP, no permission
prompts, no HTTPS requirement, every device. Smallest, safest, fully honest.
*Trade-off:* leaves the headline question of #13 (tilt) unanswered in shipped code —
though it answers it in *design*.

### (b) Responsive + touch baseline + tilt-to-fly as an opt-in mode  ★ RECOMMENDED
(a), plus an opt-in "TILT" toggle that runs the iOS permission gesture, a calibrate/center
step, and maps beta/gamma → pitch/roll on top of the touch baseline. Touch remains the
always-available fallback (throttle, rudder, buttons are touch regardless). No new
dependency.
*Trade-off:* tilt only functions on HTTPS instances (D2) and iOS needs the permission
grant; both are handled honestly (the toggle self-disables with a plain message when the
secure context or permission is absent). More work than (a), but it is the direct,
complete answer to #13.

### (c) Separate mobile route / entry (`/m`, or device-detect redirect)
A distinct mobile build/layout tree.
*Trade-off:* duplicates UI, drifts out of sync, doubles the honesty/SIM-rule surface to
audit, and contradicts "one codebase, boring, legible." **Rejected.**

**Recommendation: (b), delivered as the sub-features in §7 in order** — ship (a)'s content
first (responsive + touch = flyable on mobile), then add tilt. This de-risks: the game is
mobile-playable after sub-feature 2 even if tilt (sub-feature 3) is deferred or an owner
says no to the HTTPS requirement.

**Input-seam decision (needed for 2 and 3).** Two ways to widen the digital held-key seam
(§1.3) for analog input:

- **Option A — synthesize key codes.** Touch buttons add/remove codes in the existing held
  set. *Rejected for the analog axes:* a virtual stick and tilt are continuous, and the
  sprung digital sampler cannot represent a partial held deflection. (Fine for the discrete
  buttons — flaps/gear/AB/level/pause can synthesize their codes and reuse the existing
  edge-detection unchanged.)
- **Option B — add an analog axis source.** Extend the flight-loop input seam to accept an
  optional analog provider that supplies `pitch`/`roll`/`throttle`/`yaw` targets directly,
  bypassing `stepAxis`'s spring for whichever axes it drives; the keyboard keeps its
  digital sprung path untouched. This is what "input layer abstracted for touch/tilt"
  actually requires. **Recommended:** discrete controls via Option A (reuse edge-detection),
  continuous axes via Option B. Keep `sim/` and the sampler's keyboard behavior unchanged;
  the new code is one input-source module + a small seam widening in `flightLoop`/
  `FlightSession`.

---

## 7. Scope decomposition (sequential sub-features)

Too big for one implementation plan. Split, each its own TDD plan + commit + stop-for-
sign-off (CLAUDE.md #5):

1. **Responsive layout.** Breakpoints, browse drawer, HUD reflow/clamp, dashboard folded-
   first + stacked panels, landscape-first with portrait "rotate" card. Viewport meta / PWA
   basics. No input change — desktop unaffected. *~2–4 days.*
2. **Touch input source.** Virtual analog stick (pitch/roll) + throttle slider + discrete
   buttons (flaps/gear/AB/level/pause) + take-controls/resume tap targets, wired via the
   §6 seam (Option A discrete + Option B analog). After this, **the game is flyable on a
   phone with no tilt and no HTTPS.** *~3–5 days incl. the seam widening + tests.*
3. **Tilt-to-fly opt-in.** TILT toggle, iOS `requestPermission()` gesture, secure-context
   guard with honest disable message, calibrate/center flow, deadzone + EMA + landscape
   axis-remap, beta/gamma → pitch/roll through the Option B analog path. *~3–5 days;
   needs a real iPhone AND a real Android device to tune — cannot be finished on desktop.*
4. **Mobile performance hardening.** Cesium runs `requestRenderMode: false` (continuous
   60 Hz — the documented anti-case for render-on-demand, but brutal on a mobile GPU/
   battery). Tune `resolutionScale` / cap `devicePixelRatio`, `maximumScreenSpaceError`,
   contact/label counts for mobile. **Cannot be specified precisely without device
   profiling** — this sub-feature is measurement-first. *Size unknown until measured.*

Sub-features 1–2 are the mobile-playable milestone. 3 is the #13 headline. 4 may need to
interleave with 1–2 if early device tests show the viewer is unusable before then.

---

## 8. Open decisions for the owner

- **D1 — Overturn the non-goal?** §12 of the founding spec lists "mobile controls
  (interface reserved)" as a v1 non-goal. Confirm mobile is now in scope, and where it
  lands: a new **Phase F**, or folded into **Phase E (polish)**? (Recommend its own phase;
  it is not polish.)
- **D2 — HTTPS for self-hosters (tilt-blocking).** Tilt needs a secure context; a phone on
  LAN HTTP won't get it. Are we willing to **document/require HTTPS** for mobile tilt
  (Caddy/Traefik auto-TLS, or Tailscale/`*.ts.net`), and have the TILT toggle self-disable
  with an honest message otherwise? Touch is unaffected either way. *(Blocks sub-feature 3
  usefulness, not sub-features 1–2.)*
- **D3 — Tilt primary vs opt-in + stick fallback.** Recommendation: touch is baseline,
  tilt opt-in, virtual stick stays as fallback even when tilt is on. Confirm.
- **D4 — Portrait support?** Recommend landscape-first + portrait "rotate" prompt. Full
  portrait flight layout is extra work — approve deferring it?
- **D5 — Any new dependency?** Recommendation: none (hand-roll the virtual stick). Confirm
  you don't want a joystick/gesture lib (`nipplejs` etc.) — adding one needs your approval
  per rule 3.
- **D6 — HUD demotion + free-look on mobile.** OK to demote the least-critical glance-HUD
  readouts on the narrowest screens (data still in the panel, §2.2)? And: implement two-
  finger-drag free-look on touch, or defer free-look on mobile entirely?
- **D7 — Rudder on touch.** Give rudder its own two touch buttons, auto-coordinate turns
  on mobile, or omit rudder on mobile? (Least-used axis, most awkward on a thumb.)
- **D8 — Target devices / perf floor.** What is the minimum device we commit to (e.g.
  "iPhone 12 / mid-range 2022 Android")? Sub-feature 4 can't set real budgets without it,
  and none of the GPU/battery/thermal behavior of Cesium-continuous-render on mobile can
  be verified without hands on those devices.

## 9. Uncertainty / cannot-verify-without-a-device

- **Cesium mobile GPU/battery/thermal performance is unverified.** Continuous-render + Esri
  imagery + terrain is demanding; whether a target phone holds 60 Hz (or 30) without
  thermal throttling is unknown until profiled on real hardware (D8, sub-feature 4).
- **Tilt tuning numbers** (deadzone width, EMA constant, beta/gamma sensitivity ranges,
  comfortable neutral) are first-guesses; they need on-device feel testing on both iOS and
  Android (sub-feature 3).
- **iOS Safari specifics** (permission UX, the OS "Motion & Orientation Access" toggle,
  landscape axis behavior) are stated from the platform contract, not confirmed on a
  current iOS build in this session.

## Owner decisions (2026-08-07)

Resolved by the owner during review of this draft:

- **D1 — Phasing:** FOLD INTO PHASE E (no new Phase F). Mobile is polish-tier work sequenced within Phase E.
- **D2 — HTTPS for tilt:** YES, contingent on effort — which is LOW. The public deploy (adsb.voygent.app) is already served over TLS by the reverse proxy, so `DeviceOrientationEvent` permission + events work there with no new code. Bare-metal LAN self-host over plain HTTP is the only gap: handle it with (a) a documented "enable TLS (Caddy/Traefik/Tailscale) for tilt" note in the README, and (b) the tilt toggle detecting an insecure context and self-disabling honestly with an on-screen reason. Do NOT block the touch baseline on any of this.
- **D5 / best-experience:** Owner is "open to the best mobile experience practical." Interpretation: do not hand-roll a worse virtual stick purely to avoid a dependency — pick whatever gives the best practical touch UX. The ask-before-deps rule (CLAUDE.md #3) still stands, so if a small, well-maintained control library (e.g. nipplejs) clearly beats a hand-rolled stick, propose it explicitly for approval at plan time rather than adding it silently; if hand-rolled is genuinely as good, prefer zero-dep. Decide at plan time with a concrete comparison.
- **D4 / D7 / D8 (portrait-vs-landscape, rudder-on-touch, target device/perf floor):** defer to plan time under the same "best practical experience" guidance; D8 perf floor still measurement-first (sub-feature 4).

Status remains draft until the plan is written, but these answers unblock spec→plan.
