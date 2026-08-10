import { useCallback, useEffect, useRef, useState } from "react";
import ViewerHost from "./globe/ViewerHost";
import ContactLayer from "./globe/ContactLayer";
import OverlayLayers from "./globe/OverlayLayers";
import FlightSession from "./game/FlightSession";
import ContactList from "./panels/ContactList";
import StatusBar from "./panels/StatusBar";
import RotateCard from "./layout/RotateCard";
import { useViewport } from "./layout/useViewport";
import { isNarrowViewport, shouldShowRotateCard } from "./layout/viewport";
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
  type ProvisionalBriefingReference,
  type SessionProfile,
} from "./auth/session";
import ProfilePanel from "./profile/ProfilePanel";
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

export default function App({ initialAuthToken = null }: { initialAuthToken?: string | null }) {
  const mode = useStore((s) => s.mode);
  const contacts = useStore((s) => s.contacts);
  const selectedHex = useStore((s) => s.selectedHex);
  const feedStatus = useStore((s) => s.feedStatus);
  const providerAvailable = useStore((s) => s.providerAvailable);
  const [returnToken, setReturnToken] = useState(initialAuthToken);
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [authStatus, setAuthStatus] = useState<"loading" | "anonymous" | "authenticated">("loading");
  const [authError, setAuthError] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [pendingBriefing, setPendingBriefing] = useState<ProvisionalBriefingReference | null>(null);
  const [quickStartOpen, setQuickStartOpen] = useState(() =>
    shouldShowQuickStart(typeof window === "undefined" ? null : window.localStorage));
  const [contactFocusRequest, setContactFocusRequest] = useState(0);
  const [missionCommit, setMissionCommit] = useState<MissionCommitState>({ status: "idle" });
  const missionOperation = useRef(0);

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
  // Bridged up from ViewerHost's bundle, not zustand: StatusBar is a flex sibling of
  // ViewerHost here, not a Provider descendant, so it can't read viewerContext directly.
  const [terrainNote, setTerrainNote] = useState<string | null>(null);

  // Responsive layout (mobile sub-feature 1). At wide widths `narrow` is false and every
  // branch below falls back to the original desktop render — desktop is unchanged.
  const { width, height } = useViewport();
  const narrow = isNarrowViewport(width);
  const showRotate = shouldShowRotateCard(width, height, mode);
  const [contactsOpen, setContactsOpen] = useState(false);
  // The rotate hint is dismissible so a player can fly in portrait to see how it looks (owner
  // request); once dismissed it stays gone for the session.
  const [rotateDismissed, setRotateDismissed] = useState(false);
  const browseDrawer = narrow && mode === "BROWSE";
  // Mobile immersive/fullscreen flight (#13): collapse the StatusBar to feed-status + attribution,
  // and fade it with the informational chrome while the video-player auto-hide is active.
  const immersiveActive = isImmersiveActive(immersive, narrow, mode);
  const statusFaded = immersiveActive && !chromeVisible;

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
    missionCommit.status === "locked" ||
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

  const takeControls = useCallback(() => {
    if (briefing.state.status !== "ready") return;
    if (authStatus !== "authenticated") {
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
  }, [authStatus, briefing.state, commitPreparation, missionCommit]);

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
            <OverlayLayers route={route} />
            <FlightSession />
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
              onSelectPlane={() => {
                dismissGuide();
                focusContacts();
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
          {showRotate && !rotateDismissed && (
            <RotateCard onDismiss={() => setRotateDismissed(true)} />
          )}
          {takeoverMessage !== null && mode === "BROWSE" && (
            <div className="takeover-banner">{takeoverMessage}</div>
          )}
          <div className="auth-control">
            {profile === null ? (
              <button className="status-chip-button" onClick={() => requireSignIn()}>
                {authStatus === "loading" ? "SESSION…" : "SIGN IN"}
              </button>
            ) : (
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
            )}
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
        immersive={immersiveActive}
        faded={statusFaded}
      />
    </div>
  );
}
