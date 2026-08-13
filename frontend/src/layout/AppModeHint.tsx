import type { Mode } from "../game/machine";

/**
 * A quiet nudge that the game plays best in landscape, full-screen "app mode" — the gentle
 * replacement for the old blocking ROTATE-TO-LANDSCAPE dialog (owner 2026-08-12). "HELP" opens the
 * install/app instructions. It fades out as the flight starts (visible through BROWSE + COUNTDOWN,
 * gone once FLYING) so it never sits over the cockpit.
 */
export default function AppModeHint({ mode, onHelp }: { mode: Mode; onHelp: () => void }) {
  const faded = mode !== "BROWSE" && mode !== "COUNTDOWN";
  return (
    <div className={"app-mode-hint" + (faded ? " app-mode-hint-faded" : "")} aria-hidden={faded}>
      <span className="app-mode-hint-text">BEST IN LANDSCAPE · FULL-SCREEN APP MODE</span>
      <button type="button" className="app-mode-hint-help" onClick={onHelp}>
        HELP
      </button>
    </div>
  );
}
