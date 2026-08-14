import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ViewerHost from "./globe/ViewerHost";
import ContactLayer from "./globe/ContactLayer";
import OverlayLayers from "./globe/OverlayLayers";
import FlightSession from "./game/FlightSession";
import ContactList from "./panels/ContactList";
import StatusBar from "./panels/StatusBar";
import { useViewport } from "./layout/useViewport";
import { isNarrowViewport } from "./layout/viewport";
import AppModeHint from "./layout/AppModeHint";
import { isImmersiveActive } from "./layout/immersive";
import { useStore } from "./state/store";
import { useUrlTakeover } from "./takeover/useUrlTakeover";
import AuthReturn from "./auth/AuthReturn";
import SignInSheet from "./auth/SignInSheet";
import {
  AuthClientError,
  loadCurrentProfile,
  loadProvisionalBriefing,
  loadTurnstileSiteKey,
  saveProvisionalBriefing,
  updateCurrentProfile,
  type ProvisionalBriefingReference,
  type SessionProfile,
} from "./auth/session";
import ProfilePanel from "./profile/ProfilePanel";
import LeaderboardPanel from "./leaderboards/LeaderboardPanel";
import QuickStartNotice from "./briefing/QuickStartNotice";
import { dismissQuickStart, shouldShowQuickStart } from "./briefing/quickStartState";
import MissionTray from "./briefing/MissionTray";
import {
  assignmentKey,
  prepareRequestForBriefing,
  useProvisionalBriefing,
  type MissionCommitState,
} from "./briefing/briefingState";
import { lockMission, prepareMission } from "./mission/api";
import { missionChoiceKey, type MissionPreparationView } from "./mission/contract";
import TutorialPanel from "./tutorial/TutorialPanel";
import FreeFlightPanel from "./freeflight/FreeFlightPanel";
import { buildFreeFlightMission } from "./freeflight/freeFlight";
import { buildInstantMission } from "./takeover/instantMission";
import { shouldFaceApproach } from "./takeover/headingToFafPreference";
import { nearestFlyableContact } from "./takeover/pickFlyable";
import { loadAirports } from "./data/airports";
import {
  buildTutorialMission,
  tutorialDefinitionForClass,
  tutorialRun,
} from "./tutorial/definitions";
import {
  EMPTY_TUTORIAL_PROGRESS,
  loadTutorialProgress,
  markTutorialCompleted,
  markTutorialStarted,
} from "./tutorial/progress";
import type { AircraftClassId } from "./mission/types";
import { startResultSync } from "./offline/runtime";
import PwaPanel from "./pwa/PwaPanel";

function missionErrorMessage(error: unknown): string {
  if (!(error instanceof AuthClientError)) return "MISSION SERVICE UNAVAILABLE. TRY AGAIN.";
  switch (error.code) {
    case "MISSION_PREPARATION_EXPIRED":
      return "THE FRESH CHECK EXPIRED. TAKE CONTROLS AGAIN.";
    case "MISSION_AIRCRAFT_STALE":
    case "MISSION_AIRCRAFT_UNAVAILABLE":
      return "THE AIRCRAFT IS NO LONGER FRESH AND ELIGIBLE.";
    case "MISSION_CAPACITY_UNAVAILABLE":
      return "ACTIVE-FLIGHT CAPACITY IS FULL. TRY AGAIN SHORTLY.";
    case "ADMISSION_DENIED":
      return "NEW MISSIONS ARE TEMPORARILY PAUSED.";
    default:
      return "MISSION COULD NOT BE LOCKED. TRY AGAIN.";
  }
}

function canRetryMissionLock(error: unknown): boolean {
  return !(error instanceof AuthClientError) || ![
    "MISSION_PREPARATION_EXPIRED",
    "MISSION_PREPARATION_INVALID",
    "MISSION_DESTINATION_INVALID",
    "MISSION_IDEMPOTENCY_CONFLICT",
  ].includes(error.code ?? "");
}

/** Guarded read of the spawn-heading-to-FAF preference; default on when storage is unavailable. */
function readFaceApproachPreference(): boolean {
  try {
    return shouldFaceApproach(typeof window === "undefined" ? null : window.localStorage);
  } catch {
    return true;
  }
}

export default function App({ initialAuthToken = null }: { initialAuthToken?: string | null }) {
  const mode = useStore((s) => s.mode);
  const contacts = useStore((s) => s.contacts);
  const selectedHex = useStore((s) => s.selectedHex);
  const home = useStore((s) => s.home);
  const savedCenter = useStore((s) => s.savedCenter);
  const lockedMission = useStore((s) => s.lockedMission);
  const feedStatus = useStore((s) => s.feedStatus);
  const providerAvailable = useStore((s) => s.providerAvailable);
  const systemMode = useStore((s) => s.systemMode);
  const [returnToken, setReturnToken] = useState(initialAuthToken);
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [authStatus, setAuthStatus] = useState<"loading" | "anonymous" | "authenticated">("loading");
  const [authError, setAuthError] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [pendingBriefing, setPendingBriefing] = useState<ProvisionalBriefingReference | null>(null);
  const [quickStartOpen, setQuickStartOpen] = useState(() =>
    shouldShowQuickStart(typeof window === "undefined" ? null : window.localStorage));
  const [trainingHandoffPending, setTrainingHandoffPending] = useState(false);
  const [contactFocusRequest, setContactFocusRequest] = useState(0);
  const [missionCommit, setMissionCommit] = useState<MissionCommitState>({ status: "idle" });
  const [tutorialProgress, setTutorialProgress] = useState(() => {
    if (typeof window === "undefined") return EMPTY_TUTORIAL_PROGRESS;
    try { return loadTutorialProgress(window.localStorage); } catch { return EMPTY_TUTORIAL_PROGRESS; }
  });
  const missionOperation = useRef(0);
  const tutorialStartUpdate = useRef<Promise<SessionProfile> | null>(null);
  const previousMode = useRef(mode);

  const applyProfile = useCallback((nextProfile: SessionProfile) => {
    setProfile(nextProfile);
    useStore.getState().setSavedCenter(nextProfile.center);
    useStore.getState().setPollingIdentity("signed");
  }, []);

  const requireSignIn = useCallback((aircraftHex?: string) => {
    if (aircraftHex !== undefined) {
      try {
        saveProvisionalBriefing(sessionStorage, { aircraftHex });
      } catch {
        // The sheet remains usable if session storage is unavailable.
      }
    }
    setSignInOpen(true);
  }, []);

  const authReturned = useCallback((nextProfile: SessionProfile) => {
    applyProfile(nextProfile);
    setAuthStatus("authenticated");
    setAuthError(false);
    setReturnToken(null);
    try {
      setPendingBriefing(loadProvisionalBriefing(sessionStorage));
    } catch {
      setPendingBriefing(null);
    }
  }, [applyProfile]);

  const authReturnFailed = useCallback(() => {
    setReturnToken(null);
    setAuthStatus("anonymous");
    setAuthError(true);
    useStore.getState().setSavedCenter(null);
    useStore.getState().setPollingIdentity("anonymous");
  }, []);

  useEffect(() => {
    if (returnToken !== null || profile !== null) return;
    let active = true;
    void loadCurrentProfile()
      .then((current) => {
        if (!active) return;
        if (current === null) {
          setProfile(null);
          useStore.getState().setSavedCenter(null);
          useStore.getState().setPollingIdentity("anonymous");
        } else {
          applyProfile(current);
        }
        setAuthStatus(current === null ? "anonymous" : "authenticated");
      })
      .catch(() => {
        if (active) {
          setAuthStatus("anonymous");
          useStore.getState().setSavedCenter(null);
          useStore.getState().setPollingIdentity("anonymous");
        }
      });
    return () => {
      active = false;
    };
  }, [applyProfile, profile, returnToken]);

  useEffect(() => {
    let active = true;
    void loadTurnstileSiteKey()
      .then((siteKey) => {
        if (active) setTurnstileSiteKey(siteKey);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    return startResultSync();
  }, [authStatus]);

  useEffect(() => {
    if (pendingBriefing === null || !contacts.has(pendingBriefing.aircraftHex)) return;
    if (selectedHex !== pendingBriefing.aircraftHex) {
      useStore.getState().select(pendingBriefing.aircraftHex);
    }
  }, [contacts, pendingBriefing, selectedHex]);

  const selectedContact = selectedHex === null ? null : contacts.get(selectedHex) ?? null;
  const briefing = useProvisionalBriefing({
    contact: selectedContact,
    feedStatus,
    providerAvailable,
  });

  useEffect(() => {
    if (pendingBriefing === null || briefing.state.status === "idle" || briefing.state.status === "loading") return;
    if (briefing.state.contact.hex !== pendingBriefing.aircraftHex) return;
    if (briefing.state.status === "ready" && pendingBriefing.airportIcao && pendingBriefing.runwayIdent) {
      const restored = [briefing.state.assignment.best, ...briefing.state.assignment.alternatives]
        .find((choice) => choice.airportIdent === pendingBriefing.airportIcao &&
          choice.runwayEndIdent === pendingBriefing.runwayIdent);
      if (restored) briefing.selectAssignment(assignmentKey(restored));
    }
    setPendingBriefing(null);
  }, [briefing, pendingBriefing]);

  // A legacy ?takeover=<hex> link now opens the same provisional briefing as a map/list
  // selection. It cannot bypass the mission overview, authentication, or later revalidation.
  const takeoverMessage = useUrlTakeover();
  const immersive = useStore((s) => s.immersive);
  const chromeVisible = useStore((s) => s.chromeVisible);
  const decluttered = useStore((s) => s.decluttered);
  // Bridged up from ViewerHost's bundle, not zustand: StatusBar is a flex sibling of
  // ViewerHost here, not a Provider descendant, so it can't read viewerContext directly.
  const [terrainNote, setTerrainNote] = useState<string | null>(null);

  // Responsive layout (mobile sub-feature 1). At wide widths `narrow` is false and every
  // branch below falls back to the original desktop render — desktop is unchanged.
  const { width } = useViewport();
  const narrow = isNarrowViewport(width);
  const [contactsOpen, setContactsOpen] = useState(false);
  // The install/app instructions dialog is lifted here so the fading AppModeHint's HELP link can
  // open it even after the APP button is gone (in flight).
  const [appPanelOpen, setAppPanelOpen] = useState(false);
  const browseDrawer = narrow && mode === "BROWSE";
  // Mobile immersive/fullscreen flight (#13): collapse the StatusBar to feed-status + attribution,
  // and fade it with the informational chrome while the video-player auto-hide is active.
  const immersiveActive = isImmersiveActive(immersive, mode);
  // Mobile flight = any narrow FLYING viewport; drives the chrome auto-hide + funnel-chip
  // repositioning even before the player requests true fullscreen (owner declutter 2026-08-11).
  const mobileFlight = narrow && mode === "FLYING";
  const statusFaded = (immersiveActive || mobileFlight) && !chromeVisible;

  const focusContacts = useCallback(() => {
    if (browseDrawer) setContactsOpen(true);
    setContactFocusRequest((request) => request + 1);
  }, [browseDrawer]);

  const dismissGuide = useCallback(() => {
    try {
      dismissQuickStart(localStorage);
    } catch {
      // Dismiss for this render even when storage is unavailable.
    }
    setQuickStartOpen(false);
  }, []);

  useEffect(() => {
    missionOperation.current += 1;
    setMissionCommit({ status: "idle" });
  }, [selectedHex]);

  const selectionLocked = missionCommit.status === "locking" ||
    missionCommit.status === "reconfirm" ||
    (missionCommit.status === "error" && missionCommit.retry !== undefined);

  useEffect(() => {
    useStore.getState().setSelectionLocked(selectionLocked);
    return () => useStore.getState().setSelectionLocked(false);
  }, [selectionLocked]);

  const commitPreparation = useCallback(async (
    preparation: MissionPreparationView,
    idempotencyKey: string,
    operation: number,
  ) => {
    if (profile === null) return;
    if (missionOperation.current !== operation) return;
    setMissionCommit({ status: "locking", preparation, idempotencyKey });
    try {
      const mission = await lockMission({
        preparationToken: preparation.preparationToken,
        choiceKey: missionChoiceKey(preparation.selected),
        assist: profile.defaultAssist,
      }, idempotencyKey);
      if (missionOperation.current !== operation) return;
      if (!useStore.getState().startLockedMission(mission)) {
        throw new Error("Locked mission could not enter countdown");
      }
      setMissionCommit({ status: "locked", mission });
    } catch (error) {
      if (missionOperation.current !== operation) return;
      setMissionCommit({
        status: "error",
        message: missionErrorMessage(error),
        ...(canRetryMissionLock(error)
          ? { retry: { preparation, idempotencyKey } }
          : {}),
      });
    }
  }, [profile]);

  useEffect(() => {
    if (mode === "BROWSE" && lockedMission === null && missionCommit.status === "locked") {
      missionOperation.current += 1;
      setMissionCommit({ status: "idle" });
    }
  }, [lockedMission, missionCommit.status, mode]);

  // Bundled airport index for the instant-flight destination; parsed once (validateAirports runs
  // on every loadAirports call, so memoize it rather than re-parse on each takeover).
  const airports = useMemo(() => loadAirports(), []);

  const takeControls = useCallback(() => {
    if (briefing.state.status !== "ready") {
      // B4: nothing selected → auto-pick the nearest flyable contact (spec one-click start). If a
      // contact IS selected but its briefing is still loading, just wait. Center on HOME, else the
      // saved map center; without either we cannot rank by distance, so fall through to no-op.
      if (selectedHex !== null) return;
      const center = home ?? savedCenter;
      if (center === null) return;
      const nearest = nearestFlyableContact([...contacts.values()], center.lat, center.lon);
      if (nearest === null) return;
      if (authStatus !== "authenticated") {
        // Anon: fly it now, instant + unranked — no selection/briefing round-trip.
        try {
          const mission = buildInstantMission(nearest, airports, {
            missionId: crypto.randomUUID(),
            faceApproach: readFaceApproachPreference(),
          });
          if (useStore.getState().startInstantFlight(mission)) return;
        } catch {
          // Unsupported/no-airport: leave selection untouched.
        }
        return;
      }
      // Authed: select it so the ranked briefing loads; the player confirms with a second press.
      useStore.getState().select(nearest.hex);
      return;
    }
    if (authStatus !== "authenticated") {
      // Fly-first / sign-in-later (B3): anonymous users get an instant, unranked flight on the
      // selected contact — no prepare/lock/sign-in/reload bounce. Signed-in users keep the ranked
      // prepare path below. If the instant build is impossible (unsupported contact, no airport
      // data), fall back to the sign-in flow with restorable provisional state.
      try {
        const mission = buildInstantMission(briefing.state.contact, airports, {
          missionId: crypto.randomUUID(),
          faceApproach: readFaceApproachPreference(),
        });
        if (useStore.getState().startInstantFlight(mission)) return;
      } catch {
        // Fall through to sign-in.
      }
      try {
        saveProvisionalBriefing(sessionStorage, {
          aircraftHex: briefing.state.contact.hex,
          airportIcao: briefing.state.selected.airportIdent,
          runwayIdent: briefing.state.selected.runwayEndIdent,
        });
      } catch {
        // Authentication remains available without restorable provisional state.
      }
      setSignInOpen(true);
      return;
    }
    if (missionCommit.status === "error" && missionCommit.retry !== undefined) {
      const operation = missionOperation.current + 1;
      missionOperation.current = operation;
      void commitPreparation(
        missionCommit.retry.preparation,
        missionCommit.retry.idempotencyKey,
        operation,
      );
      return;
    }
    const operation = missionOperation.current + 1;
    missionOperation.current = operation;
    setMissionCommit({ status: "preparing" });
    void prepareMission(prepareRequestForBriefing(briefing.state))
      .then((outcome) => {
        if (missionOperation.current !== operation) return;
        const idempotencyKey = crypto.randomUUID();
        if (outcome.kind === "reconfirm") {
          setMissionCommit({
            status: "reconfirm",
            provisional: briefing.state.status === "ready"
              ? briefing.state.selected
              : outcome.preparation.selected,
            preparation: outcome.preparation,
            idempotencyKey,
          });
          return;
        }
        return commitPreparation(outcome.preparation, idempotencyKey, operation);
      })
      .catch((error) => {
        if (missionOperation.current !== operation) return;
        setMissionCommit({ status: "error", message: missionErrorMessage(error) });
      });
  }, [airports, authStatus, briefing.state, commitPreparation, missionCommit, selectedHex, home, savedCenter, contacts]);

  // FLY AGAIN (B5): the instant-flight debrief restarts a fresh flight. FlightSession has already
  // torn the old flight down and returned to BROWSE by the time this runs; we defer one tick so
  // that state commits, then re-run take-controls (same selected contact if still selected, else
  // the nearest flyable). A ref keeps this pointing at the latest take-controls closure.
  const takeControlsRef = useRef(takeControls);
  takeControlsRef.current = takeControls;
  const flyAgain = useCallback(() => {
    window.setTimeout(() => takeControlsRef.current(), 0);
  }, []);

  const startTutorial = useCallback((classId: AircraftClassId) => {
    const definition = tutorialDefinitionForClass(classId);
    const started = useStore.getState().startTutorial(
      buildTutorialMission(classId),
      tutorialRun(definition),
    );
    if (!started) return false;
    try { setTutorialProgress(markTutorialStarted(localStorage)); } catch {
      setTutorialProgress((current) => ({ ...current, started: true }));
    }
    if (profile !== null && profile.tutorialState === "new") {
      const request = updateCurrentProfile({ tutorialState: "started" });
      tutorialStartUpdate.current = request;
      void request
        .then(applyProfile)
        .catch(() => undefined)
        .finally(() => {
          if (tutorialStartUpdate.current === request) tutorialStartUpdate.current = null;
        });
    }
    return true;
  }, [applyProfile, profile]);

  const startFreeFlight = useCallback(
    (classId: AircraftClassId, opts: { altitudeFt: number; headingDeg: number }) => {
      // Build here where crypto.randomUUID is available; the pure builder accepts the id.
      const mission = buildFreeFlightMission(classId, {
        ...opts,
        missionId: crypto.randomUUID(),
      });
      return useStore.getState().startFreeFlight(mission);
    },
    [],
  );

  useEffect(() => {
    const returnedFromTraining = trainingHandoffPending &&
      previousMode.current !== "BROWSE" && mode === "BROWSE";
    previousMode.current = mode;
    if (!returnedFromTraining) return;
    setTrainingHandoffPending(false);
    focusContacts();
  }, [focusContacts, mode, trainingHandoffPending]);

  const completeTutorial = useCallback((classId: AircraftClassId) => {
    try { setTutorialProgress(markTutorialCompleted(localStorage, classId)); } catch {
      setTutorialProgress((current) => ({
        ...current,
        started: true,
        completedClasses: current.completedClasses.includes(classId)
          ? current.completedClasses
          : [...current.completedClasses, classId],
      }));
    }
    if (profile !== null && profile.tutorialState !== "complete") {
      // Keep the signed profile transition monotonic even if a very short tutorial ends
      // while its earlier "started" request is still in flight.
      const afterStarted = tutorialStartUpdate.current?.catch(() => undefined) ?? Promise.resolve();
      void afterStarted
        .then(() => updateCurrentProfile({ tutorialState: "complete" }))
        .then(applyProfile)
        .catch(() => undefined);
    }
  }, [applyProfile, profile]);

  const completeCoaching = useCallback(() => {
    if (profile === null || !profile.coachingEnabled) return;
    void updateCurrentProfile({ coachingEnabled: false }).then(applyProfile).catch(() => undefined);
  }, [applyProfile, profile]);

  const authoritativePreparation = missionCommit.status === "reconfirm" ||
    missionCommit.status === "locking"
    ? missionCommit.preparation
    : missionCommit.status === "error"
      ? missionCommit.retry?.preparation ?? null
      : null;
  const route = missionCommit.status === "locked"
    ? { contact: missionCommit.mission.contact, assignment: missionCommit.mission.assignment }
    : authoritativePreparation !== null
      ? { contact: authoritativePreparation.contact, assignment: authoritativePreparation.selected }
      : briefing.state.status === "ready"
        ? { contact: briefing.state.contact, assignment: briefing.state.selected }
        : null;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1">
          <ViewerHost onTerrainNoteChange={setTerrainNote}>
            <ContactLayer />
            <OverlayLayers route={mode === "BROWSE" ? route : null} />
            <FlightSession
              coachingEnabled={profile?.tutorialState === "complete" && profile.coachingEnabled}
              onTutorialComplete={completeTutorial}
              onCoachingComplete={completeCoaching}
              onSignInToRank={() => setSignInOpen(true)}
              onFlyAgain={flyAgain}
            />
          </ViewerHost>
          {mode === "BROWSE" && (
            <button
              type="button"
              className="status-chip-button quick-start-help"
              onClick={() => {
                if (selectionLocked) return;
                useStore.getState().select(null);
                missionOperation.current += 1;
                setMissionCommit({ status: "idle" });
                setQuickStartOpen(true);
              }}
              disabled={selectionLocked}
            >
              How to fly
            </button>
          )}
          {mode === "BROWSE" && quickStartOpen && selectedHex === null && (
            <QuickStartNotice
              onDismiss={dismissGuide}
              onFlyNow={() => {
                // Fly-first: no selection → takeControls auto-picks the nearest flyable and (for an
                // anonymous visitor) instant-flies it, no sign-in (B3c → B4/B3b).
                dismissGuide();
                takeControls();
              }}
              onSelectPlane={() => {
                dismissGuide();
                focusContacts();
              }}
              onStartTraining={() => {
                dismissGuide();
                if (startTutorial("c172s")) setTrainingHandoffPending(true);
              }}
            />
          )}
          {mode === "BROWSE" && (
            <MissionTray
              state={briefing.state}
              profile={profile}
              onClose={() => {
                useStore.getState().setSelectionLocked(false);
                useStore.getState().select(null);
                missionOperation.current += 1;
                setMissionCommit({ status: "idle" });
              }}
              onSelectAssignment={(key) => {
                briefing.selectAssignment(key);
                missionOperation.current += 1;
                setMissionCommit({ status: "idle" });
              }}
              onTakeControls={takeControls}
              commitState={missionCommit}
              onConfirmMission={() => {
                if (missionCommit.status === "reconfirm") {
                  void commitPreparation(
                    missionCommit.preparation,
                    missionCommit.idempotencyKey,
                    missionOperation.current,
                  );
                }
              }}
              onSelectReconfirmed={(key) => {
                setMissionCommit((current) => {
                  if (current.status !== "reconfirm") return current;
                  const selected = current.preparation.eligibleChoices.find(
                    (choice) => missionChoiceKey(choice) === key,
                  );
                  return selected === undefined
                    ? current
                    : {
                        ...current,
                        preparation: { ...current.preparation, selected },
                      };
                });
              }}
            />
          )}
          {browseDrawer && contactsOpen && (
            <div className="contact-drawer">
              <ContactList
                focusRequest={contactFocusRequest}
                onSelected={() => setContactsOpen(false)}
              />
            </div>
          )}
          {takeoverMessage !== null && mode === "BROWSE" && (
            <div className="takeover-banner">{takeoverMessage}</div>
          )}
          {systemMode === "KILL_SWITCH" && (
            <div className="maintenance-banner" role="status">
              SYSTEM MAINTENANCE — LIVE TRAFFIC AND SERVER ACTIONS ARE UNAVAILABLE. LOCAL TRAINING REMAINS AVAILABLE.
            </div>
          )}
          {/* In immersive flight the funnel chips (SIGN IN / APP / …) drop below the HUD bar and
              join the chrome auto-hide — they were overlapping the bar's THR field and the FULL
              toggle, and added clutter (owner 2026-08-11). */}
          <div
            className={
              "top-controls" +
              (immersiveActive || mobileFlight ? " top-controls-immersive" : "") +
              (statusFaded ? " top-controls-faded" : "")
            }
          >
            {/* Declutter (#57): the APP button and the signed-in PILOT callsign chip are
                informational, not controls — hide them on the manual DCLTR toggle. SIGN IN
                stays reachable (a real action, not chrome) even when decluttered. */}
            <PwaPanel
              mode={mode}
              open={appPanelOpen}
              onOpenChange={setAppPanelOpen}
              showButton={mode === "BROWSE" && !decluttered}
            />
            {narrow && <AppModeHint mode={mode} onHelp={() => setAppPanelOpen(true)} />}
            {mode === "BROWSE" && (
              <TutorialPanel progress={tutorialProgress} onStart={startTutorial} />
            )}
            {mode === "BROWSE" && <FreeFlightPanel onStart={startFreeFlight} />}
            {mode === "BROWSE" && <LeaderboardPanel />}
            <div className="auth-control">
              {profile === null ? (
                <button className="status-chip-button" onClick={() => requireSignIn()}>
                  {authStatus === "loading" ? "SESSION…" : "SIGN IN"}
                </button>
              ) : (
                !decluttered && (
                  <ProfilePanel
                    profile={profile}
                    onProfile={applyProfile}
                    onSignedOut={() => {
                      setProfile(null);
                      setAuthStatus("anonymous");
                      useStore.getState().setSavedCenter(null);
                      useStore.getState().setPollingIdentity("anonymous");
                    }}
                  />
                )
              )}
            </div>
          </div>
          <AuthReturn
            token={returnToken}
            onAuthenticated={authReturned}
            onFailure={authReturnFailed}
          />
          {authError && (
            <div className="auth-notice auth-error label" role="alert">
              SIGN-IN LINK IS INVALID OR EXPIRED.
            </div>
          )}
          {signInOpen && (
            <SignInSheet
              siteKey={turnstileSiteKey}
              onClose={() => setSignInOpen(false)}
              onAuthenticated={authReturned}
            />
          )}
        </div>
        {mode === "BROWSE" && !narrow && (
          <div className="w-80 flex-none">
            <ContactList focusRequest={contactFocusRequest} />
          </div>
        )}
      </div>
      <StatusBar
        terrainNote={terrainNote}
        contactsChip={
          browseDrawer
            ? { open: contactsOpen, onToggle: () => setContactsOpen((o) => !o) }
            : undefined
        }
        immersive={immersiveActive || mobileFlight}
        faded={statusFaded}
      />
    </div>
  );
}
