/*
 * The one place the pieces meet. It owns the mutable, non-React things a flight needs —
 * keyboard, terrain service, flight loop — creates them on entering COUNTDOWN and tears
 * every one of them down on the way back to BROWSE, so QUIT leaves no residue (spec §6).
 *
 * The countdown is load-bearing: terrain is preloaded during it, and FLYING is entered
 * either on a defined terrain sample or with collision DISARMED and TERRAIN UNVERIFIED on
 * the HUD. It never enters pretending the ground is known.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "../state/store";
import type { GameEvent } from "./machine";
import { useViewer } from "../globe/viewerContext";
import { attributionFor } from "../globe/mapSources";
import { resolveClass } from "../takeover/eligibility";
import { buildLockedMissionSpawn, type SpawnResult } from "../takeover/spawn";
import { createTerrainService, type TerrainService } from "../world/terrain";
import { createKeyboard } from "../input/keyboard";
import { createCesiumFlightHost } from "../globe/cesiumFlightHost";
import { createFlightLoop } from "./flightLoop";
import { preloadTerrain } from "../globe/terrainPreload";
import { createCountdownTimer } from "./countdownTimer";
import { hudSnapshot } from "../hud/snapshot";
import { formatCallsign, warningsFor } from "../hud/format";
import Hud from "../hud/Hud";
import TouchControls from "../input/TouchControls";
import type { AnalogAxes } from "../input/analog";
import { useViewport } from "../layout/useViewport";
import { isNarrowViewport } from "../layout/viewport";
import { isImmersiveActive } from "../layout/immersive";
import ImmersiveControl from "../layout/ImmersiveControl";
import DashboardStrip, { stripMountedForMode } from "../dashboard/DashboardStrip";
import TrafficOverlay from "../globe/TrafficOverlay";
import TrafficDetailCard from "../dashboard/TrafficDetailCard";
import HandoffCard from "../panels/HandoffCard";
import PauseOverlay from "../panels/PauseOverlay";
import EndCard from "../panels/EndCard";
import { degToRad, ktToMs } from "../sim/units";
import { releaseMissionLease } from "../mission/api";
import AssistControl from "../mission/AssistControl";
import MissionNavCue from "../mission/MissionNavCue";
import MissionRouteLayer from "../globe/MissionRouteLayer";
import ApproachAssistLayer from "../globe/ApproachAssistLayer";

const COUNTDOWN_FROM = 3;
const PRELOAD_TIMEOUT_MS = 3000;

export default function FlightSession() {
  const bundle = useViewer();
  const mode = useStore((s) => s.mode);
  const lockedMission = useStore((s) => s.lockedMission);
  const assist = useStore((s) => s.assist);
  const endStats = useStore((s) => s.endStats);
  const basemap = useStore((s) => s.basemap);
  const labelsOn = useStore((s) => s.labelsOn);
  const immersive = useStore((s) => s.immersive);
  const chromeVisible = useStore((s) => s.chromeVisible);

  const [spawn, setSpawn] = useState<SpawnResult | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [note, setNote] = useState("");
  /** RESUME pressed, waiting for the canvas click that spec §6 requires. */
  const [resumeArmed, setResumeArmed] = useState(false);
  /** Hex of the windscreen tag the player clicked, or null when no detail card is open. */
  const [trafficHex, setTrafficHex] = useState<string | null>(null);

  // Touch analog axes (mobile sub-feature 2, Option B). A single mutable object the flight loop
  // reads once per tick via the `analog` provider; the touch stick/throttle write into it. Stays
  // `{}` (every axis undefined -> no override) on desktop, where TouchControls never mounts, so the
  // keyboard/sprung path is byte-identical there.
  const touchAxesRef = useRef<AnalogAxes>({});

  const loopRef = useRef<ReturnType<typeof createFlightLoop> | null>(null);
  const hostRef = useRef<ReturnType<typeof createCesiumFlightHost> | null>(null);
  const keyboardRef = useRef<ReturnType<typeof createKeyboard> | null>(null);
  const terrainRef = useRef<TerrainService | null>(null);
  const releaseKeyRef = useRef<string | null>(null);

  const snapshot = useSyncExternalStore(hudSnapshot.subscribe, hudSnapshot.get, hudSnapshot.get);

  // Touch controls render only on a narrow/touch viewport (spec §3); desktop is unaffected.
  const { width } = useViewport();
  const narrow = isNarrowViewport(width);

  // Option B writers: the stick drives pitch/roll while touched and lets go on release (undefined
  // -> the sampler springs the axes back to centre); the slider sets throttle absolutely (a lever,
  // so it persists once grabbed). Stable identities so TouchControls does not churn.
  const onStick = useCallback((roll: number, pitch: number) => {
    touchAxesRef.current.roll = roll;
    touchAxesRef.current.pitch = pitch;
  }, []);
  const onStickRelease = useCallback(() => {
    touchAxesRef.current.roll = undefined;
    touchAxesRef.current.pitch = undefined;
  }, []);
  const onThrottle = useCallback((t: number) => {
    touchAxesRef.current.throttle = t;
  }, []);

  /** Tear down every mutable thing a flight owns. Safe to call more than once. */
  function teardown() {
    loopRef.current?.stop();
    loopRef.current = null;
    hostRef.current = null;
    keyboardRef.current?.dispose();
    keyboardRef.current = null;
    terrainRef.current = null;
    hudSnapshot.set(null);
    touchAxesRef.current = {};
    setSpawn(null);
    setCountdown(null);
    setNote("");
    setResumeArmed(false);
    setTrafficHex(null);
  }

  /**
   * Leaving always goes through the machine, so an event that is illegal from the current
   * mode is refused rather than teleporting the app to BROWSE from somewhere it should not.
   */
  function leaveToBrowse(event: GameEvent) {
    if (lockedMission !== null) {
      const key = releaseKeyRef.current ?? crypto.randomUUID();
      releaseKeyRef.current = key;
      void releaseMissionLease(lockedMission.missionId, key).catch(() => undefined);
    }
    useStore.getState().fire(event);
    teardown();
    useStore.getState().clearSession();
  }

  useEffect(() => {
    if (lockedMission === null) {
      releaseKeyRef.current = null;
      return;
    }
    releaseKeyRef.current = crypto.randomUUID();
    const release = () => {
      void releaseMissionLease(
        lockedMission.missionId,
        releaseKeyRef.current ?? crypto.randomUUID(),
      ).catch(() => undefined);
    };
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, [lockedMission]);

  // ---- COUNTDOWN: preload terrain, build the spawn, tick 3-2-1, then fly ----
  useEffect(() => {
    if (mode !== "COUNTDOWN" || !bundle || !lockedMission) return;
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
    const contact = lockedMission.contact;
    const params = lockedMission.aircraftProfile;
    if (params.id !== lockedMission.classId) {
      setNote("LOCKED AIRCRAFT PROFILE DOES NOT MATCH THE MISSION CLASS");
      return;
    }
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

      const built = buildLockedMissionSpawn(
        contact,
        lockedMission.classId,
        params,
        { terrainHeightM: preload.terrainHeightM },
      );
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

          const host = createCesiumFlightHost(bundle.viewer, params.id);
          hostRef.current = host;
          const loop = createFlightLoop({
            host,
            params,
            terrain,
            spawn: built,
            heldKeys: keyboard.held,
            // Live view of the touch analog axes (Option B); `{}` on desktop -> no override.
            analog: () => touchAxesRef.current,
            callsign: formatCallsign(contact.hex),
            onSnapshot: (s) => hudSnapshot.set(s),
            onEnd: (stats) => {
              loopRef.current?.stop();
              useStore.getState().setEndStats(stats);
              useStore.getState().fire("IMPACT");
              const key = releaseKeyRef.current ?? crypto.randomUUID();
              releaseKeyRef.current = key;
              void releaseMissionLease(lockedMission.missionId, key).catch(() => undefined);
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
  }, [mode, bundle?.viewer, bundle?.heightSampler, lockedMission]);

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

  // ---- KeyE toggles the exterior chase/orbit camera (issue #4) ----
  // View-only, off by default: the toggle LOGIC lives in the host (cesiumFlightHost), so a future
  // mobile control can drive the same host.toggleExterior() without this keyboard plumbing. Never
  // touches ControlVector or the sim — it only swaps which camera the render loop drives.
  useEffect(() => {
    if (mode !== "FLYING") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyE" || e.ctrlKey || e.metaKey || e.altKey) return;
      hostRef.current?.toggleExterior();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode]);

  // ---- exterior view: drag to orbit, wheel to zoom (issue #4) ----
  // Only active while the exterior view is on; the host ignores the deltas otherwise. Uses plain
  // mouse drag (no pointer lock — this is an orbit, not a first-person swivel), so it never fights
  // the hold-Q cockpit look. Cesium's own camera inputs stay disabled during flight, so the wheel
  // is ours to consume for zoom.
  useEffect(() => {
    if (mode !== "FLYING" || !bundle) return;
    const canvas = bundle.viewer.scene.canvas;
    let dragging = false;

    const onMouseDown = () => {
      if (!hostRef.current?.isExteriorActive()) return;
      dragging = true;
      hostRef.current.setOrbiting(true);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      hostRef.current?.applyOrbitDrag(e.movementX, e.movementY);
    };
    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      hostRef.current?.setOrbiting(false); // begins the ease-back to the chase framing
    };
    const onWheel = (e: WheelEvent) => {
      if (!hostRef.current?.isExteriorActive()) return;
      e.preventDefault(); // don't scroll the page; this is a camera zoom
      hostRef.current.applyOrbitZoom(e.deltaY);
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [mode, bundle]);

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

  const originResolution = lockedMission ? resolveClass(lockedMission.contact) : null;
  const originParams = lockedMission?.aircraftProfile ?? null;

  // Mobile immersive/fullscreen flight (#13). immersiveActive gates every declutter; `faded` is the
  // video-player auto-hide of the informational overlays. warningActive keeps a live annunciator
  // visible through the fade (safety) — same warningsFor the HUD renders, so they never disagree.
  const immersiveActive = isImmersiveActive(immersive, narrow, mode);
  const faded = immersiveActive && !chromeVisible;
  const warningActive = snapshot ? warningsFor(snapshot).length > 0 : false;

  return (
    <>
      {lockedMission !== null && assist !== null && mode !== "ENDED" && (
        <>
          <MissionRouteLayer mission={lockedMission} assist={assist.current} />
          <ApproachAssistLayer mission={lockedMission} assist={assist.current} />
          <MissionNavCue mission={lockedMission} assist={assist.current} />
          <AssistControl />
        </>
      )}
      {mode === "COUNTDOWN" && lockedMission && (
        <HandoffCard contact={lockedMission.contact} spawn={spawn} params={originParams}
          matched={originResolution?.matched ?? false} countdown={countdown} note={note} />
      )}
      {stripMountedForMode(mode) && (
        <>
          <Hud
            snapshot={snapshot}
            attribution={attributionFor({
              basemap, labelsOn, terrainNote: bundle?.terrainNote ?? null,
            })}
            immersive={immersiveActive}
            faded={faded}
            attitudeStyle={originParams?.display.attitudeStyle ?? "line"}
          />
          {/* The cockpit dashboard is DESKTOP-ONLY. On mobile (narrow) it never renders at all —
              phones get the minimal immersive flying view (top status bar + minimal touch
              controls + auto-hide), no multi-panel dashboard clutter (owner directive). It also
              stays hidden in immersive mode, and returns on desktop non-immersive flight. */}
          {!immersiveActive && !narrow && <DashboardStrip snapshot={snapshot} />}
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
      {mode === "FLYING" && narrow && (
        <>
          <TouchControls
            onStick={onStick}
            onStickRelease={onStickRelease}
            onThrottle={onThrottle}
            initialThrottle={snapshot?.throttle ?? 0}
            gearFixed={(snapshot?.gear ?? "fixed") === "fixed"}
          />
          <ImmersiveControl warningActive={warningActive} />
        </>
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
