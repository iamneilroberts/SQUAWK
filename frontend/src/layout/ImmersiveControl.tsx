/*
 * The React glue for mobile immersive / fullscreen flight (#13 follow-up). All the DECISIONS are
 * in the pure, unit-tested helpers (immersive.ts, fullscreen.ts); this component only wires them
 * to the DOM, which the codebase does not jsdom-test (browser-verified, like useViewport).
 *
 * Three jobs, all scoped to a narrow viewport while FLYING (FlightSession gates the mount):
 *  1. The ENTER/EXIT toggle. ENTER requests TRUE fullscreen on the app root — the same
 *     `requestFullscreen()` call a <video> player makes — so Android Chrome / desktop hide the
 *     browser UI. EXIT leaves fullscreen and restores the chrome. A `fullscreenchange` listener
 *     keeps the toggle honest when the user swipes out of fullscreen.
 *  2. Honest iOS degradation. iPhone Safari has no requestFullscreen on a canvas, so the call is a
 *     silent no-op and the in-app declutter carries the mode; a minimal, dismissible "Add to Home
 *     Screen" hint offers the only real fullscreen iOS gives a web app (a standalone PWA). The hint
 *     is suppressed once installed.
 *  3. The video-player auto-hide. While actively flying, the informational overlays fade after an
 *     idle period and reappear on any tap; a live warning or leaving FLYING forces them back. The
 *     decision is the pure overlaysVisible(); this only supplies the clock and the interaction.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { showImmersiveToggle, overlaysVisible } from "./immersive";
import {
  requestAppFullscreen, exitAppFullscreen, fullscreenSupported, isStandalone, shouldShowInstallHint,
} from "./fullscreen";
import { useViewport } from "./useViewport";
import { isNarrowViewport } from "./viewport";

/** How often the auto-hide re-checks the idle clock. 500 ms is well finer than the 3 s timeout. */
const AUTOHIDE_POLL_MS = 500;

export default function ImmersiveControl(
  { warningActive, onMenu }: { warningActive: boolean; onMenu: () => void },
) {
  const mode = useStore((s) => s.mode);
  const immersive = useStore((s) => s.immersive);
  const setImmersive = useStore((s) => s.setImmersive);
  const setChromeVisible = useStore((s) => s.setChromeVisible);
  const decluttered = useStore((s) => s.decluttered);
  const setDeclutter = useStore((s) => s.setDeclutter);
  const { width } = useViewport();
  const narrow = isNarrowViewport(width);
  // Auto-hide arms on ANY narrow flight, not just requested fullscreen (owner 2026-08-11:
  // clutter never faded in a plain browser tab because the fade was fullscreen-gated).
  const autoHideActive = narrow && mode === "FLYING";

  const [hintDismissed, setHintDismissed] = useState(false);

  // Feature detection is a browser fact, read once per render; the pure branch is tested.
  const supported = fullscreenSupported(typeof document !== "undefined" ? document.documentElement : null);
  const standalone =
    typeof navigator !== "undefined" &&
    isStandalone(
      (navigator as Navigator & { standalone?: boolean }).standalone,
      typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches,
    );
  const showHint = immersive && shouldShowInstallHint(supported, standalone) && !hintDismissed;

  // ---- auto-hide: keep the idle clock and fade the informational overlays (video pattern) ----
  const lastInteractionRef = useRef(Date.now());
  const warnRef = useRef(warningActive);
  warnRef.current = warningActive;

  useEffect(() => {
    if (!autoHideActive) {
      setChromeVisible(true);
      return;
    }
    const bump = () => {
      lastInteractionRef.current = Date.now();
      setChromeVisible(true);
    };
    // Enter fully visible, then let the idle clock fade it.
    bump();
    // Any tap on the flight surface (canvas, stick, throttle, buttons) counts as interaction.
    window.addEventListener("pointerdown", bump);
    const id = setInterval(() => {
      setChromeVisible(
        overlaysVisible("FLYING", Date.now() - lastInteractionRef.current, warnRef.current),
      );
    }, AUTOHIDE_POLL_MS);
    return () => {
      window.removeEventListener("pointerdown", bump);
      clearInterval(id);
      setChromeVisible(true);
    };
  }, [autoHideActive, setChromeVisible]);

  // A warning appearing must reveal the chrome immediately (before the next poll) AND reset the
  // idle window so it lingers after the warning clears — treat it as an interaction.
  useEffect(() => {
    if (autoHideActive && warningActive) {
      lastInteractionRef.current = Date.now();
      setChromeVisible(true);
    }
  }, [autoHideActive, warningActive, setChromeVisible]);

  // ---- keep the toggle honest when the user leaves fullscreen by a browser gesture ----
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => {
      if (!document.fullscreenElement && useStore.getState().immersive) {
        useStore.getState().setImmersive(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  if (!showImmersiveToggle(narrow, mode)) return null;

  const onEnter = () => {
    setImmersive(true);
    void requestAppFullscreen(typeof document !== "undefined" ? document.documentElement : null);
  };
  const onExit = () => {
    setImmersive(false);
    if (typeof document !== "undefined") void exitAppFullscreen(document);
  };

  return (
    <>
      <button
        type="button"
        className="immersive-toggle"
        onClick={immersive ? onExit : onEnter}
        aria-pressed={immersive}
      >
        {immersive ? "EXIT ⤢" : "FULL ⤢"}
      </button>
      {/* Manual declutter (#57): a sibling chip to the left of FULL/EXIT so the two never
          overlap (see .declutter-toggle in tokens.css). Independent of the auto-hide above —
          this hides informational chrome (HUD toggle, APP/PILOT chips, traffic labels) on a
          deliberate tap, not on an idle timer. */}
      <button
        type="button"
        className={"immersive-toggle declutter-toggle" + (decluttered ? " declutter-toggle-on" : "")}
        onClick={() => setDeclutter(!decluttered)}
        aria-pressed={decluttered}
      >
        DCLTR
      </button>
      {/* MENU (#58): the mobile abort valve. Fires the same PAUSE as desktop Escape, so
          PauseOverlay offers RESUME or QUIT TO BROWSE. A control chip (not informational), so it
          sits with FULL/EXIT/DCLTR and is never hidden by declutter or the idle auto-hide — a
          player who falls through un-sampled terrain must always be able to get out. */}
      <button
        type="button"
        className="immersive-toggle menu-toggle"
        onClick={onMenu}
        aria-label="Pause menu"
      >
        MENU
      </button>
      {showHint && (
        <div className="immersive-hint" role="note">
          <span>ADD TO HOME SCREEN FOR FULLSCREEN</span>
          <button
            type="button"
            className="immersive-hint-dismiss"
            onClick={() => setHintDismissed(true)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
