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
import { loadC172 } from "../sim/params";
import { buildSpawnState, type SpawnResult } from "../takeover/spawn";
import { createTerrainService, type TerrainService } from "../world/terrain";
import { createKeyboard } from "../input/keyboard";
import { createCesiumFlightHost } from "../globe/cesiumFlightHost";
import { createFlightLoop } from "./flightLoop";
import { preloadTerrain } from "../globe/terrainPreload";
import { hudSnapshot } from "../hud/snapshot";
import { formatCallsign } from "../hud/format";
import Hud from "../hud/Hud";
import HandoffCard from "../panels/HandoffCard";
import PauseOverlay from "../panels/PauseOverlay";
import { degToRad, ktToMs } from "../sim/units";

const COUNTDOWN_FROM = 3;
const PRELOAD_TIMEOUT_MS = 3000;

export default function FlightSession() {
  const bundle = useViewer();
  const mode = useStore((s) => s.mode);
  const origin = useStore((s) => s.origin);

  const [spawn, setSpawn] = useState<SpawnResult | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [note, setNote] = useState("");
  /** RESUME pressed, waiting for the canvas click that spec §6 requires. */
  const [resumeArmed, setResumeArmed] = useState(false);

  const loopRef = useRef<ReturnType<typeof createFlightLoop> | null>(null);
  const keyboardRef = useRef<ReturnType<typeof createKeyboard> | null>(null);
  const terrainRef = useRef<TerrainService | null>(null);

  const snapshot = useSyncExternalStore(hudSnapshot.subscribe, hudSnapshot.get, hudSnapshot.get);

  /** Tear down every mutable thing a flight owns. Safe to call more than once. */
  function teardown() {
    loopRef.current?.stop();
    loopRef.current = null;
    keyboardRef.current?.dispose();
    keyboardRef.current = null;
    terrainRef.current = null;
    hudSnapshot.set(null);
    setSpawn(null);
    setCountdown(null);
    setNote("");
    setResumeArmed(false);
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
      let remaining = COUNTDOWN_FROM;
      const timer = setInterval(() => {
        remaining -= 1;
        if (cancelled) return;
        if (remaining > 0) {
          setCountdown(remaining);
          return;
        }
        clearInterval(timer);
        setCountdown(null);

        const loop = createFlightLoop({
          host: createCesiumFlightHost(bundle.viewer),
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
      }, 1000);

      return () => clearInterval(timer);
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, bundle, origin]);

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

  if (mode === "BROWSE") return null;

  return (
    <>
      {mode === "COUNTDOWN" && origin && (
        <HandoffCard contact={origin.snapshot} spawn={spawn} countdown={countdown} note={note} />
      )}
      {(mode === "FLYING" || mode === "PAUSED" || mode === "ENDED") && (
        <Hud snapshot={snapshot} terrainNote={bundle?.terrainNote ?? ""} />
      )}
      {mode === "PAUSED" && (
        <PauseOverlay
          armed={resumeArmed}
          onArmResume={() => setResumeArmed(true)}
          onQuit={() => leaveToBrowse("QUIT")}
        />
      )}
    </>
  );
}
