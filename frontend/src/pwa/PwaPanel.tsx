import { useState, useSyncExternalStore } from "react";

import type { Mode } from "../game/machine";
import {
  getResultQueueSnapshot,
  subscribeResultQueue,
  syncQueuedMissionResults,
} from "../offline/runtime";
import {
  applyWaitingUpdate,
  getPwaSnapshot,
  promptInstall,
  requestAppFullscreen,
  subscribePwa,
} from "./serviceWorker";

function Check({ complete, children }: { complete: boolean; children: string }) {
  return <li className={complete ? "pwa-complete" : ""}>{complete ? "✓" : "○"} {children}</li>;
}

export default function PwaPanel({
  mode,
  open: openProp,
  onOpenChange,
  showButton = mode === "BROWSE",
}: {
  mode: Mode;
  /** When provided, the dialog is controlled by the parent (so a Help link elsewhere can open it). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Whether to show the APP chip button (browse chrome only; the parent also hides it on DCLTR). */
  showButton?: boolean;
}) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = onOpenChange ?? setOpenInternal;
  const pwa = useSyncExternalStore(subscribePwa, getPwaSnapshot, getPwaSnapshot);
  const results = useSyncExternalStore(
    subscribeResultQueue,
    getResultQueueSnapshot,
    getResultQueueSnapshot,
  );
  return (
    <div className="pwa-control">
      {/* The APP button is browse chrome only — it's gone once you're flying (owner 2026-08-12);
          in flight the dialog is reached from the fading "app mode" hint's Help link instead. */}
      {showButton && (
        <button className="status-chip-button" type="button" onClick={() => setOpen(true)}>
          {results.pendingCount > 0 ? `SYNC ${results.pendingCount}` : "APP"}
        </button>
      )}
      {open && (
        <div className="pwa-backdrop">
          <section className="panel pwa-panel" role="dialog" aria-label="Install and offline status">
            <div className="pwa-heading">
              <h2>INSTALL & OFFLINE</h2>
              <button className="auth-close" type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            <ol className="pwa-checklist">
              <Check complete={pwa.standalone}>Install or Add to Home Screen</Check>
              <Check complete={pwa.landscape}>Rotate to landscape</Check>
              <Check complete={pwa.fullscreen || pwa.standalone}>Enter fullscreen / standalone</Check>
              <Check complete={results.pendingCount === 0}>No results waiting to sync</Check>
            </ol>
            {!pwa.standalone && pwa.installAvailable && (
              <button className="control-button" type="button" onClick={() => void promptInstall()}>
                INSTALL APP
              </button>
            )}
            {!pwa.standalone && !pwa.installAvailable && (
              <p className="pwa-copy">On iPhone/iPad: Share → Add to Home Screen. On desktop, use the browser install icon.</p>
            )}
            {/* Only offer the button where it actually works. iOS Safari has no
                Element.requestFullscreen, so it was a silent no-op there (#77) — hide it and let the
                Add-to-Home-Screen guidance above be the real iOS fullscreen path. */}
            {!pwa.fullscreen && pwa.canFullscreen && (
              <button className="control-button" type="button" onClick={() => void requestAppFullscreen()}>
                ENTER FULLSCREEN
              </button>
            )}
            {!pwa.fullscreen && !pwa.canFullscreen && !pwa.standalone && (
              <p className="pwa-copy">This browser can't fullscreen a web app — Add to Home Screen for a fullscreen, standalone launch.</p>
            )}
            {results.pendingCount > 0 && (
              <button className="control-button" type="button" disabled={!pwa.online || results.syncing}
                onClick={() => void syncQueuedMissionResults()}>
                {results.syncing ? "SYNCING…" : "RETRY RESULTS"}
              </button>
            )}
            {results.message !== null && <div className="label pwa-message">{results.message}</div>}
            {pwa.waiting && (
              <button className="control-button" type="button" disabled={mode !== "BROWSE"}
                onClick={applyWaitingUpdate}>
                {mode === "BROWSE" ? "APPLY READY UPDATE" : "UPDATE WAITS UNTIL BROWSE"}
              </button>
            )}
            <p className="pwa-copy">
              The app shell, simulator assets, airport data, and tutorials can reload offline.
              Live traffic, sign-in, mission locks, and authoritative grading always require the server.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
