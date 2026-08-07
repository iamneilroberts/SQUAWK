/*
 * The one place the pieces meet. It owns the mutable, non-React things a flight needs —
 * keyboard, terrain service, flight loop — creates them on entering COUNTDOWN and tears
 * every one of them down on the way back to BROWSE, so QUIT leaves no residue (spec §6).
 *
 * The countdown is load-bearing: terrain is preloaded during it, and FLYING is entered
 * either on a defined terrain sample or with collision DISARMED and TERRAIN UNVERIFIED on
 * the HUD. It never enters pretending the ground is known.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "../state/store";
import type { GameEvent } from "./machine";
import { useViewer } from "../globe/viewerContext";
import { attributionFor } from "../globe/mapSources";
import { loadC172 } from "../sim/params";
import { buildSpawnState, type SpawnResult } from "../takeover/spawn";
import { resyncDecision } from "../takeover/resync";
import { createTerrainService, type TerrainService } from "../world/terrain";
import { createKeyboard } from "../input/keyboard";
import { createCesiumFlightHost } from "../globe/cesiumFlightHost";
import { createFlightLoop } from "./flightLoop";
import { preloadTerrain } from "../globe/terrainPreload";
import { createCountdownTimer } from "./countdownTimer";
import { hudSnapshot } from "../hud/snapshot";
import { formatCallsign } from "../hud/format";
import Hud from "../hud/Hud";
import DashboardStrip, { stripMountedForMode } from "../dashboard/DashboardStrip";
import TrafficOverlay from "../globe/TrafficOverlay";
import TrafficDetailCard from "../dashboard/TrafficDetailCard";
import HandoffCard from "../panels/HandoffCard";
import PauseOverlay from "../panels/PauseOverlay";
import EndCard from "../panels/EndCard";
import { degToRad, ktToMs } from "../sim/units";

const COUNTDOWN_FROM = 3;
const PRELOAD_TIMEOUT_MS = 3000;

export default function FlightSession() {
  const bundle = useViewer();
  const mode = useStore((s) => s.mode);
  const origin = useStore((s) => s.origin);
  const endStats = useStore((s) => s.endStats);
  const basemap = useStore((s) => s.basemap);
  const labelsOn = useStore((s) => s.labelsOn);

  const [spawn, setSpawn] = useState<SpawnResult | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [note, setNote] = useState("");
  /** RESUME pressed, waiting for the canvas click that spec §6 requires. */
  const [resumeArmed, setResumeArmed] = useState(false);
  /** Hex of the windscreen tag the player clicked, or null when no detail card is open. */
  const [trafficHex, setTrafficHex] = useState<string | null>(null);
  /** Brief honest message when a re-sync is refused; "" when there is nothing to say. */
  const [resyncNote, setResyncNote] = useState("");

  const loopRef = useRef<ReturnType<typeof createFlightLoop> | null>(null);
  const hostRef = useRef<ReturnType<typeof createCesiumFlightHost> | null>(null);
  const keyboardRef = useRef<ReturnType<typeof createKeyboard> | null>(null);
  const terrainRef = useRef<TerrainService | null>(null);
  const resyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snapshot = useSyncExternalStore(hudSnapshot.subscribe, hudSnapshot.get, hudSnapshot.get);

  /** Tear down every mutable thing a flight owns. Safe to call more than once. */
  function teardown() {
    loopRef.current?.stop();
    loopRef.current = null;
    hostRef.current = null;
    keyboardRef.current?.dispose();
    keyboardRef.current = null;
    terrainRef.current = null;
    hudSnapshot.set(null);
    if (resyncTimerRef.current) {
      clearTimeout(resyncTimerRef.current);
      resyncTimerRef.current = null;
    }
    setSpawn(null);
    setCountdown(null);
    setNote("");
    setResumeArmed(false);
    setTrafficHex(null);
    setResyncNote("");
  }

  /**
   * Leaving always goes through the machine, so an event that is illegal from the current
   * mode is refused rather than teleporting the app to BROWSE from somewhere it should not.
   */
  function leaveToBrowse(event: GameEvent) {
    useStore.getState().fire(event);
    teardown();
    useStore.getState().clearSession();
  }

  // ---- COUNTDOWN: preload terrain, build the spawn, tick 3-2-1, then fly ----
  useEffect(() => {
    if (mode !== "COUNTDOWN" || !bundle || !origin) return;
    let cancelled = false;
    // Hoisted to effect scope (not returned from the async IIFE below, which is discarded —
    // `void (async () => {...})()` never surfaces an inner `return` to React) so the effect's
    // OWN cleanup can always reach it: ViewerHost replaces the `bundle` object when
    // attachTerrain resolves, and this effect used to depend on the whole object, so a click
    // on TAKE CONTROLS before that resolve re-ran the effect mid-countdown. The old interval
    // then ticked forever and the old keyboard listener leaked (see keyboardRef.dispose below).
    let countdownTimer: { cancel(): void } | null = null;
    // Distinguishes "this effect instance's countdown finished and handed off to FLYING"
    // from "it was abandoned mid-countdown": the cleanup below also fires on the normal
    // COUNTDOWN -> FLYING transition (mode is a dep), and the keyboard created here is the
    // SAME one the flight loop reads from for the rest of the flight — it must not be
    // disposed then, only when this instance's own countdown never got to start one.
    let flightStarted = false;
    const params = loadC172();
    const contact = origin.snapshot;
    setNote("ACQUIRING TERRAIN…");

    void (async () => {
      const preload = await preloadTerrain(
        bundle.viewer,
        degToRad(contact.lat),
        degToRad(contact.lon),
        degToRad(contact.track ?? 0),
        ktToMs(contact.gs ?? 0),
        PRELOAD_TIMEOUT_MS,
      );
      if (cancelled) return;

      const built = buildSpawnState(contact, params, { terrainHeightM: preload.terrainHeightM });
      setSpawn(built);
      setNote(preload.verified ? "" : "TERRAIN UNVERIFIED — COLLISION DISARMED");

      const terrain = createTerrainService(bundle.heightSampler);
      if (!preload.verified) terrain.disarm();
      terrainRef.current = terrain;

      const keyboard = createKeyboard(window);
      keyboardRef.current = keyboard;

      setCountdown(COUNTDOWN_FROM);
      countdownTimer = createCountdownTimer(
        COUNTDOWN_FROM,
        (remaining) => setCountdown(remaining),
        () => {
          setCountdown(null);
          flightStarted = true;

          const host = createCesiumFlightHost(bundle.viewer);
          hostRef.current = host;
          const loop = createFlightLoop({
            host,
            params,
            terrain,
            spawn: built,
            heldKeys: keyboard.held,
            callsign: formatCallsign(contact.hex),
            onSnapshot: (s) => hudSnapshot.set(s),
            onEnd: (stats) => {
              loopRef.current?.stop();
              useStore.getState().setEndStats(stats);
              useStore.getState().fire("IMPACT");
            },
          });
          loopRef.current = loop;
          loop.start();
          useStore.getState().fire("COUNTDOWN_DONE");
        },
      );
    })();

    return () => {
      cancelled = true;
      countdownTimer?.cancel();
      // Only dispose the keyboard this closure created if its countdown was ABANDONED
      // (bundle swap mid-countdown, or QUIT before COUNTDOWN_DONE) — not on the ordinary
      // handoff into FLYING, where the same keyboard keeps being read by the flight loop.
      if (!flightStarted) {
        keyboardRef.current?.dispose();
        keyboardRef.current = null;
      }
    };
    // Narrowed to the stable pieces of `bundle`, same reasoning as ContactLayer.tsx: the
    // bundle OBJECT is rebuilt when terrainNote resolves (~1s in) but .viewer/.heightSampler
    // keep their identity for the whole mount, so depending on the whole object would re-fire
    // this mid-countdown for a field this effect never reads.
  }, [mode, bundle?.viewer, bundle?.heightSampler, origin]);

  // ---- Esc pauses; visibilitychange auto-pauses (spec §5, §6) ----
  useEffect(() => {
    if (mode !== "FLYING" && mode !== "PAUSED") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      if (useStore.getState().mode === "FLYING") {
        loopRef.current?.pause();
        setResumeArmed(false);
        useStore.getState().fire("PAUSE");
      }
    };
    const onVisibility = () => {
      if (document.hidden && useStore.getState().mode === "FLYING") {
        loopRef.current?.pause();
        setResumeArmed(false);
        useStore.getState().fire("PAUSE");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode]);

  // ---- KeyR re-syncs to the real aircraft's CURRENT live position (issue #5b) ----
  // The live contact lives in the store (updated by the poller), not in the flight loop, so the
  // decision is made here and only a rebuilt spawn crosses into the loop. If the genuine aircraft
  // is stale, off the feed or otherwise ineligible we REFUSE and say so — never a synthesized
  // position (honesty rule). resyncDecision reuses the takeover's own eligibility + freshness gate.
  useEffect(() => {
    if (mode !== "FLYING") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyR" || e.ctrlKey || e.metaKey || e.altKey) return;
      const st = useStore.getState();
      const flown = st.origin;
      if (!flown || st.mode !== "FLYING") return;
      const decision = resyncDecision(st.contacts.get(flown.hex), loadC172(), {
        terrainHeightM: null,
      });
      if (resyncTimerRef.current) clearTimeout(resyncTimerRef.current);
      if (decision.ok) {
        loopRef.current?.resync(decision.spawn);
        setResyncNote("");
      } else {
        setResyncNote(`RE-SYNC REFUSED — ${decision.reason}`);
        resyncTimerRef.current = setTimeout(() => setResyncNote(""), 4000);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode]);

  // ---- hold Q = mouse free-look (issue #9) ----
  // FlightSession owns the canvas + DOM, so the pointer-lock / mousemove plumbing lives here; the
  // accumulator and ease-back live in the host (cesiumFlightHost). This never touches ControlVector
  // — the aircraft keeps flying its held inputs while the player swivels the view (spec §1).
  useEffect(() => {
    if (mode !== "FLYING" || !bundle) return;
    const canvas = bundle.viewer.scene.canvas;
    // Bound a single fallback-mode mousemove delta so a drag without pointer lock can't fling the
    // view; under pointer lock movementX/Y are already the small per-frame deltas we want.
    const FALLBACK_MAX_DELTA_PX = 40;
    let looking = false;

    const onMouseMove = (e: MouseEvent) => {
      if (!looking) return;
      const locked = document.pointerLockElement === canvas;
      const bound = (d: number) =>
        locked ? d : Math.max(-FALLBACK_MAX_DELTA_PX, Math.min(FALLBACK_MAX_DELTA_PX, d));
      hostRef.current?.applyLook(bound(e.movementX), bound(e.movementY));
    };
    const start = () => {
      if (looking) return;
      looking = true;
      hostRef.current?.setLookActive(true);
      // requestPointerLock needs a user gesture — the Q keydown IS one. If it's unavailable or the
      // browser refuses, we simply fall back to bounded mousemove deltas (honest degradation).
      try {
        canvas.requestPointerLock?.();
      } catch {
        /* no pointer lock — the mousemove fallback still works */
      }
      window.addEventListener("mousemove", onMouseMove);
    };
    const stop = () => {
      if (!looking) return;
      looking = false;
      hostRef.current?.setLookActive(false); // begins the ease-back to forward
      window.removeEventListener("mousemove", onMouseMove);
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyQ" || e.ctrlKey || e.metaKey || e.altKey) return;
      start();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "KeyQ") stop();
    };
    // Escape (which the browser also uses to drop pointer lock), a lost lock for any reason, or the
    // window losing focus all exit look mode cleanly rather than leaving the view stuck off-axis.
    const onPointerLockChange = () => {
      if (looking && document.pointerLockElement !== canvas) stop();
    };
    const onBlur = () => stop();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    return () => {
      stop();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
    };
  }, [mode, bundle]);

  // ---- the armed resume waits for a click on the globe itself (spec §6) ----
  useEffect(() => {
    if (mode !== "PAUSED" || !resumeArmed || !bundle) return;
    const canvas = bundle.viewer.scene.canvas;
    const onClick = () => {
      loopRef.current?.resume();
      setResumeArmed(false);
      useStore.getState().fire("RESUME");
    };
    canvas.addEventListener("click", onClick);
    return () => canvas.removeEventListener("click", onClick);
  }, [mode, resumeArmed, bundle]);

  // ---- returning to BROWSE from anywhere tears the flight down ----
  useEffect(() => {
    if (mode === "BROWSE") teardown();
    // teardown is intentionally not a dependency: it closes over refs, not state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ---- on entering ENDED, hand the mouse back so the site can be orbited (owner decision
  // B-5). The FPV camera stops driving setView because the loop has already stopped; this
  // effect is belt-and-braces on top of the loop's own stop() -> exitFlightView() ->
  // camera.exit(), which already restores enableInputs to what it was before takeover.
  useEffect(() => {
    if (mode !== "ENDED" || !bundle) return;
    bundle.viewer.scene.screenSpaceCameraController.enableInputs = true;
  }, [mode, bundle]);

  if (mode === "BROWSE") return null;

  return (
    <>
      {mode === "COUNTDOWN" && origin && (
        <HandoffCard contact={origin.snapshot} spawn={spawn} countdown={countdown} note={note} />
      )}
      {stripMountedForMode(mode) && (
        <>
          <Hud
            snapshot={snapshot}
            attribution={attributionFor({
              basemap, labelsOn, terrainNote: bundle?.terrainNote ?? null,
            })}
          />
          <DashboardStrip snapshot={snapshot} />
        </>
      )}
      {/* ENDED is deliberately excluded: the end card owns the screen and the mouse is handed
          back for orbiting (decisions B-015), so clickable tags over the impact site would
          fight that. */}
      {(mode === "FLYING" || mode === "PAUSED") && (
        <>
          <TrafficOverlay onSelect={setTrafficHex} />
          {trafficHex !== null && (
            <TrafficDetailCard hex={trafficHex} onClose={() => setTrafficHex(null)} />
          )}
        </>
      )}
      {mode === "FLYING" && resyncNote !== "" && (
        <div className="resync-note">{resyncNote}</div>
      )}
      {mode === "PAUSED" && (
        <PauseOverlay
          armed={resumeArmed}
          onArmResume={() => setResumeArmed(true)}
          onQuit={() => leaveToBrowse("QUIT")}
        />
      )}
      {mode === "ENDED" && endStats && (
        <EndCard stats={endStats} onExit={() => leaveToBrowse("EXIT_END")} />
      )}
    </>
  );
}
