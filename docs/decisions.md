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
