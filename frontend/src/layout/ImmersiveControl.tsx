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
 *  3. The chrome auto-hide. While actively FLYING the chrome is hidden; MENU stays as the one
 *     always-visible control, and tapping it (pause) or a live warning reveals everything. No idle
 *     clock, no pointer listeners (owner 2026-08-13: touch-to-reveal fought constant flight input).
 */
import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { isImmersiveActive, showImmersiveToggle } from "./immersive";
import {
  requestAppFullscreen, exitAppFullscreen, fullscreenSupported, isStandalone, shouldShowInstallHint,
} from "./fullscreen";
import { useViewport } from "./useViewport";
import { isNarrowViewport } from "./viewport";

export default function ImmersiveControl(
  { warningActive, onMenu, faded = false }:
    { warningActive: boolean; onMenu: () => void; faded?: boolean },
) {
  const mode = useStore((s) => s.mode);
  const immersive = useStore((s) => s.immersive);
  const setImmersive = useStore((s) => s.setImmersive);
  const setChromeVisible = useStore((s) => s.setChromeVisible);
  const { width } = useViewport();
  const narrow = isNarrowViewport(width);
  // Auto-hide arms on ANY narrow flight (owner 2026-08-11: clutter never faded in a plain browser
  // tab because the fade was fullscreen-gated), AND on desktop once immersive is requested (owner
  // 2026-08-12: desktop immersive is an opt-in that also declutters). Desktop non-immersive stays
  // untouched — isImmersiveActive is false there, so the chrome never auto-hides.
  const autoHideActive = (narrow && mode === "FLYING") || isImmersiveActive(immersive, mode);

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

  // ---- chrome auto-hide, redesigned (owner 2026-08-13) ----
  // In a flight game the pilot is CONSTANTLY touching the stick/throttle, so the old "reveal on any
  // tap" idle timer meant the chrome never stayed hidden while flying. New rule: while actively
  // FLYING the chrome is HIDDEN; MENU (below) is the one control that never fades, and tapping it
  // PAUSES — which flips mode off FLYING and reveals everything. A live warning also forces it back
  // (safety). No pointer listeners, so flight input never disturbs the fade.
  useEffect(() => {
    setChromeVisible(!autoHideActive || mode !== "FLYING" || warningActive);
  }, [autoHideActive, mode, warningActive, setChromeVisible]);

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

  if (!showImmersiveToggle(mode)) return null;

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
        className={"immersive-toggle" + (faded ? " immersive-toggle-faded" : "")}
        onClick={immersive ? onExit : onEnter}
        aria-pressed={immersive}
      >
        {immersive ? "EXIT ⤢" : "FULL ⤢"}
      </button>
      {/* MENU (#58, owner 2026-08-13; DCLTR removed #hud-chrome-rework — the manual declutter
          chip is gone, `decluttered` in the store now has no toggle, see decisions.md): the ONE
          control that never fades. Everything else in this row (FULL/EXIT), the NAV/WX chip and
          the HUD-A/C toggle hide while flying; MENU stays so the pilot always has a way in.
          Tapping it PAUSES (mode off FLYING), which reveals all the faded chrome for use while
          stopped. It's the abort valve too — one tap out. On desktop it moves to the bottom-right
          corner, grouped with the relocated SIGN IN chip (App.tsx .top-controls, tokens.css
          @media min-width:1024px) — mobile keeps its lever-relative position untouched. */}
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
