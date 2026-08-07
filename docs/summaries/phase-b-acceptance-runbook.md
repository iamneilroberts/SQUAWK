# Phase B acceptance runbook — owner sign-off walkthrough

Servers are already running (`bash scripts/dev.sh` if not). Open http://localhost:5173.
Screenshot each checkpoint. Source: plan Task 12 step 9 + StrictMode debt from Task 8.

  1. **Browse** — globe over Esri imagery with real terrain relief; contacts appear at their real altitudes (tilt the camera and confirm they sit above the ground, not buried in it); status bar reads `LIVE <source>` and names the terrain source.
  2. **Gate** — select a non-GA contact (an airliner). TAKE CONTROLS is disabled and states the gate: `TYPE B738 NOT GA PISTON`. Select a military contact if one is up: `MILITARY CONTACT`.
  3. **Handoff** — select a real GA contact (C172/P28A/SR22/…). TAKE CONTROLS enables. Click it. The card shows the callsign, hex, the **real** type from the feed, the snapshot altitude/speed/heading, `SIM-<HEX>`, `C172 MODEL THIS BUILD`, the ground-speed-as-TAS disclosure, and either `NO ADJUSTMENTS` or the clamps verbatim.
  4. **Countdown** — `ACQUIRING TERRAIN…` then 3 · 2 · 1. If terrain does not resolve in 3 s, the card says `TERRAIN UNVERIFIED — COLLISION DISARMED` and the HUD carries that warning throughout.
  5. **Handover fidelity** — at the instant control passes, the throttle is NOT at idle and the aircraft is not lurching: it holds roughly the snapshot speed and altitude hands-off for the first few seconds. That is `buildSpawnState`'s trimmed handover reaching the control sampler.
  6. **HUD content** — the SIM banner carries `SIM` + the class (`C172S`) + `SIM-<HEX>`; heading reads as three digits and wraps 359→000 rather than showing 360; IAS/TAS/ALT/VSI/AGL/AoA/G/THR/FLAPS/GEAR all read and move; `GEAR FIXED`; the attribution line names Esri and Re:Earth/Mapterhorn.
  7. **Flying** — the view is first-person from the cockpit. Fly a circuit: pitch, roll and rudder all respond; `W` spools the throttle; `F` steps the flaps and the stall speed drops; `,`/`.` trims and the aircraft settles at a new speed hands-off. **Check the roll sign**: `→` must put the right wing down and the horizon must tilt the same way. If it is mirrored, fix the sign in `hprFromQuat`/`quatFromHpr` — never by inverting the input.
  8. **Ghost** — the real aircraft is still on the globe, dimmed, labelled `GHOST · AGE nS`, and diverging from you. Other live traffic is still rendering.
  9. **Warnings** — pull to the stall and confirm `STALL` fires and the break is soft (mushy, recoverable) rather than a cliff. Dive toward terrain and confirm `TERRAIN` fires under 500 ft of clearance.
  10. **Pause and the two-step resume** — `Esc` shows the overlay and the sim stops (airtime stops advancing). Press RESUME: the overlay steps aside and reads `CLICK THE GLOBE TO RESUME`, and the sim is **still paused**. Click the globe: flight continues with no jump. Alt-tabbing away auto-pauses. (This is spec §6's canvas-click resume — a one-click RESUME would be the regression to watch for.)
  11. **End** — land it gently (under 600 fpm, wings level, near stall speed) or fly it into a hill. The stats card shows the classification, airtime, distance, max IAS/alt/g and the impact sink and speed. **Drag the mouse: the site orbits.**
  12. **Quit, twice** — EXIT TO BROWSE. The globe returns to the browse view, the contact list is back, the ghost dimming is gone, the HUD is gone, the mouse controls the globe again, and the feed is still LIVE. Then take controls of a **second** contact and fly it: nothing from the first session leaks in (no stale ghost, no stuck key, no carried-over stats, no doubled loop).

  13. **StrictMode single-instance (Task 8 debt)** — on first load, open devtools: exactly one stream of /api/adsb polls (~1/s, not 2/s), no Cesium double-Viewer errors, no leaked-listener warnings after a full fly-quit cycle.

---

## Cockpit dashboard addendum (checkpoints 14–25)

Source: the cockpit-dashboard plan, Task 6. Same rules as above — servers already running,
screenshot each checkpoint, stop at the end and wait for sign-off.

  14. **The strip is there** — take controls of a GA contact and fly. A bottom strip carries, left
      to right: INSTRUMENTS, RADAR, WEATHER, ATC, CONTROLS. Every panel header has a `[-]`; click
      one and only that panel folds, its title still visible. Press `C`: the whole strip collapses
      to a single `COCKPIT [C]` chip. Press `C` again: it comes back **with your folds intact**.
  15. **The six-pack tracks the HUD** — the ASI needle and the HUD's `IAS` agree; the altimeter
      drum and the HUD's `ALT` agree digit for digit; the DG's window and the HUD's `HDG` agree
      including the 359→000 wrap. Climb: the VSI needle rises and the HUD's `VSI` goes positive
      together. **If any pair disagrees, that is a bug in `gaugeMath.ts`, not a rounding quirk** —
      they read the same snapshot through the same formatters.
  16. **The attitude indicator matches the real horizon** — roll right: the drawn horizon tips the
      opposite way and the real horizon out the windscreen does the same thing. Pitch up: the
      horizon drops. Peg the VSI in a dive (past 2000 fpm down): the needle sits on the stop, turns
      amber, and a `PEG` legend appears — it does not sit quietly at the bottom pretending.
  17. **The slip ball's sign** — in level flight, hold **right rudder**. The ball must fall to the
      **LEFT** ("step on the ball" = you would push right rudder to re-centre it). If it is
      mirrored, flip `SLIP_BALL_SIGN` in `dashboard/gaugeMath.ts` — **never** by negating the
      snapshot or the component.
  18. **The turn coordinator** — roll into a steady turn and hold the aeroplane symbol on the
      index. Time 360° of heading change: it should take about 2 minutes (standard rate). Rolled up
      steeply on a wingtip with the nose coming through, the symbol must NOT swing wildly — it
      reads rate of turn about the vertical, not body yaw rate.
  19. **Windscreen tags are real traffic** — with the feed LIVE, fly toward another contact.
      A compact tag appears over it carrying callsign (or hex), type, and altitude in feet. It
      **moves with the aircraft** and **disappears when the contact leaves the feed** — no ghost
      tag left behind. Turn away: the tag disappears when the contact leaves the frame.
  20. **The detail card** — click a tag. A LORAN card opens on the right with the feed's own
      fields, then the adsbdb block resolves. Confirm the three adsbdb states are distinguishable
      by finding: (a) an aircraft adsbdb knows (type/manufacturer/registration filled), and (b) an
      obscure hex where the card reads `NO ADSBDB RECORD FOR THIS HEX`. Then **stop the backend**
      (`docker compose stop backend` or Ctrl-C the uvicorn) and click another tag: the card must
      read `ADSBDB UNREACHABLE — ENRICHMENT UNKNOWN`, not `NO ADSBDB RECORD`. Restart the backend.
  21. **The radar shows the same traffic** — the blips on the scope are the same aircraft the
      windscreen is tagging. Own ship is the amber mark at the centre; the picture is heading-up
      (turn and the whole plot rotates with you); the ghost is the dimmed amber blip; military
      contacts are amber. Click through 10 / 40 / 80 / 150 / 250 NM: the ring labels change with
      the range and distant contacts come and go accordingly.
  22. **The radar is honest when the feed is not** — stop the backend and wait for the status bar
      to reach `OFFLINE` (three failed polls, ~15 s). The scope dims and reads
      `RADAR OFFLINE · BLIPS FROZEN` (the store keeps last-known contacts while offline, so
      "NO FEED" would claim an empty picture that isn't there — see `radarMath.ts`); the
      windscreen tags disappear. It must never show a clean, empty, nominal-looking scope.
      Restart the backend and confirm both recover.
  23. **Weather, ATC and the controls help** — both placeholder panels read
      `NO FEED · FUTURE INTEGRATION` with a one-line statement of what is planned, and contain
      **no numbers of any kind**. Press `?`: the CONTROLS panel unfolds and lists every key —
      compare it against `input/controls.ts`'s `KEYMAP` and confirm nothing is missing and nothing
      is invented.
  24. **StrictMode and the strip's key listener** — reload the page (dev build, StrictMode on) and
      take controls. Press `C`: the strip must fold **once**, not fold-and-immediately-unfold. Then
      `Esc` to pause, RESUME, click the globe, and press `C` again — still once. A doubled listener
      does not crash, it just makes the key look broken every second press, and this is the only
      thing that catches it. In devtools, confirm no listener-leak warnings after a full
      fly → quit → fly-again cycle.
  25. **Labels and the basemap** — in the status bar, click `LABELS OFF` → `LABELS ON`: place names
      appear (Esri) and airport idents appear in LORAN cyan. Zoom out past ~500 km: the airport
      labels drop away rather than turning into soup. Click `MAP SAT` → `MAP CHART`: the imagery
      becomes the dark grey canvas, **the terrain relief is unchanged**, and the camera does not
      jump. Watch the attribution line at the bottom right through all four states — it must name
      Dark Gray Canvas when CHART is on, and must mention Esri Places and OurAirports **only**
      while labels are on. Then QUIT and take controls of a second contact: the map toggles are
      still where you left them (they are preferences), and the cockpit strip is back to its
      defaults (it is not).
      **Layer-order check (no automated coverage — this needs a live Viewer):** with `LABELS ON`,
      click `MAP SAT` → `MAP CHART` → `MAP SAT` → `MAP CHART` a few times. Both place names AND
      airport idents must be visible (not just present in the attribution line) on **every**
      CHART frame, not only the first. `OverlayLayers.tsx`'s places effect re-runs on every
      basemap change specifically so the places imagery layer gets removed and re-added above the
      new basemap layer (Cesium's `imageryLayers.add()` always appends to the top of the stack) —
      if it regresses, labels silently vanish under CHART while the attribution line keeps
      crediting them, which only a rendered frame will show.
