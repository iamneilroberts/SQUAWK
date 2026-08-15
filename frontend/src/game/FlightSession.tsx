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
import { checkPhysicalEligibility, resolveClass } from "../takeover/eligibility";
import { shouldFaceApproach, setFaceApproach } from "../takeover/headingToFafPreference";
import { buildLockedMissionSpawn, buildSpawnState, type SpawnResult } from "../takeover/spawn";
import { initialBearingDeg } from "../mission/geo";
import { finalApproachFix } from "../mission/guidanceGeometry";
import { createTerrainService, type TerrainService } from "../world/terrain";
import { createKeyboard } from "../input/keyboard";
import { createCesiumFlightHost } from "../globe/cesiumFlightHost";
import { createFlightLoop } from "./flightLoop";
import { preloadTerrain } from "../globe/terrainPreload";
import { createCountdownTimer } from "./countdownTimer";
import { hudSnapshot } from "../hud/snapshot";
import { formatCallsign, warningsFor } from "../hud/format";
import { approachWarningsFor } from "../hud/approachAlerts";
import { approachBandFor } from "../mission/approachBand";
import Hud from "../hud/Hud";
import { tapeRangesFor, type ImmersiveHudVariant } from "../hud/ImmersiveHudBar";
import TouchControls from "../input/TouchControls";
import type { AnalogAxes } from "../input/analog";
import { useViewport } from "../layout/useViewport";
import { isNarrowViewport } from "../layout/viewport";
import { isImmersiveActive } from "../layout/immersive";
import ImmersiveControl from "../layout/ImmersiveControl";
import DashboardStrip, { stripMountedForMode } from "../dashboard/DashboardStrip";
import TrafficOverlay from "../globe/TrafficOverlay";
import TrafficDetailCard from "../dashboard/TrafficDetailCard";
import IdentifiedContactCallout from "./IdentifiedContactCallout";
import MobileNavWx from "../dashboard/MobileNavWx";
import HandoffCard from "../panels/HandoffCard";
import PauseOverlay from "../panels/PauseOverlay";
import EndCard from "../panels/EndCard";
import { degToRad, ktToMs, mToFt, msToKt } from "../sim/units";
import { descentGuidanceFor } from "../mission/descentGuidance";
import type { AssistMode } from "../mission/assists";
import { releaseMissionLease, submitMissionResult } from "../mission/api";
import { buildMissionResultPackage } from "../mission/resultPackage";
import { assistFeatures, assistModeFromPreference, finalTurnCue, missionNavigationCue } from "../mission/assists";
import AssistControl from "../mission/AssistControl";
import MissionRouteLayer from "../globe/MissionRouteLayer";
import ApproachAssistLayer from "../globe/ApproachAssistLayer";
import DirectorLayer from "../globe/DirectorLayer";
import PapiLayer from "../globe/PapiLayer";
import type {
  DebriefSubmission,
  PendingMissionResult,
} from "../debrief/types";
import { MISSION_RECEIPT_TTL_MS } from "../shared/limits";
import {
  queueMissionResult,
  removeQueuedMissionResult,
  subscribeResultQueueEvents,
} from "../offline/runtime";
import { resultFailureIsPermanent } from "../offline/sync";
import { tutorialDefinitionForClass } from "../tutorial/definitions";
import {
  LIVE_COACHING_LESSONS,
  nextLesson,
  type TutorialLesson,
} from "../tutorial/lessons";
import { CoachingCard, TeachingOverlay } from "../tutorial/TeachingOverlay";
import { createTutorialTerrainService } from "../tutorial/terrain";

const COUNTDOWN_FROM = 3;
const PRELOAD_TIMEOUT_MS = 3000;
/** How long a refused RE-SYNC note lingers before it auto-clears (issue #5b). */
const RESYNC_NOTE_MS = 4000;

export default function FlightSession({
  coachingEnabled = false,
  onTutorialComplete,
  onCoachingComplete,
  onSignInToRank,
  onFlyAgain,
}: {
  coachingEnabled?: boolean;
  onTutorialComplete?(classId: "c172s" | "b738" | "f5e"): void;
  onCoachingComplete?(): void;
  /** Opens the sign-in sheet from the instant-flight debrief's SIGN IN TO RANK action (B5). */
  onSignInToRank?(): void;
  /** Restarts a fresh instant flight from the debrief's FLY AGAIN action (B5). App re-runs its
   *  take-controls pick after this session tears down; here we just do the teardown. */
  onFlyAgain?(): void;
}) {
  const bundle = useViewer();
  const mode = useStore((s) => s.mode);
  const lockedMission = useStore((s) => s.lockedMission);
  const tutorial = useStore((s) => s.tutorial);
  const freeFlight = useStore((s) => s.freeFlight);
  const instantFlight = useStore((s) => s.instantFlight);
  // Both flags mark a purely client-side flight: no server lease to release, no result to submit.
  const local = freeFlight || instantFlight;
  const assist = useStore((s) => s.assist);
  const endStats = useStore((s) => s.endStats);
  const feedStatus = useStore((s) => s.feedStatus);
  const basemap = useStore((s) => s.basemap);
  const labelsOn = useStore((s) => s.labelsOn);
  const immersive = useStore((s) => s.immersive);
  const chromeVisible = useStore((s) => s.chromeVisible);
  const decluttered = useStore((s) => s.decluttered);

  const [spawn, setSpawn] = useState<SpawnResult | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  /** Spawn heading faces the FAF instead of the live track; default on, persisted (owner req). */
  const [faceApproach, setFaceApproachState] = useState(() =>
    shouldFaceApproach(typeof window === "undefined" ? null : window.localStorage));
  const toggleFaceApproach = useCallback((enabled: boolean) => {
    try { setFaceApproach(localStorage, enabled); } catch { /* storage unavailable — apply for this session */ }
    setFaceApproachState(enabled);
  }, []);
  // Mirrors `faceApproach` every render so the COUNTDOWN effect's async preload continuation (a
  // closure created once, not re-run on toggle) reads the LATEST value instead of the stale one
  // captured when the effect started — otherwise a toggle during the preload window is dropped.
  const faceApproachRef = useRef(faceApproach);
  faceApproachRef.current = faceApproach;
  const [note, setNote] = useState("");
  /** RESUME pressed, waiting for the canvas click that spec §6 requires. */
  const [resumeArmed, setResumeArmed] = useState(false);
  /** Honest RE-SYNC refusal message shown in the .resync-note band (#5b); null = nothing shown. */
  const [resyncNote, setResyncNote] = useState<string | null>(null);
  /** Hex of the windscreen tag the player clicked, or null when no detail card is open. */
  const [trafficHex, setTrafficHex] = useState<string | null>(null);
  const [debrief, setDebrief] = useState<DebriefSubmission>({
    status: "unavailable",
    message: "AUTHORITATIVE RESULT HAS NOT BEEN SUBMITTED",
  });
  const [activeLesson, setActiveLesson] = useState<TutorialLesson | null>(null);
  /** Which immersive rail (A balanced / C tapes) the player selected; held for the flight. */
  // HUD C (compact tapes) is the default rail (owner 2026-08-13); the toggle switches to HUD A.
  const [immersiveHudVariant, setImmersiveHudVariant] =
    useState<ImmersiveHudVariant>("tapes");

  // Touch analog axes (mobile sub-feature 2, Option B). A single mutable object the flight loop
  // reads once per tick via the `analog` provider; the touch stick/throttle write into it. Stays
  // `{}` (every axis undefined -> no override) on desktop, where TouchControls never mounts, so the
  // keyboard/sprung path is byte-identical there.
  const touchAxesRef = useRef<AnalogAxes>({});

  const loopRef = useRef<ReturnType<typeof createFlightLoop> | null>(null);
  const hostRef = useRef<ReturnType<typeof createCesiumFlightHost> | null>(null);
  const keyboardRef = useRef<ReturnType<typeof createKeyboard> | null>(null);
  const terrainRef = useRef<TerrainService | null>(null);
  // Terrain height resolved by the COUNTDOWN effect below, kept around so the faceApproach-toggle
  // effect can rebuild the spawn (new heading only) without re-running terrain preload.
  const countdownTerrainHeightMRef = useRef<number | null>(null);
  const countdownTerrainResolvedRef = useRef(false);
  const releaseKeyRef = useRef<string | null>(null);
  const resultKeyRef = useRef<string | null>(null);
  const resyncNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingResultRef = useRef<PendingMissionResult | null>(null);
  const resultAttemptRef = useRef(0);
  const seenLessonsRef = useRef(new Set<string>());
  const coachingUsedRef = useRef(false);
  const activeLessonRef = useRef<TutorialLesson | null>(null);
  const coachingEnabledRef = useRef(coachingEnabled);
  const onTutorialCompleteRef = useRef(onTutorialComplete);
  const onCoachingCompleteRef = useRef(onCoachingComplete);

  useEffect(() => {
    coachingEnabledRef.current = coachingEnabled;
    onTutorialCompleteRef.current = onTutorialComplete;
    onCoachingCompleteRef.current = onCoachingComplete;
  }, [coachingEnabled, onTutorialComplete, onCoachingComplete]);

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
    if (resyncNoteTimerRef.current !== null) {
      clearTimeout(resyncNoteTimerRef.current);
      resyncNoteTimerRef.current = null;
    }
    setResyncNote(null);
    setTrafficHex(null);
    setActiveLesson(null);
    activeLessonRef.current = null;
    seenLessonsRef.current = new Set();
    coachingUsedRef.current = false;
    pendingResultRef.current = null;
    setDebrief({
      status: "unavailable",
      message: "AUTHORITATIVE RESULT HAS NOT BEEN SUBMITTED",
    });
  }

  function submitPendingResult(pending: PendingMissionResult): void {
    const attempt = resultAttemptRef.current + 1;
    resultAttemptRef.current = attempt;
    pendingResultRef.current = pending;
    setDebrief({ status: "submitting", preview: pending.preview });
    let persisted = false;
    const queuedAt = Date.now();
    const expiresAt = (lockedMission?.lockedAt ?? queuedAt) + MISSION_RECEIPT_TTL_MS;
    void queueMissionResult(pending, queuedAt, expiresAt)
      .then(() => { persisted = true; })
      .catch(() => undefined)
      .then(() => submitMissionResult(pending.request, pending.idempotencyKey))
      .then((result) => {
        if (pendingResultRef.current !== pending || resultAttemptRef.current !== attempt) return;
        void removeQueuedMissionResult(pending.request.missionId, pending.idempotencyKey)
          .catch(() => undefined);
        setDebrief({ status: "accepted", result });
      })
      .catch((error: unknown) => {
        if (pendingResultRef.current !== pending || resultAttemptRef.current !== attempt) return;
        const permanent = resultFailureIsPermanent(error);
        if (permanent) {
          void removeQueuedMissionResult(pending.request.missionId, pending.idempotencyKey)
            .catch(() => undefined);
        }
        if (!permanent && persisted) {
          setDebrief({
            status: "queued",
            preview: pending.preview,
            message: "RESULT SAVED — IT WILL RETRY WITH THE SAME IDEMPOTENCY KEY AFTER RECOVERY",
          });
          return;
        }
        setDebrief({
          status: "failed",
          preview: pending.preview,
          message: permanent
            ? "WORKER REJECTED THIS INVALID, EXPIRED, OR INELIGIBLE RESULT"
            : "RESULT SUBMISSION FAILED — LOCAL QUEUE UNAVAILABLE",
          retryable: !permanent,
        });
      });
  }

  function retryResult(): void {
    const pending = pendingResultRef.current;
    if (pending !== null) submitPendingResult(pending);
  }

  /**
   * Leaving always goes through the machine, so an event that is illegal from the current
   * mode is refused rather than teleporting the app to BROWSE from somewhere it should not.
   */
  function leaveToBrowse(event: GameEvent) {
    if (lockedMission !== null && tutorial === null && !local && useStore.getState().mode !== "ENDED") {
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
      resultKeyRef.current = null;
      pendingResultRef.current = null;
      return;
    }
    releaseKeyRef.current = crypto.randomUUID();
    resultKeyRef.current = crypto.randomUUID();
    pendingResultRef.current = null;
    seenLessonsRef.current = new Set();
    coachingUsedRef.current = false;
    setDebrief({
      status: "unavailable",
      message: "AUTHORITATIVE RESULT HAS NOT BEEN SUBMITTED",
    });
    if (tutorial !== null || local) return;
    const release = () => {
      if (useStore.getState().mode === "ENDED") return;
      void releaseMissionLease(
        lockedMission.missionId,
        releaseKeyRef.current ?? crypto.randomUUID(),
      ).catch(() => undefined);
    };
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, [lockedMission, tutorial, freeFlight, instantFlight, local]);

  useEffect(() => subscribeResultQueueEvents((event) => {
    const pending = pendingResultRef.current;
    if (pending === null || event.record.missionId !== pending.request.missionId ||
      event.record.idempotencyKey !== pending.idempotencyKey) return;
    if (event.kind === "accepted") {
      setDebrief({ status: "accepted", result: event.result });
    } else {
      setDebrief({
        status: "failed",
        preview: pending.preview,
        message: "WORKER REJECTED THIS INVALID, EXPIRED, OR INELIGIBLE RESULT",
        retryable: false,
      });
    }
  }), []);

  // ---- COUNTDOWN: preload terrain, build the spawn, tick 3-2-1, then fly ----
  useEffect(() => {
    if (mode !== "COUNTDOWN" || !bundle || !lockedMission) return;
    let cancelled = false;
    countdownTerrainResolvedRef.current = false;
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
      const preload = tutorial === null
        ? await preloadTerrain(
            bundle.viewer,
            degToRad(contact.lat),
            degToRad(contact.lon),
            degToRad(contact.track ?? 0),
            ktToMs(contact.gs ?? 0),
            PRELOAD_TIMEOUT_MS,
          )
        : {
            verified: true,
            terrainHeightM: null,
          };
      if (cancelled) return;
      countdownTerrainHeightMRef.current = preload.terrainHeightM;
      countdownTerrainResolvedRef.current = true;

      const spawnHeadingDeg =
        faceApproachRef.current && !freeFlight
          ? (() => {
              const faf = finalApproachFix(lockedMission.assignment, lockedMission.missionProfile.guidance);
              return initialBearingDeg(contact.lat, contact.lon, faf.point.latDeg, faf.point.lonDeg);
            })()
          : undefined;
      const built = buildLockedMissionSpawn(
        contact,
        lockedMission.classId,
        params,
        {
          terrainHeightM: preload.terrainHeightM,
          spawnHeadingDeg,
          ...(tutorial === null
            ? {}
            : { initialFlapDetent: params.flaps.length - 1, initialGearDown: true }),
        },
      );
      setSpawn(built);
      setNote(tutorial !== null
        ? "TUTORIAL GROUND — PUBLISHED RUNWAY ELEVATION"
        : preload.verified ? "" : "TERRAIN UNVERIFIED — COLLISION DISARMED");

      const terrain = tutorial === null
        ? createTerrainService(bundle.heightSampler)
        : createTutorialTerrainService(lockedMission.assignment);
      if (tutorial === null && !preload.verified) terrain.disarm();
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
            landing: {
              assignment: lockedMission.assignment,
              profile: lockedMission.missionProfile,
            },
            onSnapshot: (s) => {
              hudSnapshot.set(s);
              if (activeLessonRef.current !== null) return;
              const lessons = tutorial === null
                ? LIVE_COACHING_LESSONS
                : tutorialDefinitionForClass(tutorial.classId).lessons;
              const lesson = nextLesson(
                lessons,
                seenLessonsRef.current,
                s.airtimeS,
                tutorial !== null || coachingEnabledRef.current,
              );
              if (lesson === null) return;
              seenLessonsRef.current.add(lesson.id);
              activeLessonRef.current = lesson;
              setActiveLesson(lesson);
              if (tutorial !== null) {
                loopRef.current?.pause();
                useStore.getState().fire("PAUSE");
              } else {
                coachingUsedRef.current = true;
              }
            },
            onEnd: (stats, landingResult) => {
              loopRef.current?.stop();
              useStore.getState().setEndStats(stats);
              if (landingResult === undefined) {
                pendingResultRef.current = null;
                setDebrief({
                  status: "unavailable",
                  message: "LANDING EVIDENCE WAS NOT CAPTURED",
                });
                useStore.getState().fire("IMPACT");
                return;
              }
              const highestAssist = useStore.getState().assist?.highestUsed ??
                assistModeFromPreference(lockedMission.assist);
              // Free flight (#29) has no destination and is never ranked: submit nothing, show a
              // local debrief. Sits before the tutorial branch so it never runs onTutorialComplete.
              if (freeFlight) {
                pendingResultRef.current = null;
                activeLessonRef.current = null;
                setActiveLesson(null);
                setDebrief({
                  status: "unavailable",
                  message: "FREE FLIGHT — LOCAL AND UNRANKED. NO RESULT SUBMITTED.",
                });
                useStore.getState().fire("IMPACT");
                return;
              }
              // Instant anonymous flight (B5): score it locally (same evaluation the tutorial
              // shows) but NEVER submit — it is unranked until the player signs in. Mirrors the
              // tutorial branch; the EndCard offers SIGN IN TO RANK for this status.
              if (instantFlight) {
                pendingResultRef.current = null;
                activeLessonRef.current = null;
                setActiveLesson(null);
                setDebrief({
                  status: "instant",
                  preview: {
                    classId: lockedMission.classId,
                    versions: lockedMission.versions,
                    highestAssist,
                    evaluation: landingResult.evaluation,
                  },
                });
                useStore.getState().fire("IMPACT");
                return;
              }
              if (tutorial !== null) {
                pendingResultRef.current = null;
                activeLessonRef.current = null;
                setActiveLesson(null);
                setDebrief({
                  status: "tutorial",
                  preview: {
                    classId: lockedMission.classId,
                    versions: lockedMission.versions,
                    highestAssist,
                    evaluation: landingResult.evaluation,
                  },
                });
                useStore.getState().fire("IMPACT");
                // biz and tprop have no tutorial (definitions.ts has no biz/tprop entry), so this
                // callback's narrower signature never needs to name them — guard rather than widen the type.
                if (lockedMission.classId !== "biz" && lockedMission.classId !== "tprop") onTutorialCompleteRef.current?.(lockedMission.classId);
                return;
              }
              // Reposition spawn (spawn chooser): the spawn skipped part of the route, so the
              // flight is local and unranked — no result submitted. A normal locked mission
              // otherwise, so this sits after the freeFlight/instantFlight/tutorial short-circuits.
              // Read imperatively (not the reactive hook) so toggling the spawn mode mid-COUNTDOWN
              // doesn't sit in this effect's dep array and restart the countdown/terrain preload —
              // mirrors `highestAssist`'s `useStore.getState().assist?.highestUsed` read above.
              if (useStore.getState().repositioned) {
                pendingResultRef.current = null;
                activeLessonRef.current = null;
                setActiveLesson(null);
                setDebrief({
                  status: "unavailable",
                  message: "REPOSITIONED — LOCAL AND UNRANKED. NO RESULT SUBMITTED.",
                });
                useStore.getState().fire("IMPACT");
                return;
              }
              if (coachingUsedRef.current) onCoachingCompleteRef.current?.();
              try {
                const result = buildMissionResultPackage({
                  mission: lockedMission,
                  evidence: landingResult.evidence,
                  highestAssist,
                });
                const key = resultKeyRef.current ?? crypto.randomUUID();
                resultKeyRef.current = key;
                const pending: PendingMissionResult = {
                  request: result.request,
                  idempotencyKey: key,
                  preview: {
                    classId: lockedMission.classId,
                    versions: lockedMission.versions,
                    highestAssist,
                    evaluation: result.preview,
                  },
                };
                useStore.getState().fire("IMPACT");
                // Persist before the network attempt. The Worker remains the only authority and
                // receives this exact request/idempotency key after recovery.
                submitPendingResult(pending);
              } catch {
                pendingResultRef.current = null;
                setDebrief({
                  status: "unavailable",
                  message: "RESULT PACKAGE COULD NOT BE CREATED",
                });
                useStore.getState().fire("IMPACT");
              }
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
    // Deliberately depend on the bundle's stable members, not the bundle object; see above.
    // submitPendingResult owns refs/current mission and must not restart an active countdown.
    // `faceApproach` is deliberately NOT a dep here — see the decoupled rebuild effect below;
    // depending on it would restart the 3-2-1 timer and re-run terrain preload on every toggle.
    // The spawn build inside reads `faceApproachRef.current`, not the closed-over `faceApproach`,
    // so a toggle during the preload window (before countdownTerrainResolvedRef flips true, while
    // the decoupled effect below still bails) isn't lost — it's picked up when preload resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    bundle?.viewer,
    bundle?.heightSampler,
    lockedMission,
    tutorial,
    freeFlight,
    instantFlight,
  ]);

  // Toggling HEADING → APPROACH mid-COUNTDOWN rebuilds ONLY the spawn (new heading), reusing the
  // terrain height the effect above already resolved — deliberately decoupled so it never resets
  // the 3-2-1 timer or reflashes "ACQUIRING TERRAIN…" (the countdown effect above owns those).
  useEffect(() => {
    if (mode !== "COUNTDOWN" || !lockedMission || !countdownTerrainResolvedRef.current) return;
    const contact = lockedMission.contact;
    const params = lockedMission.aircraftProfile;
    if (params.id !== lockedMission.classId) return;
    const spawnHeadingDeg =
      faceApproach && !freeFlight
        ? (() => {
            const faf = finalApproachFix(lockedMission.assignment, lockedMission.missionProfile.guidance);
            return initialBearingDeg(contact.lat, contact.lon, faf.point.latDeg, faf.point.lonDeg);
          })()
        : undefined;
    setSpawn(buildLockedMissionSpawn(contact, lockedMission.classId, params, {
      terrainHeightM: countdownTerrainHeightMRef.current,
      spawnHeadingDeg,
      ...(tutorial === null
        ? {}
        : { initialFlapDetent: params.flaps.length - 1, initialGearDown: true }),
    }));
    // Deliberately only `faceApproach`: this effect exists to react to the toggle, not to
    // mode/lockedMission changes — those are already handled by the countdown effect above,
    // which also seeds countdownTerrainResolvedRef/countdownTerrainHeightMRef before this can fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceApproach]);

  // Pause from FLYING: stop the physics loop and move the machine to PAUSED. Shared by desktop
  // Escape, the auto-pause on tab-hide, and the mobile MENU button (#58 — the mobile abort valve;
  // PauseOverlay then offers RESUME or QUIT TO BROWSE). No-op unless currently FLYING.
  const pauseFlight = useCallback(() => {
    if (useStore.getState().mode !== "FLYING") return;
    loopRef.current?.pause();
    setResumeArmed(false);
    useStore.getState().fire("PAUSE");
  }, []);

  // Resume straight from the PauseOverlay. On touch there is no pointer lock, so the desktop
  // "arm, then click the globe to re-lock" dance (spec §6) is needless friction — RESUME just
  // resumes (owner 2026-08-13). Desktop still arms so the canvas click can re-acquire pointer lock.
  const resumeFlight = useCallback(() => {
    loopRef.current?.resume();
    setResumeArmed(false);
    useStore.getState().fire("RESUME");
  }, []);

  // ---- Esc pauses; visibilitychange auto-pauses (spec §5, §6) ----
  useEffect(() => {
    if (mode !== "FLYING" && mode !== "PAUSED") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") pauseFlight();
    };
    const onVisibility = () => {
      if (document.hidden) pauseFlight();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode, pauseFlight]);

  // ---- KeyE toggles the exterior chase/orbit camera (issue #4) ----
  // View-only, off by default: the toggle LOGIC lives in the host (cesiumFlightHost), so a future
  // mobile control can drive the same host.toggleExterior() without this keyboard plumbing. Never
  // touches ControlVector or the sim — it only swaps which camera the render loop drives.
  useEffect(() => {
    if (mode !== "FLYING") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyE" || e.ctrlKey || e.metaKey || e.altKey) return;
      hostRef.current?.toggleExterior();
      // Mirror the host's view mode into the store so React layers (MissionRouteLayer, #61) react.
      useStore.getState().setExterior(hostRef.current?.isExteriorActive() ?? false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      useStore.getState().setExterior(false); // leaving FLYING returns to the cockpit view
    };
  }, [mode]);

  // ---- KeyY = one-shot RE-SYNC to the live aircraft position (issue #5b) ----
  // Arcade assist: respawn the SIM aircraft at the GENUINE tracked contact's CURRENT live
  // position/velocity/attitude. A chrome key handled here in React (like KeyE), NOT a held sampler
  // input. The mobile RE-SYNC button synthesizes the same KeyY, so this one listener serves both.
  // It refuses honestly — a stale/offline/missing contact never teleports, it shows a brief note.
  // The locked class never changes, so it uses checkPhysicalEligibility (the shared subset), and
  // rebuilds with buildSpawnState against the live contact + the already-locked aircraft profile.
  useEffect(() => {
    if (mode !== "FLYING") return;
    const showNote = (reason: string | null) => {
      if (resyncNoteTimerRef.current !== null) clearTimeout(resyncNoteTimerRef.current);
      resyncNoteTimerRef.current = null;
      setResyncNote(reason);
      if (reason !== null) {
        resyncNoteTimerRef.current = setTimeout(() => setResyncNote(null), RESYNC_NOTE_MS);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyY" || e.ctrlKey || e.metaKey || e.altKey) return;
      const loop = loopRef.current;
      const store = useStore.getState();
      const origin = store.origin;
      if (loop === null || lockedMission === null || origin === null || !bundle) {
        showNote("RE-SYNC UNAVAILABLE");
        return;
      }
      if (store.feedStatus === "offline") {
        showNote("RE-SYNC — FEED OFFLINE");
        return;
      }
      // The poller keeps `contacts` current while flying; the live tracked aircraft is the origin
      // hex. It is never dead-reckoned forward — a stale row is refused, not extrapolated.
      const live = store.contacts.get(origin.hex);
      if (live === undefined) {
        showNote("RE-SYNC — CONTACT NOT ON FEED");
        return;
      }
      const eligibility = checkPhysicalEligibility(live);
      if (!eligibility.eligible) {
        showNote(`RE-SYNC — ${eligibility.reason}`);
        return;
      }
      // Sample the CURRENT terrain height under the contact the way the initial spawn does; best
      // effort — null when the tile is not resident yet, which buildSpawnState discloses honestly.
      const rawHeight = bundle.heightSampler(degToRad(live.lat), degToRad(live.lon));
      const terrainHeightM =
        typeof rawHeight === "number" && Number.isFinite(rawHeight) ? rawHeight : null;
      const newSpawn = buildSpawnState(live, lockedMission.aircraftProfile, { terrainHeightM });
      loop.resync(newSpawn);
      showNote(null); // teleported — clear any prior refusal; the SIM/ghost semantics are untouched
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, bundle, lockedMission]);

  // ---- exterior view: wheel to zoom (issue #4) ----
  // Drag-to-orbit now lives in the unified pointer handler below (mouse + touch, issue #65): Cesium's
  // ScreenSpaceEventHandler calls preventDefault() on the canvas pointerdown, which suppresses the
  // compatibility `mousedown` a drag-to-orbit handler used to rely on — so a real mouse never orbited.
  // Wheel isn't a pointer event, so zoom stays here. Cesium's own camera inputs are disabled during
  // flight, so the wheel is ours to consume for zoom.
  useEffect(() => {
    if (mode !== "FLYING" || !bundle) return;
    const canvas = bundle.viewer.scene.canvas;
    const onWheel = (e: WheelEvent) => {
      if (!hostRef.current?.isExteriorActive()) return;
      e.preventDefault(); // don't scroll the page; this is a camera zoom
      hostRef.current.applyOrbitZoom(e.deltaY);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
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

  // ---- pointer drag on the open canvas: look (cockpit) or orbit (exterior); pinch zooms the
  // exterior (#9 look-around, #36 exterior touch-rotate, #65 desktop mouse). Handles touch, pen AND
  // mouse from the SAME listener: Cesium's ScreenSpaceEventHandler preventDefault()s the canvas
  // pointerdown, which suppresses the legacy `mousedown` a separate desktop handler would need — so
  // reading pointer events directly is the only reliable path for a real mouse. The stick, throttle
  // and touch-buttons are pointer-events:auto DOM elements ABOVE the canvas, so a drag that starts on
  // a control never reaches this canvas listener and the flight inputs stay untouched.
  useEffect(() => {
    if (mode !== "FLYING" || !bundle) return;
    const canvas = bundle.viewer.scene.canvas;
    const points = new Map<number, { x: number; y: number }>();
    let gesture: "look" | "orbit" | null = null;
    let pinchLast = 0;
    /** Pinch pixels → the wheel-delta scale applyOrbitZoom expects; spreading fingers zooms IN. */
    const PINCH_TO_WHEEL = 2;

    const pinchDistance = () => {
      const [a, b] = [...points.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return; // left-drag only for the mouse
      // Take the drag: stop any browser default (text selection, native drag) and keep receiving
      // moves after the pointer leaves the canvas via pointer capture.
      e.preventDefault();
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture?.(e.pointerId);
      if (points.size === 1) {
        if (hostRef.current?.isExteriorActive()) {
          gesture = "orbit";
          hostRef.current.setOrbiting(true);
        } else {
          gesture = "look";
          hostRef.current?.setLookActive(true);
        }
      } else if (points.size === 2) {
        pinchLast = pinchDistance(); // second finger down starts a pinch
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = points.get(e.pointerId);
      if (prev === undefined) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.size >= 2) {
        if (gesture === "orbit") {
          const d = pinchDistance();
          if (pinchLast > 0) hostRef.current?.applyOrbitZoom((pinchLast - d) * PINCH_TO_WHEEL);
          pinchLast = d;
        }
        return; // two fingers = pinch-zoom only; don't also orbit
      }
      if (gesture === "orbit") hostRef.current?.applyOrbitDrag(dx, dy);
      else if (gesture === "look") hostRef.current?.applyLook(dx, dy);
    };
    const onUp = (e: PointerEvent) => {
      if (!points.delete(e.pointerId)) return;
      canvas.releasePointerCapture?.(e.pointerId);
      if (points.size < 2) pinchLast = 0;
      if (points.size === 0) {
        if (gesture === "orbit") hostRef.current?.setOrbiting(false);
        else if (gesture === "look") hostRef.current?.setLookActive(false);
        gesture = null;
      }
    };

    const prevTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = "none"; // we own touch drags — stop the browser panning/zooming the page
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      canvas.style.touchAction = prevTouchAction;
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      hostRef.current?.setOrbiting(false);
      hostRef.current?.setLookActive(false);
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
  const immersiveActive = isImmersiveActive(immersive, mode);
  // Fade on ANY narrow flight, not just requested fullscreen (owner declutter 2026-08-11).
  const faded = (immersiveActive || (narrow && mode === "FLYING")) && !chromeVisible;
  const warningActive = snapshot ? warningsFor(snapshot).length > 0 : false;

  // Mobile RE-SYNC button visibility (#5b): only a locked mission that tracks a REAL live contact
  // can re-sync. Tutorial and free flight are synthetic (no live traffic), and an offline feed has
  // nothing to re-sync to. Instant flight qualifies — it spawns from a real contact and keeps
  // polling. The button can still refuse honestly if the contact goes stale between polls.
  const canResync =
    lockedMission !== null && tutorial === null && !freeFlight && feedStatus !== "offline";

  // Destination pointer in the HUD bar (owner 2026-08-11: "need some kind of pointer to the
  // airport"). Feeds the bar's NavDirector (relative-bearing arrow + distance) from the same
  // missionNavigationCue the big screen-space cue used; the bar replaces that cue on narrow.
  // The destination POINTER (which way is the airport + how far) is basic situational awareness,
  // not a landing aid, so an instant flight always gets it even at OFF assist (its anonymous pilot
  // never chose an assist level, and "fly a real plane and land it" needs a destination). It is the
  // ONLY nav cue an instant flight can support: its airport is a real point but has no runway
  // geometry, so route/runway-highlight/approach aids (the rest of NAV/FULL) would draw nothing
  // meaningful — hence a pointer-only exception rather than bumping the assist level. (#47)
  const immersiveNavCue =
    lockedMission !== null &&
    snapshot !== null &&
    assist !== null &&
    (instantFlight || assistFeatures(assist.current).destinationCue)
      ? (() => {
          const cue = missionNavigationCue(snapshot, lockedMission.assignment);
          // Instant flight targets an airport, not a specific runway (no runway geometry), so it
          // shows just the ident; ranked/tutorial missions name the assigned runway end.
          const { airportIdent, runwayEndIdent } = lockedMission.assignment;
          return {
            destination: instantFlight ? airportIdent : `${airportIdent} RWY ${runwayEndIdent}`,
            bearingDeg: cue.bearingDeg,
            distanceNm: cue.distanceNm,
          };
        })()
      : null;

  // TURN FINAL callout (#88): heading + distance to the FAF and the on-slope target alt/speed,
  // gated the same as the destination cue above (NAV+, plus instant flight). finalTurnCue itself
  // hands off to null once inside the FAF distance, where the approach band/threshold cue take over.
  const finalTurn =
    lockedMission !== null &&
    snapshot !== null &&
    assist !== null &&
    (instantFlight || assistFeatures(assist.current).destinationCue)
      ? finalTurnCue(snapshot, lockedMission.assignment, lockedMission.missionProfile)
      : null;

  const immersiveApproachWarnings =
    lockedMission !== null && snapshot !== null && assist !== null
      ? approachWarningsFor(
          snapshot,
          lockedMission.assignment,
          lockedMission.missionProfile.guidance,
          assist.current,
        )
      : [];

  // Instant flight runs assist=OFF but still gets the nav cue + advisory guidance (owner req):
  // treat it as NAV for the approach band / descent advisory, which gate on destinationCue. Its
  // destination is the real nearest airport; note the altitude band/target is approximate there
  // (airport elevation is unknown → sea-level datum). The per-class SPEED band is exact regardless.
  const advisoryAssist: AssistMode = instantFlight ? "NAV" : (assist?.current ?? "OFF");

  // #52: suggested approach speed + glide-slope altitude band on final.
  const immersiveApproachBand =
    lockedMission !== null && snapshot !== null && assist !== null
      ? approachBandFor(
          snapshot,
          lockedMission.assignment,
          lockedMission.missionProfile,
          advisoryAssist,
        )
      : null;

  // At-range descent advisory (hands off to the band once inside the approach length).
  const immersiveDescentGuidance =
    lockedMission !== null && snapshot !== null && assist !== null && immersiveApproachBand === null
      ? descentGuidanceFor(
          {
            latDeg: snapshot.latDeg,
            lonDeg: snapshot.lonDeg,
            altitudeFt: mToFt(snapshot.altitudeM),
            groundSpeedKt: msToKt(snapshot.tasMs),
          },
          lockedMission.assignment,
          lockedMission.missionProfile,
          advisoryAssist,
        )
      : null;

  const dismissLesson = () => {
    activeLessonRef.current = null;
    setActiveLesson(null);
  };

  const continueTutorial = () => {
    dismissLesson();
    loopRef.current?.resume();
    useStore.getState().fire("RESUME");
  };

  return (
    <>
      {tutorial !== null && (
        <div className="tutorial-flight-banner">
          TUTORIAL {tutorial.version} · LOCAL · NO LIVE TRAFFIC · UNRANKED
        </div>
      )}
      {lockedMission !== null && assist !== null && mode !== "ENDED" && (
        <>
          {/* PAPI is world furniture (#23): renders at EVERY assist level, unlike the
              assist-gated layers below — real airports don't turn their lights off. */}
          <PapiLayer mission={lockedMission} />
          {/* Instant flight runs assist=OFF but still gets a labeled destination + route line
              (owner req): the layer skips the degenerate runway outline when there's no runway. */}
          <MissionRouteLayer mission={lockedMission} assist={advisoryAssist} />
          <ApproachAssistLayer mission={lockedMission} assist={assist.current} />
          {/* The approach flight director (#22): a green lead aircraft flying the glide slope ahead
              of the player. FULL-assist landing aid, gated like the glide gates; sibling of the
              corridor surface, not a replacement for it. */}
          <DirectorLayer mission={lockedMission} assist={assist.current} instantFlight={instantFlight} />
          {/* Screen-space assist chrome folds into the same video-player auto-hide as the HUD
              (owner 2026-08-11: assist elements take too much space — fade them out). The
              world-space Cesium layers above stay: they are the guidance itself. On narrow
              (phone) the chrome is NOT rendered at all — the HUD bar's NavDirector carries the
              destination pointer instead (owner: clean portrait view). */}
          {!narrow && (
            <div className={"mission-chrome" + (faded ? " mission-chrome-faded" : "")}>
              {/* The destination cue now lives at the top of the HUD (Hud.tsx HudDestinationCue,
                  #47) — a single heading-relative indicator that also covers instant flight. */}
              <AssistControl />
            </div>
          )}
        </>
      )}
      {mode === "COUNTDOWN" && lockedMission && (
        <HandoffCard contact={lockedMission.contact} spawn={spawn} params={originParams}
          matched={originResolution?.matched ?? false} countdown={countdown} note={note}
          assignment={lockedMission.assignment}
          faceApproach={faceApproach} onToggleFaceApproach={toggleFaceApproach}
          freeFlight={freeFlight} />
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
            immersiveVariant={immersiveHudVariant}
            onImmersiveVariantChange={setImmersiveHudVariant}
            immersiveNavCue={immersiveNavCue}
            finalTurn={finalTurn}
            immersiveApproachWarnings={immersiveApproachWarnings}
            immersiveApproachBand={immersiveApproachBand}
            immersiveDescentGuidance={immersiveDescentGuidance}
            narrow={narrow}
            tapeRange={originParams ? tapeRangesFor(originParams) : null}
            decluttered={decluttered}
          />
          {/* The cockpit dashboard is DESKTOP-ONLY. On mobile (narrow) it never renders at all —
              phones get the minimal immersive flying view (top status bar + minimal touch
              controls + auto-hide), no multi-panel dashboard clutter (owner directive). On
              desktop it ALWAYS renders, immersive or not (owner 2026-08-12: desktop immersive
              adds the improved HUD bar but KEEPS the glass cockpit — "keep both"). */}
          {!narrow && <DashboardStrip snapshot={snapshot} />}
        </>
      )}
      {/* ENDED is deliberately excluded: the end card owns the screen and the mouse is handed
          back for orbiting (decisions B-015), so clickable tags over the impact site would
          fight that. */}
      {tutorial === null && (mode === "FLYING" || mode === "PAUSED") && (
        <>
          <TrafficOverlay onSelect={setTrafficHex} />
          {trafficHex !== null && (
            <TrafficDetailCard hex={trafficHex} onClose={() => setTrafficHex(null)} />
          )}
          {/* Tap an aircraft in the 3D scene (not a windscreen tag) -> compact identify callout (#86). */}
          <IdentifiedContactCallout />
        </>
      )}
      {mode === "FLYING" && narrow && (
        <>
          <TouchControls
            onStick={onStick}
            onStickRelease={onStickRelease}
            onThrottle={onThrottle}
            throttle={snapshot?.throttle ?? 0}
            gearFixed={(snapshot?.gear ?? "fixed") === "fixed"}
            hasSpeedbrake={(originParams?.aero.speedbrakeCd0 ?? 0) > 0}
            showResync={canResync}
            snapshot={snapshot}
          />
          <MobileNavWx snapshot={snapshot} faded={faded} />
        </>
      )}
      {/* The immersive control row (FULL/EXIT · DCLTR · MENU) mounts on BOTH platforms while
          FLYING: mobile as before, desktop so the player can opt into immersive (owner
          2026-08-12). TouchControls / MobileNavWx above stay mobile-only. `faded` fades this row
          + the NAV/WX chip + the Cesium credit into the same auto-hide as the rest of the chrome
          (#74/#75); the stick/throttle stay put — they are how you fly. */}
      {mode === "FLYING" && (
        <ImmersiveControl warningActive={warningActive} onMenu={pauseFlight} faded={faded} />
      )}
      {/* Honest RE-SYNC refusal (#5b): the arcade assist declined (contact stale/offline/off-feed),
          so nothing teleported — say why, briefly, in the existing amber band. Never shown on a
          successful re-sync. */}
      {mode === "FLYING" && resyncNote !== null && (
        <div className="resync-note">{resyncNote}</div>
      )}
      {mode === "PAUSED" && tutorial !== null && activeLesson !== null && (
        <TeachingOverlay
          lesson={activeLesson}
          onContinue={continueTutorial}
          onQuit={() => leaveToBrowse("QUIT")}
        />
      )}
      {mode === "PAUSED" && !(tutorial !== null && activeLesson !== null) && (
        <PauseOverlay
          armed={resumeArmed}
          onArmResume={narrow ? resumeFlight : () => setResumeArmed(true)}
          onQuit={() => leaveToBrowse("QUIT")}
        />
      )}
      {mode === "FLYING" && tutorial === null && activeLesson !== null && (
        <CoachingCard lesson={activeLesson} onDismiss={dismissLesson} />
      )}
      {mode === "ENDED" && endStats && (
        <EndCard
          stats={endStats}
          submission={debrief}
          onRetry={retryResult}
          callsign={snapshot?.callsign ?? null}
          onExit={() => leaveToBrowse("EXIT_END")}
          onSignIn={onSignInToRank}
          onFlyAgain={
            onFlyAgain
              ? () => {
                  // Tear the current flight down (camera handoff, loop disposal, back to BROWSE),
                  // then let App pick the next contact and start a fresh instant flight.
                  leaveToBrowse("EXIT_END");
                  onFlyAgain();
                }
              : undefined
          }
        />
      )}
    </>
  );
}
