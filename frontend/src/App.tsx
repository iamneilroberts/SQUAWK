import { useCallback, useEffect, useState } from "react";
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
  loadCurrentProfile,
  loadProvisionalBriefing,
  loadTurnstileSiteKey,
  saveProvisionalBriefing,
  type ProvisionalBriefingReference,
  type SessionProfile,
} from "./auth/session";
import ProfilePanel from "./profile/ProfilePanel";

export default function App({ initialAuthToken = null }: { initialAuthToken?: string | null }) {
  const mode = useStore((s) => s.mode);
  const contacts = useStore((s) => s.contacts);
  const [returnToken, setReturnToken] = useState(initialAuthToken);
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [authStatus, setAuthStatus] = useState<"loading" | "anonymous" | "authenticated">("loading");
  const [authError, setAuthError] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [pendingBriefing, setPendingBriefing] = useState<ProvisionalBriefingReference | null>(null);

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
    useStore.getState().select(pendingBriefing.aircraftHex);
    setPendingBriefing(null);
  }, [contacts, pendingBriefing]);

  // Deep-link auto-takeover (?takeover=<hex>): fires the real ContactList take-control path once
  // the target lands on the feed and is eligible; returns an honest fallback message otherwise.
  // No `?takeover` param → the hook returns null and does nothing, so desktop behaviour is
  // byte-identical to before.
  const takeoverMessage = useUrlTakeover({ authStatus, onSignInRequired: requireSignIn });
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

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1">
          <ViewerHost onTerrainNoteChange={setTerrainNote}>
            <ContactLayer />
            <OverlayLayers />
            <FlightSession />
          </ViewerHost>
          {browseDrawer && contactsOpen && (
            <div className="contact-drawer">
              <ContactList
                authenticated={authStatus === "authenticated"}
                onSignInRequired={requireSignIn}
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
            <ContactList
              authenticated={authStatus === "authenticated"}
              onSignInRequired={requireSignIn}
            />
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
