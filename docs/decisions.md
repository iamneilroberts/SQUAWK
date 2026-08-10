# Decisions

Dated log of non-obvious calls. Newest last.

## 2026-07-27 — G-001 · Founding decisions (owner, brainstorm session)

Recorded in full in the spec (`docs/superpowers/specs/2026-07-27-adsb-game-design.md`, §1):
separate repo from LORAN; free-flight-until-impact session arc; simplified 6-DOF with
per-class parameter files; desktop controls only in v1; terrain collision everywhere +
buildings in a ~25 km bubble; Re:Earth terrain; Overture-PMTiles-first buildings; own
FastAPI proxy with the normalizer copied from LORAN.

## 2026-07-27 — G-002 · Fighter class is F-5/T-38-style, not F-16 (owner)

The F-16 is statically unstable and only flyable through its FLCS; modeling it honestly
requires a closed-loop control layer — the sole per-class code branch in the design. Owner
chose an easier model: a conventionally stable fighter (F-5E/T-38 class), same direct 6-DOF
path as the other classes, afterburner as a plain dry/wet thrust toggle, limits as clamps.
Real F-16s selected on the browse screen still map to this archetype; the parameter file
says so honestly. Consequence: the sim core is purely data-driven — no per-class branches.

## 2026-07-27 — G-003 · Ellipsoidal-height terrain so collision compares like with like

Re:Earth Terrain serves quantized-mesh with **ellipsoidal** heights (Mapterhorn DEM +
EGM2008 geoid applied). ADS-B `alt_geom` is WGS84-ellipsoidal too, so spawn altitude and
ground height share a datum with no geoid fudge. Keyless and free, but best-effort with no
SLA — the fallback (Cesium ion free tier, token, non-commercial terms) is documented and
the terrain provider sits behind one module so swapping is one file.

## 2026-07-27 — G-005 · Feed env vars are full URL templates, not bases

Upstream path shapes differ per feed (airplanes.live `/point/…`, adsb.lol + adsb.fi
`/lat/…/lon/…/dist/…`, per LORAN recon), so a single base+path convention cannot express
real failover. `FEED_PRIMARY`/`FEED_FALLBACK`/`FEED_RESERVE` are now full URL templates
with `{lat}`/`{lon}`/`{radius}` placeholders, formatted per call — this keeps feeds
swappable via `.env` without a code change.

## 2026-07-27 — G-006 · Default ports: backend 8020, compose frontend 8021

The plan's port defaults (backend `:8010`, compose frontend `:8080`) were chosen unaware of
this homelab box's reality: `:8010` is LORAN's deployed production backend (fronted by the
`cloudflared-loran` systemd tunnel) and `:8080` is occupied by an unrelated long-running
Docker container. Colliding defaults would break the bare-metal dev path and could point
this game's frontend at LORAN's live API instead of its own. Moved the backend default to
`8020` (`ADSB_GAME_PORT` in `backend/app/config.py` and `.env.example`, and the dev-proxy
target in `frontend/vite.config.ts`); `8021` is reserved for the compose frontend port and
takes effect when Task 9 lands docker-compose.yml. Both verified free on this box. Ports
remain `.env`-overridable — this only changes the defaults.

## 2026-07-27 — G-004 · Cesium static assets copied at build time, not committed

LORAN commits ~430 asset files; adsb-game copies from `node_modules` in `predev`/`prebuild`
instead, keeping the public repo lean. Trade-off: `npm install` required before first run
(true anyway).

## 2026-08-05 — Phase A known limitations (final whole-branch review triage)

The final whole-branch review approved Phase A with three ~1-line robustness/hygiene fixes
applied and tested: malformed-template failover (`adsb.py`), non-dict feed row skip
(`normalize`), and an adsbdb hex whitelist (`adsbdb.py`). The following are consciously
deferred as documented Phase-A limitations, not defects:

- **No keyboard selection of contact rows** (`frontend/src/panels/ContactList.tsx`) — rows
  are click-only, consistent with Cesium picking; add `role`/`tabIndex`/`onKeyDown` post-A.
- **No `restart:`/healthcheck in `docker-compose.yml`** — fine for manual homelab runs; add
  `restart: unless-stopped` + a `/healthz` healthcheck if/when it becomes always-on.
- **`frontend/scripts/copy-cesium-assets.sh` merges, not mirrors** — stale assets could
  linger on a Cesium version bump; `rm -rf` the target dirs before copy at that time.
- **Stale contacts stay rendered on OFFLINE** — billboards freeze at last-good positions
  while the status chip honestly reads STALE/OFFLINE (data is real, just old; this is
  deliberate anti-flicker). Revisit clearing/dimming on sustained OFFLINE if it misleads.
- **Port override only works on the bare-metal path.** `scripts/dev.sh` + `vite.config.ts`
  honor `ADSB_GAME_PORT`; the Docker path (backend image, `nginx.conf`, `docker-compose.yml`)
  hardcodes backend `8020` / published `8021`, so `.env` does not change the compose ports.
  A bare `npm run dev` (bypassing `dev.sh`) leaves the proxy on the `:8020` fallback.
- Backend cache/lock micro-races (cache read outside the lock, no `_cache` eviction) are
  unreachable in practice: one fixed home/radius key plus the frontend in-flight guard.

## 2026-08-05 — Phase B owner decisions (B-1..B-5): merged "first flyable", C172-only, GA-only takeover

Owner decisions at Phase B brainstorm, recorded in
`docs/superpowers/specs/2026-08-05-phase-b-first-flyable-design.md` §1:

- **B-1** Spec §11's B/C split is merged into one "first flyable" phase (sim core AND
  terrain/FPV/HUD/handoff/collision together). Owner chose seeing it fly over the
  headless-first split.
- **B-2** C172S GA piston is the only class this phase; airliner/fighter params and the
  F-5E/T-38 source-verification are future enhancements.
- **B-3** Takeover restricted to GA-class contacts (feed `t` vs a GA-piston designator
  data list; military excluded). Airliners etc. are future. A disclosed envelope clamp in
  `buildSpawnState` remains as a safety net — silent clamping is banned.
- **B-4** Minimal ghost ships now (ground rule 2 honored literally), with honest
  staleness labels.
- **B-5** End card allows orbiting the impact site (not a hard freeze-frame).

An Opus 4.8 feasibility review (same date) surfaced 9 red flags — spawn-vs-envelope,
terrain-not-resident-at-spawn, backgrounded-tab dt, ENU-frame drift, Esc/pointer-lock,
Viewer/polling ownership, selection nulling, height-0 contacts under real terrain,
snapshot gating — all folded into the spec as requirements rather than left to
implementation discretion.

## 2026-08-05 — B-006 · C172S parameters are tuned at typical operating mass, not max gross

The POH quotes Vs1 48 / Vs0 40 KIAS at max gross (1157 kg), but reproducing those at max
gross needs CLmax ≈ 1.85 — well outside the sourced 1.47–1.58 range. Rather than invent a
wing, `params/c172.json` uses the sourced typical operating mass (950 kg, research doc
range 950–1050) with a sourced CLmax of 1.533, which lands Vs1 at 48.1 kt and Vs0 at
41.8 kt against the book numbers. The trade is stated in `sources.massKg` in the file
itself. Two knobs carry the rest of the tuning and are labelled TUNING KNOB in `sources`:
`cd0` 0.032 → 0.035 (cruise lands at ~123 kt TAS inside the POH's 122–124 kt band) and
`propPeakSpeedMs` (a linear prop-efficiency ramp below 60 m/s, which both caps static
thrust and brings sea-level climb from ~1570 fpm to ~740 fpm vs the POH's 730 fpm — a
constant-efficiency `T = ηP/V` model is wildly optimistic in the climb).

## 2026-08-05 — B-007 · Rate-command moments, exact-exponential attitude, semi-implicit Euler

Three modelling calls that shape everything downstream:

**Moments are rate-command-with-lag, not coefficient moments.** `docs/research/
aero-parameters.md` gives a max roll rate for the C172 but no Cl_p, Cl_delta_a, Cm_q or
Cm_alpha — writing a derivative-coefficient moment model would mean inventing numbers and
presenting them as physics. Instead `sim/forces.ts` commands a body rate proportional to
stick and dynamic-pressure authority and lets a per-axis damping constant pull the actual
rate toward it, plus a static pitch stiffness toward the trimmed AoA (so elevator trim sets
speed, as it does in the real aircraft) and a weathercock term in yaw. Every constant is
named and marked TUNING KNOB in `params/c172.json` `sources`. Consequence to accept: the
model has no inertia coupling and no adverse yaw.

**Semi-implicit Euler at 60 Hz for the translational state, not RK2/RK4.** The fastest mode
in the model (pitch short period, omega_n ≈ 1.7 rad/s) is three orders of magnitude below
the sample rate, so the integrator is not the accuracy bottleneck; semi-implicit Euler costs
one force evaluation per step instead of two or four and does not pump energy into
oscillatory modes. Rationale is repeated in the header of `sim/aircraft.ts` where a reader
will actually meet it.

**Attitude uses the exact exponential map, not the first-order quaternion update.** The
plan specified `q' = q + 0.5*q⊗ω*dt`, which under-rotates by theta^3/12 per step: harmless
for the 172 (40 deg/s costs ~8e-6 rad/s) but 0.33 deg of lost roll over one 360 deg/s
aerobatic roll, and worse again for the fighter class's roll rates — the plan's own
"a full 360 deg roll returns to the starting attitude" test fails against it at 3 decimal
places. `sim/quat.ts` therefore builds the per-step delta quaternion from axis-angle
(`q' = q ⊗ exp(0.5*ω*dt)`), which is exact for a rate held constant across a step, for the
cost of one sin/cos. The per-step renormalize stays, as float-round-off insurance.

**Earth rotation is ignored** — no Coriolis, no transport rate, documented in
`sim/geo.ts`. Gravity is taken along `geodeticSurfaceNormal`, not radially (spec §5).

**The g clamp solves for lift rather than scaling it** (added in review). Capping n by
`lift *= limit/n` leaves the clamp leaky, because drag's share of the normal force
(`drag*sin(alpha)`) is not scaled with it: the model reported 3.80 g while the force it
returned carried 3.82, and -1.52 against a real -1.55. `sim/forces.ts` instead solves
`lift = (limit*W - drag*sin(alpha))/cos(alpha)` and then recomputes `loadFactor` from the
forces that actually leave the function, so the HUD's G readout can never drift from them.
Drag is deliberately not scaled — you cannot wish drag away by pulling less.

## 2026-08-05 — B-008 · C172S tuning knobs and how the envelope is defended

`frontend/src/sim/envelope.test.ts` is the contract for the flight model: 75% power at
8000 ft cruises at 122 kt TAS ±5, Vs1 48 KCAS ±3, Vs0 40 KCAS ±3, sea-level top speed near
the POH's 126 kt Vh, sea-level climb near 730 fpm, and a service ceiling where climb has
almost but not quite died. Speeds are found by bisection on the force balance and by a trim
search through the real integrator, so the test proves the model produces the number rather
than that someone typed it twice.

Three knobs carry the tuning and are marked TUNING KNOB in `params/c172.json` `sources`:
`aero.cd0` (cruise/top speed), `propulsion.propPeakSpeedMs` (climb, without disturbing
cruise), and `aero.stallAlphaRad` + `flaps[].dCL0` (stall speeds). **No knob had to move to
go green** — the Task 1 values already landed inside every band once the power lapse below
existed. Measured, with the bands in brackets: cruise 8000 ft 75% = 123.4 kt TAS [117–127],
sea-level Vh = 128.1 kt TAS [118–134], Vs1 = 48.1 KCAS [45–51], Vs0 = 40.4 KCAS [37–43],
CLmax clean = 1.533 [1.47–1.58], sea-level best climb = 783 fpm [630–830], climb at the
14000 ft ceiling = 210 fpm [0–300]. The `sources` strings for `propPeakSpeedMs` and `flaps`
were stale (they quoted ~740 fpm and a flaps-30 CLmax of 2.03 / Vs0 41.8 kt against the real
783 fpm and 2.176 / 40.4 kt) and were corrected to the measured values in the same pass.

Two model additions came out of writing the suite:
- **Piston power lapses with density altitude** (Gagg-Ferrar, `pistonPowerLapse`). Without
  it the aircraft climbs at 971 fpm at its published ceiling — no ceiling at all. A
  consequence worth knowing: "75% power at 8000 ft" means 75% of *rated* power, which at
  8000 ft needs 99.0% throttle — the suite asserts that it is still achievable, as the POH
  implies. `thrustNewtons` therefore takes an `altitudeM` argument.
- **Vne is warn-only, not clamped.** The parent spec says limits are "clamps + HUD
  warnings"; for g that means an actual force clamp, but clamping airspeed would mean an
  invisible hand holding the aircraft back in a dive. Vne is left to the Phase C HUD as a
  warning, and the suite asserts level flight at full power cannot reach it, so the only way
  past Vne is a deliberate dive.

**The +3.8 g clamp case enters at 170 kt TAS, not the 140 kt the plan brief assumed.** The
elevator is a rate command capped at `pitchRateMaxRadS` = 20 deg/s, so the load factor a
pull can reach is bounded by roughly `1 + V*q/g`: measured 3.31 g from 140 kt, 3.80 g (the
clamp) from about 165 kt up. That is the rate-command elevator being self-consistent, not
the clamp failing, so the entry speed moved rather than the assertion being softened — 170
kt TAS at 2000 m is 154 KIAS, still inside Vne. The case now also asserts the clamp is
reached *exactly* (`toBeCloseTo(3.8)`), mirroring the negative-g case, so it cannot pass by
merely never exceeding the limit.

**The density-altitude lapse is selected by data, not applied to everyone** (added in
review). `thrustNewtons` first applied the piston lapse unconditionally, which buries a
light-single assumption in a core that is supposed to be class-agnostic — the airliner's
flat-rated turbofan would then have needed a per-class branch or a retrofit. `propulsion`
now carries `lapseModel` (`"piston"` | `"none"`), `forces.ts` looks the curve up in
`POWER_LAPSE_MODELS`, and `validateClassParams` **rejects an absent or unknown value at load
time rather than defaulting**: defaulting to `"none"` would silently flat-rate a piston
engine and defaulting to `"piston"` would re-bury the same assumption, and either way a typo
in a parameter file would quietly turn one engine into another. The C172 keeps the identical
Gagg-Ferrar curve and the envelope suite is unchanged.

## 2026-08-05 — B-009 · Keyboard-only stick this phase; mouse stick deferred

Parent spec §8 lists a mouse stick (hold-LMB or pointer-lock) alongside the arrow keys.
Phase B ships keyboard only. Two reasons: the Phase B spec's own acceptance (§9) says "fly
the C172 by keyboard"; and pointer lock collides head-on with the Esc-is-pause decision
(spec §6) — Esc always exits pointer lock, and Chrome rate-limits re-locking, so a
mouse-stick build would either fight the pause key or need a second re-entry gesture. The
`ControlVector` interface is unchanged and mouse/touch/tilt still implement it later.

Two keys are Phase B additions to the §8 table, both recorded in `input/controls.ts`
`KEYMAP` and the README: `Comma`/`Period` for nose-down/nose-up elevator trim (spec §5
requires two trim keys but does not name them), and `Escape` reassigned from "quit to
browse" to "pause overlay" per spec §6 — QUIT is a button inside that overlay.

## 2026-08-05 — B-010 · What "near-level attitude" means at touchdown

Parent spec §5 fixes two landing gates numerically (sink under 600 fpm, speed under
1.3 Vs) and leaves "near-level attitude" to implementation. `game/classify.ts` makes it:
bank within ±10°, pitch within −5°…+15°. The pitch window is deliberately asymmetric — a
nose-up flare is how a light single arrives, a nose-down arrival is a crash regardless of
how slowly it was going. Both bounds are inclusive; the sink and speed gates are strictly
less-than, so exactly 600 fpm and exactly 1.3 Vs read CRASHED. Every one of those
boundaries is pinned by a test in `game/classify.test.ts`, and Vs is taken for the flap
setting actually selected, so a full-flap touchdown is judged against 40 kt, not 48.

One test in the task-6 implementation brief's own worked example was internally
inconsistent with the actual C172 params and was corrected during implementation: full
flap lowers Vs (40 kt) below clean Vs (48 kt), so a fixed speed's ratio to the (smaller)
flap Vs is always the larger, stricter one — a speed can never read CRASHED against clean
Vs while reading LANDED against flap Vs, only the other way around. `classify.test.ts`'s
"the stall speed is flap-dependent" case now asserts the physically consistent direction
(fine clean, too fast for full flap); `classifyEnd`/`readImpact` themselves are unchanged
from the brief.

## 2026-08-05 — B-011 · Terrain fallback is Re:Earth → optional ion → labelled flat earth

G-003 named Cesium ion's free tier as the Re:Earth fallback, but ion needs a token and this
project is keyless by rule. `globe/terrainProvider.ts` resolves that: Re:Earth first; ion
only if the operator has put their own token in `VITE_CESIUM_ION_TOKEN` (their account,
their non-commercial terms); otherwise an `EllipsoidTerrainProvider` — a flat earth, said
out loud in the status bar as "TERRAIN UNAVAILABLE — FLAT ELLIPSOID" rather than quietly
letting the player fly over an invisible plain and wonder why Colorado is missing. Terrain
attaches at app start, never at takeover, because swapping providers mid-session forces a
full tile reload and jumps the camera.

Task 8 hoist (2026-08-06): the resolved note is bridged from `ViewerHost`'s bundle to
`StatusBar` via an `onTerrainNoteChange` prop through `App.tsx`, not zustand, to stay within
the plan's `mode`/`origin`/`endStats`-only cap on this phase's store additions.

## 2026-08-05 — B-012 · The flight loop talks to a FlightHost, not to a Viewer

`game/flightLoop.ts` — accumulator, collision test, pause, sim-rate metering, end
classification — is written against a three-method `FlightHost` interface (frame callback,
camera, enter/exit view). `globe/cesiumFlightHost.ts` is the ten-line Cesium implementation.
Same seam, same reason, as `world/terrain.ts`'s injected height sampler: the parts with
decisions in them get unit tests driven by a fake, and the parts that are just Cesium API
calls stay small enough to verify by flying the thing. Twenty-one flight-loop tests exist
because of this seam; none of them load Cesium.

Two behaviours that came out of writing those tests and are worth stating: RESUME clears
the frame clock rather than carrying it, so a five-minute pause does not arrive as a
clamped-and-dropped 300-second frame; and controls are sampled once per PHYSICS tick while
the camera is driven once per FRAME, so control response does not change with frame rate.

Clearing the clock costs the one frame after RESUME, which advances no physics because it
is the frame that re-establishes the reference — a visible 16 ms and the price of never
lurching. The alternative (carry the clock, since a visible tab keeps delivering frames
while PAUSED and so keeps it current) was measured against the hidden-tab case the
`visibilitychange` auto-pause exists for: with no frames delivered during the pause it
resumes with a clamped-and-dropped 0.25 s jump. `flightLoop.test.ts`'s "a pause that
delivered no frames at all" case pins the re-base and fails under that alternative.

## 2026-08-05 — B-013 · The heading readout is numeric this phase; the tape is backlogged

Parent spec §9 asks for a heading TAPE (and a VSI tape). Phase B ships three-digit numeric
readouts instead: `HDG 270`, `VSI +700`. The information content is identical and every
honesty rule still applies (000–359 with the 359.6→000 wrap, em-dash when unknown, all
pinned in `hud/format.test.ts`); what is missing is the moving-scale presentation, which is
a drawing job with no new data behind it and no bearing on whether the aeroplane flies.
Deferred to Phase E polish alongside the chase cam. Recorded here rather than left as a
silent gap between the spec and the build.

Aircraft class, the other half of spec §9's "class + synthetic callsign", **is** present:
`HudSnapshot.classLabel` carries `params.label` and the HUD renders it in the SIM banner
next to `SIM-<HEX>`.

## 2026-08-05 — B-014 · Contacts render at alt_geom only, and the ghost never fakes freshness

Two honesty calls in the takeover wiring:

**Globe contacts are placed at `alt_geom` (ellipsoidal), converted ft→m, and contacts
without `alt_geom` are not drawn on the globe at all.** Phase A drew every contact at
height 0, which was invisible under real terrain the moment Phase B attached Re:Earth.
`alt_baro` is pressure altitude — the wrong datum for a 3D position — so substituting it
would put aircraft at plausible-looking wrong heights. Those contacts still appear in the
contact list with their baro altitude, where the number is honest.

**The ghost label shows an age only when the feed is LIVE and the contact reported one.**
When the contact drops out of the feed, or the feed goes STALE/OFFLINE, it reads
`GHOST · NO DATA` rather than a frozen age that would keep looking fresh. The billboard is
dimmed to 35% alpha and stays on the globe — the real aircraft is still real.

## 2026-08-06 — B-015 · End card orbit: kept StatusBar's prop bridge; split the overlay's pointer-events

Two implementation-plan deviations in task 12, both to avoid a regression:

**`StatusBar` keeps reading `terrainNote` from the prop `App.tsx` bridges down from
`ViewerHost`** (the B-011 "Task 8 hoist" entry above), rather than switching to
`useViewer()` as the task-12 brief's own snippet suggested. `StatusBar` is rendered as a
flex *sibling* of `ViewerHost` in `App.tsx`, outside `ViewerContext.Provider`'s subtree —
`useViewer()` called there returns the context's default (`null`) forever, which would have
frozen the attribution line on `TERRAIN LOADING…` even after Re:Earth attached. The prop
path was already correct and already covers the requirement ("attribution names what
actually attached"); the fix was to fold it into the existing static Esri line rather than
add a second, broken data path.

**`.end-overlay`'s full-screen backdrop no longer takes `pointer-events: auto`.** It shared
that rule with `.pause-overlay`, which is correct for the (non-armed) pause modal but would
have swallowed every drag meant to orbit the impact/landing site — the entire point of B-1's
"end card allows orbiting" (spec §1). `.end-overlay` is now `pointer-events: none` with
`pointer-events: auto` scoped to `.end-overlay .end-card`, the same trick `PauseOverlay`'s
armed-resume state already uses to let clicks reach the canvas underneath.

## 2026-08-06 — Phase B known limitations (final whole-branch review triage)

Final review (opus, full-suite/build/typecheck verified green: frontend 404, backend 18)
approved the branch with one honesty fix applied (spawn disclosed "VERTICAL RATE — ASSUMED
LEVEL" when the feed lacks baro_rate) and a stale-comment fix. Consciously deferred, not
defects:

- **Spawn trim/throttle saturation undisclosed** (`takeover/spawn.ts`) — at the 1.3·Vs floor
  trim can clamp at ±1 and throttle at 1, so a handoff promising a trimmed aircraft may start
  slightly untrimmed/decelerating for non-C172 GA types. Add adjustments entries if it bugs.
- **Spawn grace shows AGL with collision off but no flag** (`world/terrain.ts`) — during the
  ~3 s grace `collisionArmed=false` while the HUD shows AGL and no warning. Expose
  collisionArmed in the snapshot to surface it.
- **COUNTDOWN_ABORT exists in the machine but nothing fires it** — takeover is unescapable
  for up to ~6 s (countdown + preload timeout). Esc-in-countdown is the natural trigger.
- **Heading is a numeric readout, not a tape** (B-013); **terrainPreload timeout timer**
  never cleared (one stray 3 s timer per takeover); **ContactLayer re-snaps the browse
  camera on ENDED→BROWSE** (this IS spec §6's "browse camera restored" — documented, kept).
- **Test-depth**: ghost dimming in syncBillboards, ContactList eligibility states, and
  FlightSession.tsx have no unit tests (no-jsdom convention) — covered only by the manual
  acceptance walkthrough.
- Sim-internal notes: geo pole guard dead code; aircraft.ts derived fields are pre-step vs
  post-step position (documented); rate damping not scaled by dynamic pressure (tuning
  knob); |cosα|<1e-3 g-clamp guard discontinuity (outside envelope); envelope bisection
  bracket unasserted; flapped CLmax unbounded by tests.

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

**Deviation from the task skeleton:** the tag markup lives in `dashboard/TrafficTags.tsx`, not
inside `TrafficOverlay.tsx`. Splitting the presentational half into `dashboard/` is what lets it
be tested at all (the overlay's half needs a live `Scene`), and it is what makes "thin adapter"
checkable rather than aspirational.

**Test-fixture fix:** the task brief's own `trafficProjection.test.ts` "orders tags nearest
first" case originally projected both contacts to the identical screen point via the shared
`at(x, y)` helper, which collided under `TAG_MIN_SPACING_PX` and made the declutter rule (its own
dedicated test, further down the same file) drop the far tag before ordering could be observed.
Fixed by giving the two contacts distinct screen positions in that one test; the implementation
in `trafficProjection.ts` is unchanged from the brief.

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

## 2026-08-07 — CD-009 · Airport labels ship as a committed generated extract, never a runtime fetch

`frontend/src/data/airports-world.json` is generated once by `scripts/fetch-ourairports.sh` from
OurAirports' public-domain CSV and committed. The browser never fetches it, never parses CSV, and
the labels keep working with the backend down and OurAirports unreachable. It is also the only
way to have airport labels without adding a CSV parser to the dependency list, which ground rule
3 would have required asking about.

**Filter: `large_airport` + `medium_airport` only** (5,272 records). The unfiltered large+medium
extract came to 607,159 bytes — over the 600 KB budget the schema-guard test asserts — so `name`
is additionally dropped for `medium` airports (kept for `large`). That brought it to 512,730
bytes. **Correction (2026-08-07):** the original wording here claimed `name` was kept for large
airports because "the identifier alone is less useful for a major hub" — that misdescribes the
code. `airportLabelText()` renders `iata ?? ident` for every airport regardless of size, and
`name` has zero consumers anywhere in the frontend; it is parsed into `Airport` and never read.
`name` is retained for `large` airports as data provenance only (so the field exists on the
record class most likely to need it later, e.g. a future info panel), not because rendering uses
it today. It is a candidate for dropping from `large` too if the budget gets tight again — say so
here if that happens. Adding `small_airport` and `heliport` was never on the table: ~60,000 more
records is a multi-megabyte
bundle and an unreadable label soup at every camera height a C172 actually flies at. If a future
OurAirports release pushes the file back over budget, narrow the filter further and say so here —
do not raise the assertion.

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
which have 22 tests between them. The rest is covered by the acceptance walkthrough.

## 2026-08-07 — Cockpit dashboard known limitations (final whole-branch review triage)

Final review (opus, suites/build verified live: frontend 619, backend 22) approved with a
fix wave applied: places-layer buried under CHART toggle (dep-array + ordering contract
test), PAUSED strip swallowing the armed-resume click, radar face now shows `FEED <n> NM`
when the dialed scope range exceeds the feed's polling radius, CD-009 rationale corrected.
Consciously deferred, not defects:

- **ASI face is fixed 40–180 kt** — geometrically wrong for a 737/fighter; derive per
  class when a second class lands (blocks nothing today, C172S only).
- **No test pins the L/R bank label sign**; SLIP β null case renders a trailing space —
  cosmetic/coverage gaps.
- **SLIP_BALL_SIGN handedness** is provable only in flight — acceptance checkpoint 17
  ("step on the ball").
- **Ghost vs military radar blips** differ only by opacity, which compounds with the
  offline dim — revisit if it misleads.
- **OverlayLayers dep-array wiring** can only be proven with a live Viewer (no-jsdom
  convention) — pure ordering contract is tested; runbook checkpoint 25 is the backstop.

## 2026-08-07 — CD-011 · return-to-level is a pure proportional assist over the rate-command model

The roll axis is a RATE command (`forces.ts`: `pCmd = roll * rollRateMaxRadS * authority`) with a
self-centring stick, so releasing the keys HOLDS the current bank — on a keyboard a steep bank is
unrecoverable-feeling. The KeyL leveling assist (issue #5a) does NOT snap the attitude; it engages
a pure proportional controller (`game/leveling.ts`) that commands a roll/pitch RATE proportional to
the current bank/pitch error each physics tick. Because the command shrinks as the error shrinks,
the existing rate damping makes the aeroplane EASE to level over about two seconds rather than
teleporting there (owner decision). The controller is a pure, Cesium-free function so
`leveling.test.ts` drives it through the REAL `stepAircraft` and proves a 45° bank decays to near
zero while the same scenario left alone holds its bank (broken-arm).

The loop disengages when the aircraft is genuinely SETTLED — bank inside tolerance AND body roll/
pitch rate small — not on attitude alone: attitude alone disengages at the zero-crossing of the
natural overshoot while the aircraft is still rolling through level, leaving a residual bank. A
~4 s timeout is the safety net, and any manual roll/pitch input cancels the assist immediately.
Chosen over a fresh coefficient-based autopilot because it reuses the one rate-command model the
whole sim already flies (no invented Cl_p/Cl_delta), which is the same reasoning as B-007.

## 2026-08-07 — CD-012 · re-sync refuses honestly rather than synthesizing a position

KeyR (issue #5b) re-runs the takeover against the flown ICAO's CURRENT live contact so the player
can jump back to where the genuine aeroplane actually is now. The live contact lives in the store
(updated by the poller), not in the flight loop, so the decision is made in `FlightSession` and only
a rebuilt spawn crosses into `loop.resync()`. If the genuine aircraft is stale, off the feed or
otherwise ineligible, re-sync REFUSES and says so briefly (mission-terminal, em-dash discipline) —
it does NOT invent or extrapolate a position (owner decision; honesty rule, spec §4). The refusal
reuses the takeover's own `checkEligibility` gate and its `MAX_SEEN_POS_S` freshness rule via the
pure `takeover/resync.ts`, so re-sync can never accept a contact the initial takeover would have
rejected, and the message is the gate's own honest reason string. `loop.resync()` re-creates the
control sampler at the new spawn's trim and re-bases the frame clock the same way resume()/stop()
do — the rebuild gap is dead time, not flying time.

## 2026-08-07 — CD-013 · free-look is a camera-only offset, never a control input

Hold `Q` in FPV flight to swivel the cockpit view (issue #9). The offset is a pure
`{yawRad,pitchRad}` accumulator (`globe/lookAround.ts`, Cesium-free, unit-tested) layered on top
of the low-passed cockpit orientation in `fpvCamera.update`: `heading += yawRad`, `pitch` clamps
`filtered+offset` just shy of the poles, `roll` untouched. It is NEVER routed through
`ControlVector`, the sampler or the physics — the aeroplane keeps flying its held inputs while the
player looks around (spec §1, "zero control coupling"). The regression guard is byte-exact: a zero
or absent offset reproduces the pre-free-look view (`heading + 0`, `pitch` already inside the
clamp), pinned in `fpvCamera.test.ts`; a broken-arm test proves a non-zero offset shifts the view
by exactly the offset so a no-op accumulator would fail. Yaw WRAPS to (-pi, pi] so you can face the
rear to spot traffic; look-offset pitch clamps at ~85 deg so the view never flips over the top.

## 2026-08-07 — CD-014 · pointer lock with a bounded-mousemove fallback; ease back to forward on release

Engagement is pointer-lock-based, requested on the `Q` keydown (a genuine user gesture, so the
browser allows it) on the Cesium canvas, giving the infinite mouse travel needed to swing a full
half-turn. If pointer lock is unavailable or denied, FlightSession falls back to bounded
`mousemove` deltas (capped per-event) so the feature still works without flinging the view — honest
degradation, no crash (spec §2). Escape (which the browser also uses to drop the lock), a lock lost
for any reason (`pointerlockchange`), or the window losing focus all exit look mode cleanly rather
than leaving the view stuck off-axis. On release the offset EASES back to forward over ~0.3 s
(`easeToward`, exponential rate 12/s, snapping to exactly zero), matching the return-to-level
feel (CD-011). Sensitivity (0.0025 rad/px) and the ease rate are documented tuning knobs in
`lookAround.ts`. The accumulator + ease-back live in the Cesium host (next to the camera and the
per-frame dt), so the flight loop and its tests stay entirely unaware of free-look; FlightSession
owns only the DOM plumbing on the canvas it controls (acceptance-verified, no jsdom test per the
no-Cesium convention).

## 2026-08-07 — AF-001 · three new required `ClassParams` fields, no silent defaults

Foundation for the Airliner/Fighter classes (spec, Task 1): `propulsion.afterburnerFactor`,
`limits.mmo`, and a new `display` block (`asiMinKt`/`asiMaxKt`/`attitudeStyle`) are all REQUIRED
in `ClassParams`, validated with no silent default — an absent or malformed value throws at load
time, matching the existing hand-written `sim/params.ts` validator style (no schema library).
Defaulting `afterburnerFactor` to 1.0 or `attitudeStyle` to `"line"` when missing would let a
future jet params file ship silently unafterburning or with the wrong ASI face; forcing every
class to state its own value keeps the "class differences are data" rule honest. `c172.json`
now carries all three (`afterburnerFactor: 1.0` — no afterburner; `mmo: 0.45` — unreachable for
a GA piston, present only so the Mach annunciator is data everywhere; `display` — its existing
40–180 kt gauge and line-style horizon), each with a `sources` entry. `LapseModel` gains
`"turbofan"` (flat-rated, same lapse behaviour as `"none"` — the distinct name documents the
powerplant; `forces.ts`'s `POWER_LAPSE_MODELS` map was extended to match). `ControlVector.afterburner`
is now a required `boolean` (not optional) — the F-5E's dry/wet toggle — swept through every
`ControlVector` object literal in the codebase (`input/controls.ts`, `takeover/spawn.ts`, and the
sim/input test suites) as `afterburner: false`; the live toggle wiring is deferred to Task 3.
No flight behaviour changes: the C172 envelope suite stays green unchanged.

## 2026-08-07 — AF-003 · afterburner wired as `boolean × afterburnerFactor` data; `KeyB` toggle

Task 3 threads the `afterburnerFactor` foundation from AF-001 into live thrust and input, keeping
the "class differences are data, not branches" rule intact: `thrustNewtons` gains a trailing
`afterburner: boolean = false` parameter that multiplies shaft power by `afterburnerFactor` when
wet and by `1` when dry — no `if (class === …)` anywhere, and a class with `afterburnerFactor: 1.0`
(the C172) is unaffected by the flag either way. The default is a pure code convenience so the
existing `levelFlightExcessThrustN` call in `envelope.test.ts` keeps compiling unchanged;
`afterburnerFactor` itself stays a REQUIRED `ClassParams` field per AF-001, not a silent default.
`computeForces` passes `controls.afterburner` explicitly through to `thrustNewtons`.

Input: `KeyB` is the dry/wet toggle, edge-triggered exactly like the flap detent keys (one flip
per press, no re-flip while held, state persists across release) — `KeyL` and `KeyR` were already
taken by the return-to-level assist and re-sync, so `KeyB` was picked as the next free, mnemonic
letter. Registered in `GAME_KEY_CODES` (keyboard capture), `KEYMAP` (documentation + sampler), and
`ControlsHelp`'s `KEY_LABELS` (cockpit help panel), following the same three-file pattern as every
other game key.

## 2026-08-07 — AF-006 · per-class ASI face + attitude style: line vs palette-safe ball, both data-selected

Task 6 adds the second data-selected face: `SixPack`'s attitude dial now branches on
`params.display.attitudeStyle` ("line" | "ball", added in AF-001) — not on class id — to choose
between the existing minimalist line horizon (C172, unchanged) and a filled ADI ball for jets.
The ball is a clipped `<g>` (SVG `clipPath` circle of radius `R`) holding a sky rect and a ground
rect split at the horizon, the same `pitchLadderRungs()` used by the line horizon, a new
`bankScaleTicks()` (`gaugeMath.ts`, pure: `-60/-45/-30/-20/-10/0/10/20/30/45/60`, majors at
multiples of 30) for the roll scale painted on the ball, and a fixed amber pointer triangle
outside the rotating/clipped group marking the zero-bank reference as the ball rotates under it.

Palette stays zero-new-hex: `.gauge-adi-sky`/`.gauge-adi-ground` use `color-mix()` against the
existing `--cyan`/`--grid`/`--bg` tokens (dim cyan-tinted sky, darker olive-grey ground — not
garish blue/brown), `.gauge-adi-horizon`/`.gauge-adi-bank-major` reuse `--cyan`,
`.gauge-adi-bank` reuses `--grid`, `.gauge-adi-pointer` reuses `--amber`. No shadows, no
gradients, no new literals in `tokens.css`. `SixPack.tsx` stays hook-free; `gaugeMath.ts` stays
React/Cesium-free.

## 2026-08-07 — AF-002 · one shared turbofan lapse curve for both jets

Task 7 (b738) ships the 737-800 through the SAME 6-DOF force model as the C172 — no
`if (class === …)`. The turbofan's density-altitude thrust lapse is DATA (`propulsion.lapseModel:
"turbofan"`, selected at load time, validator-rejected if unknown), and the curve itself is one
shared function `turbofanPowerLapse` in `forces.ts` with two module-level TUNING KNOBS:
`TURBOFAN_CORNER_M` (flat-rated corner) and `TURBOFAN_LAPSE_EXP` (stratospheric falloff). Both
jets in v1 (737 now, F-5E in Task 8) are flat-rated turbofans, so a single curve serves both;
per-jet parameterisation stays deferred (spec §2.1) unless the fighter's envelope demands it.

Task 7 retuned the corner from FL360 (tropopause, seeded in Task 2) to **FL380 (11582 m)**,
pinned by the 737's FL410 service-ceiling envelope test: at the FL360 corner full-throttle best
climb at FL410 was **-52 fpm** (no ceiling at all — the model could not reach FL410); at FL380 it
is **~190 fpm** (barely climbing, a real ceiling). FL350 cruise is below the corner, so cruise
Mach is immune to this knob. The exponent stays at the textbook **1.0** (stratospheric thrust
tracks density, T ∝ ρ). C172 is piston-lapse and unaffected; its envelope suite stayed green.

## 2026-08-07 — AF-004a · flat turbofan thrust via a high propPeakSpeedMs, no jet branch

The shared thrust formula is the power-limited prop `T = η·P / max(V, propPeakSpeedMs)` for ALL
classes. A flat-rated turbofan (constant thrust with speed) is expressed — WITHOUT a jet code
path — by setting `propPeakSpeedMs` (260 m/s) ABOVE the aircraft's max cruise TAS, so the
`max(V, peak)` denominator is always `peak` and thrust collapses to the constant `η·P/260`.
`maxPowerW` (13.7 MW) is then a fictitious "power" chosen so `η·P/260 = 0.85·13.7e6/260 ≈ 44.8 kN`
lands on a realistic 737 cruise/climb thrust — NOT the ~2×107 kN static takeoff thrust (a
constant-thrust formula cannot represent both, and the sim spawns airborne, so cruise thrust is
what matters). Pinned by the FL350 cruise test: 85% throttle trims level at **M0.7785** (target
M0.78). `afterburnerFactor` 1.0 (no reheat). Recorded so the "power" and "prop peak speed" fields
in `b738.json` are not read as literal turbofan physical quantities.

## 2026-08-07 — AF-004b · F-5E thrust + afterburner sourced to J85-GE-21 book static thrust

Task 8 (f5e) drives the F-5E through the SAME shared thrust formula as the other classes — no
`if (class === …)`. The seed numbers (`maxPowerW` 22 MW, `afterburnerFactor` 1.5) produced an
absurd ~53,000 fpm burner best-climb (dry T/W ~0.70, well above the real jet), so they were
retuned to the documented **J85-GE-21** figures instead of left as loose knobs: **3,500 lbf
(15.6 kN) dry / 5,000 lbf (22.2 kN) wet per engine**, ×2 = **31.2 kN dry / 44.4 kN wet total**.
`propPeakSpeedMs` 320 m/s sits above max sustained TAS so dry thrust is modeled constant with
speed at the book static value: `η·P/320 = 0.85·11.75e6/320 ≈ 31.2 kN` (so `maxPowerW` = 11.75 MW,
a fictitious "power" as in AF-004a, not shaft power — a turbojet has no propeller). The afterburner
uses the shared dry/wet toggle (Task 3): `afterburnerFactor` = **1.43** = the J85-GE-21 wet/dry
static thrust ratio (5,000/3,500 lbf). Result: T/W ~0.37 dry / ~0.54 wet at 8.5 t, burner best-climb
~20,900 fpm at 10,000 ft (dry ~11,700) — credible, below the ~34,500 fpm sea-level book figure.
Aero coefficients (cl0/clAlpha/cd0/oswaldE) and all control derivatives remain TUNING KNOBS
(no published F-5E derivatives; decisions B-007). Phase B source verification still pending
(CLAUDE.md).

## 2026-08-07 — AF-005 · F-5E capped subsonic (no wave-drag path; issue #2)

The 6-DOF model has no transonic/supersonic wave-drag physics, so the F-5E ships **capped
subsonic**: `limits.mmo` = **0.95** and the shared Mach annunciator trips there. The F-5E is a
genuinely supersonic airframe (~M1.6), but modeling that honestly needs a wave-drag rise the
model does not have; shipping it without one would let the jet accelerate past M1 with no drag
penalty — a lie. Supersonic flight + wave drag is deferred to **issue #2**. The F-5E's operating
speed placards (`vne`/`vno`/`vfe`, display-only) are likewise subsonic-capped TUNING KNOBs; the
sim caps at Mmo before those IAS values are reached. The service ceiling (15,700 m) sits above the
shared turbofan corner (FL380, AF-002) but no envelope test reaches it (airborne-spawn sim; no
ceiling-hang test), so the shared corner is inert for the F-5E — validated, not re-tuned.

## 2026-08-07 — AF-007 · class threads from the real feed type through every takeover path

Task 10 (capstone) wires the Task 9 resolver into the takeover so a real airliner/fighter
actually flies its own class. `FlightSession` and `DashboardStrip` now load params via
`loadClassById(resolveClass(contact).classId)` instead of hard-loading the C172, and the
handoff card discloses the substitution with `disclosureLine` (`<REAL TYPE> → <MODEL>`, a `—`
for a missing type, `(NO MATCHING CLASS)` for an unmatched one) in place of the hardcoded
"C172 MODEL THIS BUILD". `takeover/spawn.ts` no longer hard-codes `pistonPowerLapse` — it trims
through `POWER_LAPSE_MODELS[params.propulsion.lapseModel]`, so a jet spawns on its own turbofan
curve, not an invisible piston assumption (a b738 at FL350 previously pinned to the throttle
clamp; the given brief test could not see this because the clamp keeps throttle in (0,1], so a
`throttle < 1` broken-arm assertion was added alongside the verbatim test).

Two edits beyond the brief's literal enumerated list, kept in scope because the task's own
self-review requires the class to thread end-to-end and never flip mid-flight:
(1) the KeyR **re-sync** path (`FlightSession`, was `loadC172()`) now resolves the class from the
**origin snapshot**, so a jet re-syncs as a jet — class is fixed at takeover, not re-inferred from
the live contact; (2) `DashboardStrip`'s gauge params resolve from `origin` (with the C172 kept as
the pre-origin mount fallback). No per-class `if` branch enters the physics or the gauges — the
difference is entirely `resolveClass` + data (data-not-branches). The SIM banner, amber accent,
`SIM-<hex>` callsign and the ghost are untouched.

## 2026-08-07 — AF-008 · spawn envelope also clamps to Mmo, not just IAS/Vne

Review finding on the airliner-fighter branch: `buildSpawnState`'s envelope safety net clamped
speed against stall and `0.9 x Vne`, both IAS bounds, but never against `limits.mmo`. Vne is an
IAS limit and goes toothless at altitude — low density means a given TAS produces a much lower
IAS the higher you go — so a fast contact spawning high (e.g. a fighter above ~M0.95 at FL500)
could clear the Vne check yet spawn already past Mmo, tripping the HUD's MMO annunciator the
instant a handoff card calls the aircraft "trimmed." Added a third clamp: TAS is capped to
`limits.mmo * speedOfSoundMs(altitudeM)` (both already existed, from Task 4's `isa.ts`), same
`adjustments[]` disclosure pattern as the existing clamps. Purely data-driven — no `if (class
=== …)` branch — so it's inert for the C172 (`mmo` 0.45 is unreachable, per AF-005's note) and
for any subsonic spawn, and only bites a genuinely trans-Mmo jet spawn. Supersonic flight itself
remains deferred to issue #2 (AF-005); this only stops the spawn from starting *already* past
the cap the sim already enforces in flight.

## 2026-08-07 — GR-001/GR-003/GR-004 · gear command/position split + drag/O'SPD data fields

ControlVector.gearDown (commanded target, edge-toggled) and SimState.gearPosition (integrated
0..1) are split fields, not one — the command is an input (testable independent of time), the
position is state (testable independent of the keyboard). Two new required ClassParams fields
land with no silent default: aero.gearDragCd0 (0 for the fixed-gear C172, whose drag is already
in cd0) and limits.vleIasMs (m/s — see the plan's Signature Decision #1 for why this departs
from the design spec's "vleKt" naming/unit: every sibling limits field is IAS in m/s per
CLAUDE.md's SI-internal rule, so vleIasMs keeps the GEAR O'SPD gate a plain iasMs comparison).
C172 ships vleIasMs = vneIasMs (structurally unreachable); b738 138.9 m/s (270 kt Vle/Vlo);
f5e 123.5 m/s (240 kt gear limit, Phase B verification pending).

## 2026-08-07 — GR-002/GR-005 · shared gear transition constant + fixed-gear pin

GEAR_TRANSITION_S = 10 s lives in sim/forces.ts as a documented TUNING KNOB, same placement
pattern as TURBOFAN_CORNER_M (decisions AF-002): one shared curve for every retractable class
in v1, not a per-class field, because no envelope test yet needs a different time. The pure
advanceGearPosition(current, gearDown, gear, dt) integrator is called from sim/aircraft.ts's
stepAircraft — the sim's actual per-tick SimState advance — rather than from game/flightLoop.ts
as the design spec's architecture table literally states; see the implementation plan's
Signature Decision #2 for why (SimState integration belongs in one place, alongside every other
derived/integrated field, and this keeps the integrator unit-testable without a FlightHost).
Fixed-gear classes are pinned at gearPosition = 1 unconditionally (GR-005) — no transition ever
runs for the C172, and KeyG's inertness (Task 4) is a second, independent enforcement of the
same rule at the input layer.

## 2026-08-07 — GR-004 · GEAR O'SPD annunciator wired

warningsFor pushes "GEAR O'SPD" (distinct from OVERSPEED/MMO) when the class is retractable,
gearPosition > 0, and IAS exceeds limits.vleIasMs — computed once in game/flightLoop.ts's
publish(), the same shape as the existing overspeed/machOverspeed lines (plain state.iasMs
comparison, no unit conversion — see the plan's Signature Decision #1 for why vleIasMs is m/s).
formatGear grows a fourth label state, GEAR IN TRANSIT, for 0 < gearPosition < 1; ControlState
threads gearPosition through so a retractable aircraft's readout tracks its real position
instead of reading GEAR DOWN unconditionally (the bug this whole feature exists to fix).

## 2026-08-07 — GR-006 · spawn gear state (the acceptance-flight bug fix)

buildSpawnState now sets ControlVector.gearDown and SimState.gearPosition per class:
retractable spawns gear-up (gearDown: false, gearPosition: 0) — the honest state for an
airborne-cruise takeover — and fixed spawns gear-down/pinned (gearDown: true, gearPosition: 1).
This is the actual fix for the bug that motivated this whole feature: before GR-001..GR-005
existed, gear was a static "retractable" descriptor and formatGear read it as GEAR DOWN
unconditionally, so a 737 or F-5E taken over at FL350 showed GEAR DOWN for the whole flight.
Gated entirely on params.gear (data), not a class id — a fixed-gear class spawning "down" and a
retractable class spawning "up" is one branch-free expression, not two class-specific paths.

## 2026-08-07 — #12 · ATC panel removed (no honest live source)

The chrome-only ATC placeholder (DashboardStrip's "atc" panel + AtcPanel.tsx) is deleted, not
populated. Research verdict on issue #12: there is no honest live ATC feed we can use —
LiveATC's ToU forbids third-party product use, an SDR only covers local airspace, and
speech-to-text on ATC audio runs 15–30% WER (it garbles the callsigns that would be the point).
Rather than keep a permanent NO-FEED panel for a feed that can never honestly arrive, the panel
is removed: PanelId drops "atc", PANEL_IDS/defaultStripState drop it, the ATC PanelFrame and
AtcPanel.tsx are gone, and the strip reflows to weather-alone on the right. Weather (#10) stays —
it has a real free source (aviationweather.gov METAR) and is the next feature. Spec D-1/D-5
annotated; 4 ATC-panel tests removed (726 → 722 green).

## 2026-08-07 — NM-001 · NAVMAP panel: a north-up geographic moving map, complement not merge (#11)

The new NAVMAP strip panel COMPLEMENTS the radar rather than merging into it. The radar
(RadarScope/radarMath) is a heading-up traffic PPI: own ship centred, range rings, live contacts
only. NAVMAP (NavMap/navMath) is a NORTH-UP geographic map: own ship centred, range rings,
contacts AND bundled airports. Merging would have forced one instrument to be both heading-up
(what a PPI wants) and north-up-with-upright-labels (what a chart wants), and would have coupled
the airport layer to the traffic feed's staleness. Two small panels, each honest about one job,
is the boring-and-legible call. They share the tested `geoRange` math and NAVMAP reuses the
radar's `blipsFor` (with the heading term zeroed) and `ringsFor`/`coverageNote`, so "complement"
cost almost no new surface.

- **Projection = azimuthal-equidistant, centred on own ship** (`navXY`): a feature's great-circle
  range sets its radius, its bearing sets its angle. This is exactly `scopeXY` MINUS the
  own-heading term — that missing term is what makes it north-up — and it reuses the same
  `geoRange` haversine/bearing the radar and windscreen tags already use. Range/bearing are both
  exact at these scales; no new geodesy, no map library.
- **North-up, not track-up.** The distinguishing value over the heading-up radar is a stable
  geographic frame you can read a chart against, and — decisively — north-up keeps the airport
  LABELS upright without per-label counter-rotation. The own-ship chevron rotates to heading
  instead of spinning the whole map (and its labels).
- **No basemap imagery (v1).** CLAUDE.md rule 3 forbids adding a mapping library, and stitching
  Esri tiles into a 2D canvas is a large surface that risks an implicit dependency. The panel is a
  hand-rendered SVG graticule (same tech as the radar), airports/contacts plotted by the pure
  projection helper. No package added.
- **Airports are bundled, so only TRAFFIC freezes offline.** `navStatus` says
  "FEED OFFLINE/STALE · TRAFFIC FROZEN" and the dim is applied to the traffic `<g>` alone; the
  airport layer stays full-opacity because the OurAirports extract is not a feed and never goes
  stale. This is the honest-data rule made specific to a two-source panel.
- **Folded by default**, like the CONTROLS help panel — a secondary instrument the owner opens on
  demand. (Also keeps the radar-collapse test's "no NM when radar folded" invariant intact,
  surgically.) Range presets 10/25/50/100/200 NM, default 50; state lives in DashboardStrip's
  `useState` (navRangeNm), same reset-on-QUIT lifecycle as the radar range (CD-006).
- Tests: navMath.test.ts (17), NavMap.test.tsx (12), plus 4 in DashboardStrip.test.tsx —
  no-jsdom `collectText`/`collectProp` element-tree style. 722 → 755 green.

## 2026-08-07 — #14 · Time-aware lighting (day / dusk / night)

Cesium's built-in sun/atmosphere model, driven by the REAL wall clock — not a scrubbable
time-of-day selector. `globe/dayNightLighting.ts::applyRealTimeLighting(viewer)` sets
`scene.globe.enableLighting = true`, `showGroundAtmosphere = true`, `skyAtmosphere.show = true`,
and points the viewer clock at real time via `clock.clockStep = ClockStep.SYSTEM_CLOCK` +
`shouldAnimate = true`. SYSTEM_CLOCK reads the actual system time on every tick (requestRenderMode
is off, so ticks run continuously), so the terminator, dawn/dusk gradients and night side are
truthful for the aircraft's actual position and the actual time — the honest default that matches
the live-ADS-B ethos. No new dependency (Cesium's sun model is built in). Wired once in
ViewerHost right after the Viewer is constructed, so it applies in both BROWSE and flight.

The testable decision logic is kept Cesium-free in `world/dayNight.ts` (so `sim/`-style unit
tests and the game/HUD layers can use it without importing the renderer): `solarElevationDeg(date,
lat, lon)` is the standard low-precision NOAA solar-position algorithm (arcminute accuracy — far
finer than a phase needs), and `classifyLightPhase(elevationDeg)` returns `day | civil-twilight |
night` at the civil-twilight convention (sun 0 … −6°). It lives in `world/` (not `globe/`) because
it is pure geodesy/time domain logic consumed by both `game/flightLoop.ts` and `hud/format.ts`,
and `globe/` is the Cesium layer.

The phase is surfaced in the HUD (`SKY DAY` / `SKY TWILIGHT` / `SKY NIGHT`, bottom row) so the
feature is legible and unit-verifiable without a browser: flightLoop computes
`classifyLightPhase(solarElevationDeg(new Date(), lat, lon))` into the snapshot each publish, and
`formatLightPhase` maps it to a label via a `Record<LightPhase,string>` lookup (data, not a
branch). Civil twilight reads "TWILIGHT" rather than "DUSK" because a single elevation sample
cannot honestly tell dawn from dusk — labelling it "DUSK" at dawn would be a false readout, which
the honest-data rule forbids for the player's own instruments too.

Known limitation (owner input welcome, NOT fixed here — out of scope for #14): the Esri World
Imagery basemap has no night-lights layer, so with lighting on the night side renders very dark.
This is truthful but hurts flyability/HUD readability at night — it reinforces the #6 HUD-scrim
work and may want a future "minimum ambient / night-imagery" decision. No fake illumination was
added to paper over it.

## 2026-08-07 — #14 follow-up · Night-side ambient floor (playability, NOT data)

Addresses the known limitation logged in the #14 entry above: with globe lighting on and Esri
World Imagery having no night-lights layer, the night side rendered near-black — truthful but too
dark to fly. `applyRealTimeLighting(viewer)` now also sets `scene.globe.vertexShadowDarkness = 0.55`.

- **Why this knob.** Cesium's terrain lighting (GlobeFS.glsl) is
  `diffuseIntensity = clamp(lambertDiffuse * lambertDiffuseMultiplier + vertexShadowDarkness, 0, 1)`.
  On the night side `lambertDiffuse` is 0, so terrain brightness collapses to *exactly*
  `vertexShadowDarkness` — this property IS the night-side ambient floor. It is the single cleanest
  knob for the request. `lambertDiffuseMultiplier` was rejected: it scales the sun term, which is 0
  at night, so it cannot lift the dark side at all. `atmosphereLightIntensity` /
  `dynamicAtmosphereLighting` only affect the ground-atmosphere glow, not terrain imagery legibility,
  and would muddy the day/night distinction. One boring knob beats three interacting ones.
- **Why 0.55.** Cesium's default is 0.3; multiplied into the already-dark Esri imagery that reads
  near-black. At 0.55 the night side is legible while the day side (diffuse clamps to 1.0) stays
  clearly brighter, so the day / twilight / night gradient is compressed but still visibly present.
  This is a by-eye playability value — the owner may want to retune it in a real browser (raise for
  a brighter night, lower to hug reality). Verified in unit tests; the actual night appearance can
  only be confirmed live.
- **Honesty note (deliberate, not a bug or a data fake).** This is a RENDERING legibility aid, not
  data. It changes only how the globe is drawn. Nothing about the feed, the aircraft, or the ghost
  changes, and the HUD `SKY DAY/TWILIGHT/NIGHT` readout logic is untouched — it still reads NIGHT at
  night (it IS night; we just don't render pitch-black). Owner request: easier to play vs strict
  reality, while keeping the day/dusk/night distinction visible.

## 2026-08-07 — #10 · Weather panel (real METAR)

The chrome-only WeatherPanel is replaced with a live nearest-station METAR, backend-proxied.

- **Source:** NOAA Aviation Weather Center JSON API (aviationweather.gov, keyless),
  `?ids={ICAO}&format=json`. Backend-proxied at `/api/metar/{icao}`, mirroring the adsbdb
  proxy exactly: httpx with a 12 s timeout, in-process dict cache, honest failure shaping. New
  `METAR_BASE` setting (.env.example). One real call was made during development to confirm the
  JSON shape; it is NOT baked into any test — every test stubs the upstream with MockTransport.
- **Cache TTL 10 min.** METARs refresh ~hourly; 10 min spares the API a poll per browser tick
  without ever misrepresenting age — the panel shows observation age from the report's `obsTime`,
  not from when we fetched. Outages are never cached (an unreachable upstream must not pin
  "no METAR" for 10 min), same rule as adsbdb.
- **Station selection (pure, unit-tested).** `nearestIcaoStation` picks the nearest airport whose
  ident is a four-letter ICAO code (in the OurAirports extract the four-letter ident IS the ICAO
  code) from the aircraft's live position. Local idents like `5A8`/`AR-0744` are filtered out
  rather than sent upstream to bounce back empty. Sampled off a 60 s timer from a position ref,
  not recomputed on every ~10 Hz snapshot render; a METAR is fetched only on station change or
  after an 8 min refresh window — modest polling.
- **Altimeter units.** The API reports altimeter in hectopascals; US altimeters read inches of
  mercury (the raw METAR's `A####` group). The backend converts hPa→inHg once (×0.0295299830714)
  at the shaping edge — the only transform applied; every other field is passed through or nulled.
- **Honest states (the whole point).** Three distinct empties, never collapsed and never faked:
  `NO FEED · WEATHER OFFLINE` (our proxy unreachable, OR proxy up but aviationweather.gov down —
  `available:false`, same fold as the traffic card's adsbdb-unreachable); `NO METAR` (station
  answered but has no current report); `NO METAR STATION NEARBY / OUT OF COVERAGE` (no ICAO
  station at all). Every missing field is an em-dash; variable wind is `VRB`, calm is `CALM`, a
  null gust is absent — never a fabricated `0`. A test asserts every non-report state contains no
  digit at all, so a hardcoded sample reading cannot sneak in. NOAA attribution is shown whenever
  a report is on screen (data-sources table rule).
- **Coverage note.** The design brief expected US-only coverage; a live check confirmed
  aviationweather.gov also serves international stations (e.g. EGLL). The code does not rely on
  either way — an empty upstream response renders as the honest `NO METAR` state regardless.
  OWNER INPUT: no maximum-distance cap on the nearest station — over open ocean the nearest ICAO
  field can be far, so the panel shows the station id and its range and lets the pilot judge;
  add a cap later if that reads as misleading.

## 2026-08-07 — #10 · Max-distance cap on the nearest METAR station

Resolves the deferred OWNER INPUT item above. A far station's report is a less-accurate reading
for the aircraft's position (open ocean / sparse regions can put the "nearest" ICAO field hundreds
of NM away), so beyond a cap the panel now falls back to the existing honest
`NO METAR STATION NEARBY / OUT OF COVERAGE` state rather than showing a distant report as if it
were local.

- **Cap: `MAX_STATION_NM = 50` NM**, a named constant next to `nearestIcaoStation` in
  `frontend/src/data/metarStation.ts`. A METAR nominally represents conditions within ~5 statute
  miles of the field, but in flight the aircraft covers ground fast and regional conditions stay
  coherent over a wider area, so a modestly larger radius keeps the panel useful in moderately
  sparse regions without misrepresenting a far report as local. 50 NM (upper end of the considered
  ~30–50 NM range) favours keeping the panel populated; **owner-tunable** — lower it toward 30 NM
  if a 50 NM report reads as too far to trust.
- **Where:** the cap lives in the PURE, unit-tested helper — if the nearest ICAO station is farther
  than the cap, `nearestIcaoStation` returns `null`, which the `useWeather` hook already maps to
  the pre-existing `no-station` state. No new state, no new branch in the panel, no visual change.
- **Tests (TDD, broken-arm):** `metarStation.test.ts` gains a station just INSIDE the cap (still
  selected) and a station just BEYOND the cap (resolves to `null`/out-of-coverage); both placed via
  the exact inverse of `rangeNm` along a meridian and guarded against the constant drifting. The
  beyond-cap case failed before this change (the old helper returned the far station) and passes
  after.
- **Honesty:** this IMPROVES honesty — a distant, less-representative reading is never shown as
  local; beyond the cap it's the explicit out-of-coverage empty. No synthesized data; unknown/absent
  still renders em-dash.
- **Scope:** frontend station-selection only. No backend change — the backend just proxies
  `/api/metar/{icao}` for whatever ident the frontend chooses; capping which ident gets chosen is
  entirely client-side.

---

## 2026-08-07 — Mobile responsive layout (#13 sub-feature 1)

First of four sequential mobile sub-features (spec `docs/superpowers/specs/2026-08-07-mobile-optimized-design.md` §2). **Layout only — no input/control changes; desktop unchanged at wide widths.** Touch controls, tilt, and perf hardening are sub-features 2–4.

- **Breakpoint: `MOBILE_BREAKPOINT_PX = 1024`** (`frontend/src/layout/viewport.ts`), width-based, `isNarrowViewport(width) = width < 1024`. 1024 is Tailwind's `lg`. Rationale: it captures EVERY phone in both orientations (widest current phone ~932 px) while leaving real laptops/desktops (>=1024) byte-for-byte unchanged. Width-based (not min-dimension) because the sim is landscape-first — a landscape phone is still "narrow" and must get the mobile reflow. CSS media queries use `@media (max-width: 1023px)` to agree exactly with the JS `< 1024`. **Owner-tunable.** Cost: iPad portrait (768) and a desktop window narrowed below 1024 get the mobile layout — both acceptable/desirable; "desktop at wide widths unchanged" still holds.
- **Pure, unit-tested helpers** carry every breakpoint decision (`viewport.ts`: `isNarrowViewport`, `isPortrait`, `shouldShowRotateCard`; `DashboardStrip.defaultStripState(narrow)`; `StatusBar.contactsChipLabel`). The one impure piece is `useViewport()` (`layout/useViewport.ts`), which only reads `window.innerWidth/innerHeight` and re-renders on resize/orientationchange — browser-verified, not unit-tested (codebase avoids jsdom, spec §8).
- **Browse drawer vs sidebar (spec §2.1):** on narrow BROWSE the `w-80` `ContactList` sidebar is replaced by a bottom-sheet drawer (`.contact-drawer`) toggled by an interactive `CONTACTS [n]` chip in the StatusBar (n = live count). Desktop keeps the inline sidebar (the `contactsChip` prop is `undefined` off-mobile, so StatusBar renders the exact same plain `CONTACTS {count}` span it always did). Globe gets the full viewport when the drawer is closed.
- **StatusBar wraps, never truncates (spec §2.1, non-negotiable honesty):** `@media (max-width:1023px)` adds `flex-wrap: wrap` so the feed source + Esri/Re:Earth attribution wrap to more lines rather than overflow/truncate.
- **HUD reflow (spec §2.2):** CSS-only, inside the media query — readout font via `clamp(13px, 3.6vw, 18px)` (tops out at the current desktop 18 px so desktop is unchanged), heading via `clamp(15px, 4.4vw, 20px)`, tighter gaps and corner insets. **Kept always:** SIM banner, warnings, heading, attribution (SIM-unmistakable + honesty + safety, §4). **D6 HUD demotion NOT implemented** — the rotate card covers portrait, so no glance-HUD readout is ever dropped (per task brief).
- **Orientation = landscape-first, portrait-tolerant (spec §2.4 / owner D4):** narrow + portrait renders a NON-blocking LORAN `RotateCard` (`layout/RotateCard.tsx`) over the still-rendering globe; backdrop and card both keep `pointer-events: none` so the globe and contact drawer stay interactive underneath. Deliberately no full portrait flight reflow (out of scope). Implementer call: the card shows in every mode (not just FLYING) when narrow+portrait, kept non-blocking so it never obstructs browse.
- **Dashboard folded-first + stacked (spec §2.3):** `defaultStripState(narrow=false)` returns `open: !narrow` — desktop starts open (unchanged), narrow starts folded (flying-first), reopened by the existing `COCKPIT [C]` chip. Read once at mount via `useViewport`, not re-folded on later resize (don't fight a user who opened it). When open on narrow, `.dash-strip` stacks the panels vertically as an overlay sheet (`flex-direction: column` in the media query), preserving `PanelFrame` chrome; container stays `pointer-events:none` (armed-resume click rule) with panels re-enabling it. Data-driven off the viewport check, not a fork.
- **Touch targets (spec §2.2):** existing tappable chips/buttons/rows (`.status-chip-button`, `.control-button(-disabled)`, `.dash-panel-header`, `.contact-row`) get `min-height: 44px` + horizontal padding inside the media query — transparent padding grows the hit area while the 1px border, no-radius, no-shadow LORAN look is preserved. No NEW controls (those are sub-feature 2).
- **Viewport meta:** `frontend/index.html` now `width=device-width, initial-scale=1, viewport-fit=cover`; safe-area insets (`env(safe-area-inset-*)`) padded on the status bar and cockpit sheet so `viewport-fit=cover` doesn't hide content behind notches. Nothing app-store-y added.
- **Verification:** `npx vitest run` 806 passed (baseline 794, +12 new: viewport helpers, RotateCard, contactsChipLabel, mobile fold); `npx tsc --noEmit` clean; `npm run build` succeeds. The actual mobile RENDERING (drawer slide, rotate card, stacked sheet, 44 px targets, safe-area) is CSS/DOM that the no-jsdom pure tests can't cover — needs a real browser/devtools device-emulation pass to confirm by eye.

## 2026-08-07 — #13 · Contact-select discoverability hint (mobile)

The take-controls flow (tap/click a contact row → TAKE CONTROLS button appears) was not
discoverable on touch — nothing prompted the player to select a contact first. Added a pure
`selectionHint(selectedHex, rowCount)` that returns "SELECT A CONTACT TO TAKE CONTROLS" only
when the list is non-empty and nothing is selected; it renders in the same bottom slot the
TAKE CONTROLS button occupies, so selecting a row swaps the hint for the button. Wording is
device-neutral ("select" = tap or click), so it helps desktop too and needs no mobile branch.
No data change; honest-data untouched.

## 2026-08-07 — #4 + #15 · Exterior chase/orbit camera + hand-built low-poly aircraft models

Owner-locked design (issue #4 + #15 pinned comments): an exterior view = chase + orbit, and
hand-built low-poly per-class models. Camera-only, no physics coupling; off by default (a takeover
still starts in the cockpit FPV view).

- **Render mechanism (models):** procedural Cesium `PolylineCollection` **wireframe**, not glTF and
  not a shaded `Primitive`. Zero new dependency, zero licensing risk, and it is the cleanest fit for
  the LORAN flat/line visual language (1px cyan/amber lines, no shading to tune). The pure geometry
  generator (`globe/aircraftGeometry.ts`) turns one dimension record into body-frame line segments;
  the render layer (`globe/aircraftModel.ts`) rotates those endpoints into ECEF each frame with the
  aircraft's attitude quaternion (the same `qRotate` path the cockpit camera uses). `sim/` stays
  Cesium-free.
- **Per-class dimensions (data, not branches):** `globe/aircraftModelDims.ts` — a `Record` keyed by
  the class id (`c172s` / `b738` / `f5e`), exactly like `sim/params.ts::loadClassById` +
  `resolveClass`. No `if (class === …)`. Numbers are honest real-airframe proportions rounded to the
  metre (C172S 8.3 m/11.0 m straight wing; 737-800 39.5 m/35.8 m, 25° sweep; F-5E 14.7 m/8.1 m,
  24° sweep, low aspect). Exact wing fore-aft placement, fuselage slimness and the fin are **visual
  tuning knobs to adjust by eye in the browser**, not source-verified aero figures.
- **Toggle key:** **KeyE** ("exterior / chase camera"), verified free in the KEYMAP (added to
  `input/controls.ts` KEYMAP + `ControlsHelp` KEY_LABELS). Handled as a chrome key in
  `FlightSession` like KeyR/KeyC — not in `GAME_KEY_CODES` (those are held flight controls). The
  toggle + orbit LOGIC lives in the host (`cesiumFlightHost`), so a future mobile control can drive
  the same `host.toggleExterior()` / `applyOrbitDrag` / `applyOrbitZoom` with no rework (UI-agnostic).
- **Chase / orbit math:** pure + unit-tested (`globe/chaseCamera.ts`). The chase frame follows the
  aircraft's HEADING only (not roll/pitch) so aerobatics don't tumble the camera. Default = behind +
  12° above, distance = 4 × model length (clamped 10–400 m). Drag orbits (yaw wraps, pitch clamps
  −20°..+80°); wheel zooms (multiplicative, clamped). On release the yaw/pitch **ease back to the
  chase framing** while the **zoomed distance persists** (a deliberate framing choice, owner-tunable).
  Damping rate, sensitivities and default framing are all owner-tunable constants.
- **Ghost styling:** the live-feed ghost gets the SAME per-class model (`globe/ghostModel.ts`,
  synced from `ContactLayer`), oriented from the real ADS-B **track** held level (ADS-B has no
  attitude, so none is invented). It is drawn in **cyan @ 0.55 alpha** (`GHOST_MODEL_STYLE`) —
  deliberately NOT the SIM **amber** (`SIM_MODEL_STYLE`), so the real aircraft stays unmistakable
  from the player's synthetic one. The player model shows only in the exterior view.
- **Honesty:** the models render real sim/feed pose; no feed data is synthesized. SIM banner, amber
  accent and `SIM-<hex>` are untouched. The exterior view never reads or writes ControlVector or the
  sim state.
- **Not unit-tested (browser-verified):** the Cesium primitive wiring and the actual on-screen
  silhouette + camera feel. The pure parts (class→dims, geometry, chase/orbit math) are unit-tested
  broken-arm; proportions and camera distance/damping still need a real browser to confirm by eye.

## 2026-08-07 — #13 · Mobile select-a-plane fixes (drawer clip + rotate card)

Two shipped-bug fixes to the mobile browse flow (reported: "can't select a plane on mobile"):
- **Drawer clipped the TAKE CONTROLS button.** `.contact-drawer` had only `max-height:60vh`
  (no definite height), so ContactList's `h-full` couldn't resolve and it grew to full content
  height; `overflow:hidden` then clipped the bottom-pinned button (and lower rows). Fix: definite
  `height:60vh` + `flex-direction:column` on the drawer, plus `min-h-0` on ContactList's scroll
  list so it scrolls internally and the button stays pinned/reachable.
- **Rotate card covered the browse list.** `shouldShowRotateCard` was `narrow && portrait`,
  independent of mode, so it obscured the contact drawer in BROWSE-portrait (where you pick a
  plane — a vertical list that reads fine in portrait). Fix: `shouldShowRotateCard(w,h,mode)` now
  also requires `mode !== "BROWSE"`; only the flight display demands landscape.

## 2026-08-07 — Mobile touch input (#13 sub-feature 2)

Second of four sequential mobile sub-features (spec §3 + §6). After this the game is flyable on a phone with **no tilt and no HTTPS**. Widens the flight-loop input seam for analog sources **without changing the keyboard path or the physics** — that is the #1 correctness bar. `sim/` and `ControlVector` semantics untouched; only how inputs are SOURCED changed.

- **Seam = Option A (discrete) + Option B (analog), exactly per spec §6.**
  - **Option A — synthesize key codes.** Every discrete/rudder touch button dispatches the SAME keyboard-event `code` on `window`, where `createKeyboard` already listens. The existing keyboard→held-set→sampler/loop edge-detection then fires **completely unchanged** — zero new sampler wiring. Flaps (`KeyV`/`KeyF`), gear (`KeyG`), afterburner (`KeyB`), return-to-level (`KeyL`) are **momentary taps**: `keydown` on `pointerdown`, `keyup` after `TAP_HOLD_MS = 90ms` (must span ≥1 physics tick so a fast tap still registers exactly one edge). Rudder L/R (`KeyA`/`KeyD`) are **holds** (`keydown` on press, `keyup` on release) so yaw ramps and self-centres on the existing sprung path — no new yaw code. Pause dispatches a momentary `Escape`, reusing FlightSession's existing Escape pause handler. Gear button is disabled (no dispatch) on fixed-gear, matching `KeyG` inertness (`gearButtonDisabled(gear)`).
  - **Option B — analog axis provider.** `createFlightLoop` takes an OPTIONAL `analog?: () => AnalogAxes | undefined` (live view, sampled once per tick like `heldKeys`). The sampler (`controls.ts::sample`) gained an optional 3rd arg `analog?: AnalogAxes`; for each axis the provider drives it **overrides the sprung/lever value directly** (bypassing `stepAxis`), and any axis it leaves `undefined` keeps the keyboard behaviour. Assigning the override into the sampler's closure vars means releasing an axis springs it back to centre from where analog left it — **return-to-centre on stick release is the keyboard spring, reused**. The virtual stick drives `pitch`/`roll`; the throttle slider drives `throttle` absolutely. `AnalogAxes` also supports `yaw` (Option B is defined over all four axes and it is tested), though the rudder UI itself uses Option A.
- **Keyboard path proven unchanged.** With no `analog` provider, `analog?.()` is `undefined` and `sample(held, dt)` runs byte-for-byte as before — every pre-existing `controls.test.ts`/`flightLoop.test.ts` still passes untouched (they never pass a 3rd arg). Added test: an EMPTY analog object `{}` deep-equals the no-analog result over 30 ticks of mixed held keys. On desktop `TouchControls` never mounts (gated to narrow viewport) so `touchAxesRef.current` stays `{}` → no override ever. Physics/`sim/` not touched at all.
- **Virtual stick — hand-rolled (owner D5).** Plain TS/React (`input/analog.ts::stickToAxes` + `input/TouchControls.tsx`), no `nipplejs`/gesture lib. D5 said "best practical experience, ask-before-deps still binding": a hand-rolled radial-deadzone stick matches the existing hand-built gauges/annunciators and is genuinely good enough here (stable-jet/GA sim, not twitch FBW). I did **not** become convinced a library is materially better, so none was added. Mapping: pad offset (px) → normalized by radius, radial deadzone `STICK_DEADZONE = 0.12` rescaled continuously to the rim, clamped to ±1. **Sign: thumb DOWN the pad = nose up (stick back)**, matching keyboard `ArrowDown` = "pitch up" — aviation-consistent; whether casual players want it inverted is an **owner tuning call** (wrap `stickToAxes` in an invert flag if so).
- **Throttle = absolute lever (spec §3):** `sliderToThrottle(y, top, height)` → top of track = full, bottom = idle, clamped [0,1]. Not sprung — matches `controls.ts` throttle semantics. Stays `undefined` until first touched, so the spawn's trimmed handoff throttle holds until the player grabs the lever.
- **Rudder = two hold-buttons (owner D7, "best practical").** Least-used axis; two small L/R buttons is the complete, honest choice (not auto-coordinate, not omit). Implemented via Option A held `KeyA`/`KeyD` for the sprung, self-centring feel for free.
- **Free-look on touch: DEFERRED** (spec D6 allows deferring; kept scope bounded). No two-finger-drag glance implemented this sub-feature. Desktop hold-Q + pointer-lock free-look is untouched.
- **Leveling assist + touch:** grabbing the virtual stick (analog `|pitch|` or `|roll|` > 0.2) now cancels the `KeyL` return-to-level assist, the same way an arrow key does — otherwise the stick would feel dead under assist on a phone. The extra term is guarded by `analogAxes !== undefined`, so the keyboard/desktop leveling path is provably byte-identical.
- **Gating:** `TouchControls` renders only when `isNarrowViewport(width)` (reusing sub-feature 1's `useViewport`/`viewport.ts`) AND `mode === "FLYING"`. Desktop (wide viewport) is completely unaffected. Take-controls (browse) and Resume (paused) already tap-work and inherit the sub-feature-1 44px targets (`.control-button`).
- **Honesty + SIM (spec §4) untouched:** touch is input to the player's SIM aircraft only; no feed data touched. SIM banner/amber/`SIM-<hex>`/ghost unmistakable. LORAN language for all affordances (1px borders, monospace, amber/cyan, translucent, no radius>2px except the round stick/knob instrument faces, no shadow, no ripples). Pointer Events + `touch-action: none` on every interactive surface.
- **Verification:** `npx vitest run` **860 passed** (baseline 836, +24: 14 `analog` pure, 7 `controls` analog-override, 3 `flightLoop` analog-seam); `npx tsc --noEmit` clean; `npm run build` succeeds.
- **Not verifiable without a real phone (owner tuning by eye):** stick sensitivity/deadzone/pitch-invert, throttle drag feel, `TAP_HOLD_MS` latency, button-row layout/crowding (8 buttons) and reachability, safe-area behaviour, whether `touch-action: none` fully suppresses browser gestures on iOS/Android. The pure mapping + seam are unit-tested broken-arm; the on-glass FEEL is not.

## 2026-08-07 — #13 · Flight-view declutter + portrait viewable

Owner feedback while flying on mobile: "minimal tools obscuring the view" + "allow portrait to see how it looks".
- **Cesium InfoBox/selectionIndicator disabled** (`ViewerHost` Viewer options `infoBox:false, selectionIndicator:false`). Tapping the globe was popping Esri World Imagery's tile-metadata card ("Vivid · OBJECTID · Shape · SOURCE…") over the flight view. Contact picking is our own LEFT_CLICK→store.select handler, so nothing depends on Cesium's default selection UI.
- **Rotate card dismissible** so the player can fly in portrait and judge it: `RotateCard` gains an optional `onDismiss` + a pointer-events:auto "DISMISS · FLY IN PORTRAIT" button (the card/backdrop stay pointer-events:none otherwise); App holds a session `rotateDismissed` flag. Landscape-first stays the default hint; portrait is now openly viewable, not blocked.
- Full portrait HUD reflow (readouts overlap in portrait, sub-feature 1 deferred it) is still open — pending owner's look at the dismissed-card portrait view.

## 2026-08-07 — #13 · Mobile immersive / fullscreen flight mode

Owner request (with screenshots): mid-flight on a phone the screen was a pile-up — HUD readouts, the dashboard strip, the touch controls, contact tags, and worst the browse StatusBar (LIVE feed · CONTACTS · RADIUS · MAP SAT · LABELS · full attribution) still shown at the bottom eating ~1/4 of the view, all overlapping. Wanted "a full screen mode in mobile without any extra clutter", "true fullscreen like a video".

- **One gate, desktop untouched.** `isImmersiveActive(requested, narrow, mode)` (pure, `layout/immersive.ts`) = the toggle is on AND the viewport is narrow AND `mode === "FLYING"`. Every declutter keys off it, so desktop (`narrow === false`) and browse/paused/ended keep the full chrome byte-for-byte. Held in the store (`immersive`, like `basemap`/`labelsOn`) because StatusBar is a flex sibling of the viewer and FlightSession is deep inside it — the store is their only shared channel.
- **What's HIDDEN in immersive:** the browse StatusBar controls (CONTACTS chip, RADIUS/MAP/LABELS buttons, UTC clock, terrain-tier chip — `statusBarRegions(immersive)`), and the whole dashboard strip (it overlapped the touch button row). The strip returns on PAUSED/ENDED and in non-immersive flight.
- **What's KEPT, always (honesty + SIM + safety — never dropped):** the imagery/terrain + traffic-source attribution (StatusBar collapses to feed-status + `attributionFor(...)`, and the HUD keeps its own attribution line), the SIM banner + amber accent + `SIM-<hex>` callsign, and the warnings cluster (OVERSPEED etc.).
- **HUD repositioned clear of the touch zones** (stick bottom-left, throttle right edge, button row bottom-centre): in immersive the left/right readout stacks move up into the top band (`top: 80px`) and the control line (THR/FLAPS/GEAR/SKY) moves from the bottom (where it overlapped the buttons) to under the heading (`top: 72px`). CSS-only, gated by a `.hud-immersive` class the JS adds only on mobile — no media query, desktop never sees it. The exact px clearances are eyeball-tunable on a real device (flagged).
- **True Fullscreen API, honest iOS degradation.** ENTER calls `element.requestFullscreen()` on the app root (the same call a `<video>` uses) — Android Chrome / desktop truly hide the browser UI; a `fullscreenchange` listener flips the toggle back if the user swipes out. iOS Safari (iPhone) has NO `requestFullscreen` on a canvas: `fullscreenSupported()` returns false, the call is a silent no-op (no error, no crash), the in-app declutter carries the mode, and a minimal one-time dismissible "Add to Home Screen for fullscreen" hint offers the only real chromeless view iOS gives a web app — a standalone PWA (added `apple-mobile-web-app-capable` + `manifest.webmanifest` with `display: standalone`). The hint is suppressed once installed (`isStandalone` via `navigator.standalone` / `matchMedia('(display-mode: standalone)')`).
- **Video-player auto-hide.** While actively FLYING in immersive, the informational overlays (attribution, HUD readouts, SIM banner, feed-status) fade to opacity 0 after ~3s idle and reappear on ANY tap. The decision is pure and unit-tested: `overlaysVisible(mode, msSinceLastInteraction, warningActive)` — always visible when not FLYING (so attribution is always shown in browse and when paused: the CC BY 4.0 / Esri legal safeguard, since auto-hide is only acceptable because it reliably reappears), always visible while a warning is live (safety overrides the fade), otherwise hidden past the idle timeout. Attribution is only FADED via opacity, never removed from the DOM. The flight controls are a separate layer and never auto-hide (they may dim but stay usable).
- **Minimal transparent touch control set (owner refinement).** Reduced the mobile on-screen controls to five: virtual stick, throttle slider, GEAR (inert on fixed-gear), FLAPS −/+, and a NEW TRIM ▼/▲ (hold, synthesizing Comma/Period — the keyboard's trim-lever keys, via the same Option-A seam). Dropped rudder L/R, afterburner, level-assist, and the pause button from the mobile UI. Restyled to faint 1px cyan outlines at low opacity (`touch-btn-ghost`), stick/throttle backgrounds made see-through — "barely obscuring the view". NOTE: pause was removed from the mobile touch UI per this instruction; a corner pause affordance may be wanted later (Escape still works from a keyboard, and the app still auto-pauses on tab-hide).
- **Cannot verify without a device:** the actual on-phone no-overlap, that Android Chrome truly hides the URL bar, the iOS no-op degrade + Add-to-Home-Screen standalone view, and the fade/reappear timing on a touch surface. All browser-verified logic is pure/unit-tested; the pixel layout and real fullscreen behaviour need a real phone.

## 2026-08-07 — #13 · Single dense immersive top status bar (immersive HUD)

Owner follow-up: in immersive mobile flight the essential instruments (alt/speed/heading) were scattered in corner clusters and — worse — fade away with the video-player auto-hide, so you can't read your instruments while flying. Replace the scattered immersive readouts with ONE dense translucent status bar pinned to the top edge (the only edge the touch controls leave free: stick bottom-left, throttle right, buttons bottom-centre).

- **New component `hud/ImmersiveHudBar.tsx`**, rendered by `Hud.tsx` ONLY in its `immersive` branch (the existing `isImmersiveActive` gate). Desktop / non-immersive keep the exact same scattered-cluster tree as before — the immersive branch is a separate early return, so the desktop path is byte-for-byte unchanged (locked by a Hud test asserting `hud-left`/`hud-right` still render off-immersive and `imm-bar` does not).
- **Fields chosen (dense, one strip, in reading order):** ALT (FT), IAS (KT), HDG, VSI (FPM), AGL (FT), AOA (°), G. AOA and G are last on purpose — they are the first to drop by eye if the strip is too wide on a real phone. A pure helper `immersiveBarFields(snapshot)` does the selection and routes EVERY value through the shared `hud/format.ts` formatters (no reimplemented formatting; unknown → em-dash, same honest-data rule as the rest of the HUD). Unit-tested with a broken-arm em-dash case.
- **Attitude indicator reused, not rewritten.** Extracted the six-pack's artificial-horizon SVG verbatim into `dashboard/AttitudeIndicator.tsx` (`snapshot` + `attitudeStyle` in, same `attitudeRollDeg`/`attitudePitchOffsetPx` geometry from `gaugeMath.ts`). `SixPack` now renders `<AttitudeIndicator>` in place of its inline block, and the bar renders the same component small (32px, viewBox scales). One geometry → the dial and the bar can never disagree about attitude. `clipId` is a prop so the two instances never collide on a duplicate SVG id (they never co-exist anyway — the dashboard strip is hidden in immersive — but it's cheap correctness). Locked by asserting the exact `rotate(-30 60 60)` string in both the AttitudeIndicator and the bar tests (broken-arm against a hand-rewrite).
- **SIM folded into the bar (SIM-unmistakable, compactly).** The bar carries the amber `SIM` badge (`hud-sim-badge`) + `SIM-<hex>` callsign + class at its left end, divided by a 1px amber border. This is what lets the big separate SIM banner drop in immersive mode without ever losing SIM-unmistakability — the amber accent stays on-screen. Test asserts the badge class + callsign + class text are present.
- **The bar STAYS visible — it is essential instrumentation, NOT chrome.** Unlike the attribution (which keeps its video-player auto-hide via `.hud-immersive.hud-faded .hud-attribution`), the bar is deliberately excluded from the fade set, so alt/speed/heading remain readable while flying. Warnings (OVERSPEED etc.) still surface in the bar (safety). Locked by a test asserting `imm-bar` is still rendered when `faded: true`.
- **Replaced (not added to) the old immersive CSS.** Removed the now-dead `.hud-immersive .hud-left/.hud-right/.hud-bottom` reposition rules and the multi-selector cluster fade; replaced with `.imm-bar*` styling (LORAN: near-black rgba(5,7,10,0.72) translucent, cyan values, amber SIM/warnings, monospace uppercase labels, 1px border, no radius, no shadow, dense spacing) + attribution-only fade. `attitudeStyle` threaded `FlightSession → Hud → bar` from the already-computed `originParams` (falls back to `"line"`).
- **Cannot verify without a device:** on-phone legibility and whether all 7 fields + the mini ADI + SIM block fit one line without wrapping on a real phone width, the mini-ADI size (32px — may want bigger/smaller by eye), and the bar height/opacity. All logic (field selection, formatting, geometry reuse, immersive gating, stays-visible) is pure/unit-tested; the pixel layout is browser-build-verified only and needs a real phone.

## 2026-08-08 — #13 · Dashboard is desktop-only (no dashboard on mobile)

Owner directive: "Don't bother to render dashboards on mobile. Mobile should focus on the
immersive experience, minimal clutter on the flying view." The cockpit DashboardStrip now
renders only on a WIDE (non-narrow) viewport: `{!immersiveActive && !narrow && <DashboardStrip/>}`
in FlightSession. On a phone the flight UI is the minimal immersive path only (ImmersiveHudBar
top status bar + minimal transparent touch controls + auto-hide) — no multi-panel dashboard, no
COCKPIT chip. Desktop non-immersive flight is unchanged. The forthcoming unified-glass per-class
dashboard is likewise a desktop-only feature.
## 2026-08-08 — deep-link auto-takeover (`?takeover=<hex>`)

LORAN needs to deep-link a user straight into flying a selected aircraft. Fixed protocol
string (the LORAN side is being built to match): `https://adsb.voygent.app/?takeover=<hex>`
where `<hex>` is the lowercase ICAO 24-bit hex of an aircraft currently on the live feed. On
load the app auto-selects that contact and takes control of it — no manual select+click.

- **Split pure vs wiring.** `takeover/urlTakeover.ts` is the pure, unit-tested decision layer:
  `parseTakeoverHex(search)` (normalize/validate to `^[0-9a-f]{6}$` → lowercase hex | null),
  `evaluateTakeover(contact, eligibility)` (absent | ineligible+reason | take), and
  `takeoverFallbackMessage(...)` (the honest not-in-feed vs ineligible text). The browser
  wiring is `takeover/useUrlTakeover.ts` (a hook) — DOM/history/store/subscription — and is
  browser-verified, not jsdom-tested (repo has no jsdom; §8 style).
- **Reuses the ONE take-control path, does not fork it.** On the poll where the target hex
  appears AND passes `checkEligibility`, the hook drives the SAME store actions as the
  ContactList TAKE CONTROLS button: `select(hex)` → `setOrigin({hex, snapshot: {...contact}})`
  (snapshot frozen NOW, since the next `applyFetch` nulls `selectedHex` the instant the contact
  leaves the feed — spec §4) → `fire("TAKE_CONTROLS")`. Eligibility is the unchanged physical
  gate; no takeover-specific eligibility.
- **Feed-wait + timeout.** The target may take a poll cycle or two to appear, so the hook
  subscribes to the store and re-checks every `applyFetch`. `TAKEOVER_TIMEOUT_MS = 18000` (~a
  couple of 5 s poll cycles plus slack). Absent/ineligible → keep waiting (a taxiing plane may
  take off) until the window closes.
- **Honest fallback, never synthesized (ground rule #1).** If the hex never appears, or is
  present-but-ineligible when the window closes, we fall back to BROWSE (no takeover) with the
  contact selected if present, and show an amber LORAN-style banner (`.takeover-banner`:
  near-black translucent, 1px amber border, uppercase mono) naming why —
  `TAKEOVER TARGET <HEX> NOT IN FEED` or `TAKEOVER TARGET <HEX> INELIGIBLE — <REASON>`. We NEVER
  fabricate a contact to force a takeover; the only synthesized object remains the player SIM,
  produced solely by this real eligible path.
- **Fires ONCE.** A `done` latch (set BEFORE the store mutations, which re-enter the
  subscription synchronously) plus unsubscribe guarantee single-fire across re-renders and
  later polls. The auto-take is also gated to `mode === "BROWSE"` so it never hijacks a user who
  already moved on.
- **Clears the URL after handling.** On reaching a terminal state (takeover fired OR fallback
  shown) the hook removes only the `takeover` param via `history.replaceState`, preserving any
  other params — so a manual reload does not silently re-take-over. The hex is captured in a
  closure before clearing, so clearing cannot disrupt an in-flight decision.
- **No-param behaviour unchanged.** With no `?takeover`, `parseTakeoverHex` returns null and the
  hook does nothing (returns null, mounts no subscription/timer) — desktop and normal load are
  byte-identical to before. No new dependencies.
- **Cannot verify without a browser:** the real LORAN→adsb-game deep-link round-trip (a live
  URL landing a real eligible feed contact into flight, the fallback banner on a bad/absent hex,
  and the URL-param clear) needs a browser. All decision logic is pure/unit-tested (15 new
  tests); the App/effect wiring is build- and typecheck-verified.

## 2026-08-08 — #15 · Exterior/chase aircraft model: wireframe -> solid flat-shaded low-poly

Owner directive ("the chase-cam wireframe is OK, but can we do better visually?" -> chosen: solid
flat-shaded low-poly FIRST; real glTF is a LATER pass, explicitly NOT now). The player (exterior
view only) and the ghost (always) now render as a solid shaded aeroplane instead of an amber/cyan
outline. Supersedes the 2026-08-07 #4+#15 "render mechanism = PolylineCollection wireframe" call;
everything else in that entry (per-class dims, chase/orbit math, ghost styling intent, KeyE toggle,
honesty) is unchanged.

- **Triangle-mesh generator (pure, data-not-branches):** `globe/aircraftGeometry.ts` now emits a
  small CLOSED low-poly `Triangle[]` from the SAME `ModelDims` record — no `if (class===…)`. Shapes:
  fuselage = square-section box tapered to a nose point and a tail point; wing + tailplane = one thin
  extruded slab each (constant-chord planform, tips swept aft by `tan(sweep)·semispan`, so the C172's
  straight wing vs the jets' swept wing is geometric, not a flag); fin = a thin triangular slab. A
  generic `prism(loop, offset)` builds the lifting surfaces/fin; the fuselage has its own nose/tail
  caps. ~64 triangles per aircraft — deliberately low-poly and legible. `sim/` stays Cesium-free.
- **Winding is load-bearing and unit-proven.** Flat shading only reads if every face normal points
  OUT, so the mesh is wound counter-clockwise-from-outside and is watertight. Broken-arm tests
  (`aircraftGeometry.test.ts`, 9 tests): bounding box pins length/span/fin to dims; mirror-Y pins
  symmetry; **manifold-closed** (every directed edge matched by its reverse exactly once) pins a
  hole-free, consistently-wound surface; **positive signed volume** (divergence theorem, checked for
  all three classes) pins OUTWARD orientation — reverse the winding and it goes negative (this
  actually caught my first, globally-inward convention). Swept-vs-straight tip and size-ordering
  pinned too. The class→dims map stays data (`aircraftModelDims.test.ts`, unchanged).
- **Cesium primitive/appearance chosen: `Primitive` + `GeometryInstance` + `PerInstanceColorAppearance`
  ({flat:false, closed:true}), NOT lines and NOT glTF.** Rationale: it is the cleanest zero-dependency
  way to draw a filled, lit solid. The body-frame mesh is baked ONCE into flat-shaded geometry — each
  triangle carries its own 3 vertices with the face normal (per-face duplication = faceted, no
  smoothing) — and each frame only the Primitive's `modelMatrix` is set from position + attitude
  (`Matrix4.fromTranslationQuaternionRotationScale`). This replaces the old per-frame per-segment
  vertex rebuild: vertices never move, the GPU rotates the whole solid. `closed:true` back-face-culls
  the watertight solid. Non-flat `PerInstanceColorAppearance` shades facets by normal from ONE base
  colour, giving the "dark-metal" gradient for free.
- **Player amber vs ghost cyan — still unmistakable.** `SIM_MODEL_STYLE` = solid amber `#ffb000`
  (opaque); `GHOST_MODEL_STYLE` = cyan `#5fd7e0` @ 0.6 alpha (translucent). Same shading, different
  base hue + opacity: the real aircraft can never be read as the player's SIM amber. SIM banner /
  accent / `SIM-<hex>` untouched; the model renders only real sim/feed pose, no data synthesized;
  exterior view is camera-only, never touches ControlVector or sim state.
- **glTF-deferred seam:** `createAircraftModel` is now typed as one `AircraftModelProvider`
  `(viewer, classId, style) => AircraftModel`. A future glTF model would build a Cesium `Model`,
  implement the same `AircraftModel` interface (update/setVisible/destroy), and drop in with no change
  to the host (`cesiumFlightHost.ts`) or ghost (`ghostModel.ts`), which both call through the
  interface. NOT built now (owner-deferred).
- **Not unit-tested (browser-verified, owner tuning by eye):** whether the shaded 3D solid actually
  reads well on screen — facet/poly detail, the flat-shading lighting intensity/direction, the amber
  "dark-metal" gradient and the ghost cyan translucency, and the thin-surface thicknesses (wing/tail
  `chord·0.09/0.12`, fin `chord·0.12`) — needs a real browser and the owner's eye. The pure shape and
  winding are proven; the LOOK is not. Tests 915 -> 917 (+2 net), tsc clean, build succeeds.
## 2026-08-08 — Unified glass cockpit + per-class instrument profiles (desktop-only redesign)

Replaced the desktop cockpit's five separate PanelFrames (INSTRUMENTS six-pack · RADAR ·
NAVMAP · WEATHER · CONTROLS) with ONE "unified glass" panel: per-class PRIMARY instruments left,
a merged TACTICAL map right, a control-state strip bottom, weather/controls behind folds. Owner
chose layout C (unified glass) + basic per-class layouts now; the realistic/skeuomorphic
dashboard ART is DEFERRED to a later pass — this build is the FUNCTIONAL vector layout in LORAN
style.

- **Class → dashboard-profile registry is DATA, not branches** (`dashboard/profiles.ts`, mirrors
  `sim/params.ts::loadClassById`). `profileForClass(classId)` returns `{ classId, primary, background }`
  by table lookup; a second data table in `UnifiedGlass.tsx` (`PRIMARY_COMPONENTS`) maps the
  `primary` KIND → component. No `if (class === "...")` in any render path. Resolved through the
  same `resolveClass(origin.snapshot).classId` + `loadClassById` path DashboardStrip already used.
  Unknown class id throws (a missing profile is a bug, not data). Three profiles: c172s→sixpack,
  b738→efis, f5e→hud.
- **Per-class primaries.** c172s REUSES `SixPack.tsx` verbatim (analog six-pack, DG). b738 =
  new `EfisDisplay.tsx`: REUSED `AttitudeIndicator` ball + new moving speed tape (Vfe/Vno/Vne
  bugs) + altitude tape (flight levels) + heading + Mach + config strip. f5e = new
  `HudDisplay.tsx`: boresight/gun cross, REUSED gaugeMath pitch/roll ladder, new velocity-vector
  (flight-path marker), heading scale, prominent G/AOA/Mach, A/B DRY/WET annunciator. All three
  share the `({snapshot, params})` signature and are hook-free (testable via collectText/collectProp,
  no jsdom). New needle/tape/ladder math is pure and unit-tested in `dashboard/glassMath.ts`.
- **Merged tactical map = NavMap.** The old RADAR (heading-up PPI) and NAVMAP (north-up
  geographic) collapse to ONE geographic map. NavMap already renders the radar's traffic (it
  calls `radarMath.blipsFor` via `navMath.navContacts`) plus airports, range rings, own-ship and
  the range selector — so it IS the combined tactical picture. The redundant heading-up scope is
  retired; `RadarScope.tsx`/`radarMath.ts` live on inside NavMap (RadarScope is now unused by the
  dashboard but kept + still tested — flagged dead code, not deleted).
- **Control-state strip** REUSES `ControlState.tsx` verbatim (THR/FLAPS/TRIM/GEAR) and appends
  VSI + AGL from the same `hud/format` formatters (`formatVsiFpm`, `formatClearanceFt`).
- **Realistic-art seam.** `DashboardProfile.background` is applied inline to `.glass-primary`
  and is `"transparent"` for every profile now (LORAN vector language only). The later art pass
  swaps a per-profile texture/gradient there and nowhere else — the functional layout is unchanged.
- **Honesty preserved.** Real snapshot values only; unknown → em-dash (all new formatters
  `dash()`-guarded); primaries show `— NO SIGNAL` when the snapshot is null. The F-5E A/B
  annunciator is driven by a NEW optional `HudSnapshot.afterburner` (populated from the already-
  modeled `ControlVector.afterburner` in `flightLoop.publish`); optional so no existing snapshot
  fixture needed rework, and a null/absent value reads DRY (burner off), never a fabricated WET.
  The airliner config strip shows THR% honestly (N1 is NOT modeled) — flagged for owner tuning.
- **Desktop-only, mobile untouched.** DashboardStrip stays the entry component and keeps its
  FlightSession gate `{!immersiveActive && !narrow && <DashboardStrip/>}`, the KeyC open/hide +
  Slash help toggles, and `stripMountedForMode`. The mobile immersive path (top status bar +
  touch controls + auto-hide) was not touched. No new dependencies.
- **Tests.** DashboardStrip's old five-panel PANEL_IDS/collapse/scopeRange API and tests were
  reworked to the new lifecycle; new tests cover the registry (data, no branch), each profile's
  distinguishing element (six-pack ASI/DG · EFIS Mach+speed tape · HUD velocity-vector+G/AOA),
  the merged tactical (traffic + own-ship + airport), and unknown→em-dash. 915 → 937 passing.
- **Cannot verify without a browser:** the on-screen unified-glass LAYOUT (tape/ladder sizing,
  the primary/tactical split, fold placement, per-class faces rendering correctly over live
  flight) needs a browser. All selection + instrument math is pure/unit-tested; wiring is build-
  and typecheck-verified.

## 2026-08-08 — WX-001 · Precip radar source is RainViewer, not Iowa-State NEXRAD (issue #17)

The NavMap precipitation overlay uses **RainViewer's** public weather-maps API
(`api.rainviewer.com/public/weather-maps.json` → keyless, global, CORS-open). LORAN's radar
uses Iowa State's NEXRAD mosaic, which is **US-only** — wrong for a globe seeded from live
ADS-B anywhere on Earth. RainViewer is global and keyless, so it is the honest fit. Radar only;
no METAR-text panel here (that already exists as WeatherPanel). Only `radar.past` (observed)
frames are used — `nowcast` (model forecast) is deliberately ignored so we never paint predicted
precip as measured. Attribution `WEATHER © RAINVIEWER` shown only while the overlay is active.
Verified browser-direct: both the manifest and the tiles return `access-control-allow-origin: *`,
so tiles load crossOrigin='anonymous' (untainted canvas, real pixels readable) and NO backend
proxy was needed — unlike the ADS-B/METAR feeds, which are proxied.

## 2026-08-08 — WX-002 · Correct mercator→nav-polar reprojection, NOT a flat-paste (issue #17)

The NavMap is a north-up, own-ship-centred, **linear-range NM polar** plot (`navMath.navXY`);
RainViewer tiles are Web-Mercator raster and are not pixel-compatible with that face. The cheap
"treat the tiles as locally planar and paste them under the rings" hack implies a precision the
projection does not have at 50–200 NM ranges — a violation of the only-real-data ground rule in
spirit (it would misplace precip against the airports/traffic it sits under). Chosen instead: a
true per-pixel reprojection — for each output pixel inside `NAV_RADIUS_PX`, invert `navXY` to
(range,bearing), run the spherical direct geodesic to a dest lat/lon, project that to a
Web-Mercator world pixel, and sample a composited tile canvas. The warp leaves out-of-circle
pixels transparent (its own clip). Pure math lives in `navWeatherMath.ts` (unit-tested,
broken-arm style — a wrong warp fails the tests, not just a blank render); the impure canvas
compositing/sampling is in `NavWeatherLayer.tsx`, behind the same test boundary as the Cesium
code (build + live browser, not jsdom). Zoom is capped at `RADAR_MAX_Z=7` so a small range never
upscales a coarse tile into false precision — the chip says COARSE when the cap bites. WX toggle
REUSES the existing `showWeather` glass toggle (off by default); a fresh frame reads cyan, any
offline/stale/coarse state reads amber and says NO RADAR FEED (distinct from ADS-B's TRAFFIC
FROZEN). **Cannot verify without a browser:** the on-canvas overlay pixels rendering/aligning over
live imagery — the warp math and offline states are unit-tested; the canvas glue is build-verified.

## 2026-08-08 — MODEL-003 · Route B procedural silhouettes over glTF; per-type wing placement, nacelles, taper (issue #15)

The three exterior-cam airframes (C172 / 737 / F-5) read as "one blob" because the low-poly mesh
put every wing on the fuselage centreline, gave no engines, and used constant-chord wings. Chose
**Route B (procedural, data-driven geometry) over glTF assets**: the render layer flat-tints the
whole airframe a single amber (player) / cyan (ghost), which DISCARDS any glTF texture, so an
imported model would contribute only silhouette — exactly what we get here with zero external
assets, licenses, or new deps, and the mesh stays pure/Cesium-free/watertight/unit-testable.
Added three DATA fields to `ModelDims` (never a `if (classId===)` branch): `wingZFrac` (signed
fraction of fuselageRadius — C172 high `-1.0`, 737 low `+0.9`, F-5 low/mid `+0.3`; the biggest type
cue), optional `engine {count, spanFracs, lengthM, radiusM}` (two podded underwing nacelles slung
below+ahead of the 737 wing — ABSENT on c172s/f5e means no nacelle, data not branch), and
`wingTipChordFrac` wing taper (C172 `0.95` near-constant, 737 `0.35`, F-5 `0.4` trapezoidal). Each
nacelle is a closed square-section box wound outward like the fuselage; the tailplane stays on the
centreline and constant-chord. **Cannot verify without a browser (no X server):** the geometry
INVARIANTS (watertight, positive signed volume / outward winding, per-feature broken-arm tests)
are unit-tested and green; the actual on-screen LOOK is owner-eyeballed on deploy (exterior cam,
press E). The SIM machinery and the amber/cyan single-instance ghost tint are geometry-independent
and untouched.

## 2026-08-10 — CF-001 · Keep `frontend/` as the single Cloudflare application root

The existing React application and the new TypeScript Worker build and deploy from
`frontend/`; there is no parallel replacement application. The Cloudflare Vite plugin owns
the Worker-plus-assets production build and `npm run dev:worker` development path. The old
Python-proxied `npm run dev` remains temporarily as Vite `legacy` mode until the API port is
complete, and unit-test mode deliberately does not load the Cloudflare plugin.

Static files remain assets-first at the platform boundary. `/api`, `/api/*`, and `/admin*` run
the Worker first; the Worker delegates non-API fallback requests to `ASSETS`, while unknown
`/api/*` paths return JSON 404s instead of SPA HTML. Direct handler tests cover that
delegation boundary, and a checked-in Wrangler harness exercises the built Vite application,
including the exact `/api` root, an SPA route, and a hashed asset.

Configuration has distinct local, staging, and production `APP_ENV` values and repeats the
non-inheritable `AUTH_EMAIL` and destination-restricted `ALERT_EMAIL` bindings in every
environment. It contains no resource IDs, credentials, or real-send test path. Environment
selection happens before bundling: staging uses `CLOUDFLARE_ENV=staging npm run build`, then
plain `wrangler deploy` follows Vite's generated config redirect rather than rebuilding under
a different environment. The compatibility date is pinned to 2026-08-08, the latest date
supported by the approved local workerd build at implementation time.

The verified before/after shell migration measurements are:

- Before: Vite 5/Vitest 2; 78 files and 975 tests; typecheck and build green; main JavaScript
  bundle 4,840.09 kB raw / 1,304.49 kB gzip; audit 7 findings (4 moderate, 2 high,
  1 critical).
- After: Vite 7.3.6/Vitest 4.1.10; the same 78 files and 975 tests; app/Worker typechecks,
  Worker and platform-routing tests, lint, and Cloudflare production build green; client
  JavaScript bundle 4,915.23 kB raw / 1,305.69 kB gzip. The two remaining transitive
  advisories were resolved within their existing dependency ranges (DOMPurify 3.4.13
  through Cesium and nanoid 3.3.18 through PostCSS); the final audit is clean and no
  force-fix was applied.

The planned `typescript-eslint` 8.66.0 release is not compatible with this repository's
Node 22.12.0 runtime: its visitor-keys chain selects `eslint-visitor-keys` 5.0.1, whose
engine floor is Node 22.13.0. Pin 8.55.0 instead, the newest checked compatible line; it
selects `eslint-visitor-keys` 4.2.1 and installs without an engine warning. Existing
explicit-`any`, mixed component/helper exports, and intentional hook dependency warnings
are lint baselines for later focused cleanup, not reasons to rewrite tested simulator code
during the Cloudflare shell migration.

Node `>=22.12.0` and npm 11 are declared because Wrangler 4 requires Node 22 and Vite 7
requires the 22.12 runtime floor. Lint starts with eight pre-existing hook warnings and uses
`--max-warnings 8` as a ratchet so new warnings fail the Task 1 gate without forcing unrelated
simulator rewrites. The old Docker/nginx build expects `dist/index.html`, while the Cloudflare
plugin correctly emits `dist/client`; Docker Compose is therefore explicitly unsupported on
this migration branch until its Task 18 retirement rather than being advertised as green.
