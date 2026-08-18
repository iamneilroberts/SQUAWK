/*
 * WHAT'S NEW: a curated changelog reachable from the browse screen (docs/data/whatsNew.ts is the
 * curated source of truth — see the convention note at the top of that file). Modeled on the
 * tutorial/pwa dialog styling (shared backdrop/panel/heading classes), scrolling if the list
 * outgrows the panel.
 *
 * Split as usual: `WhatsNewBody` is hook-free and holds every element (and every test); the
 * default export owns the one hook (closing on Escape).
 */
import { useEffect } from "react";
import { WHATS_NEW, type WhatsNewRelease } from "../data/whatsNew";
import { formatReleaseDate } from "./whatsNewSeen";

export function WhatsNewBody({ releases, onClose }: {
  releases: WhatsNewRelease[];
  onClose(): void;
}) {
  return (
    <div className="panel tutorial-panel whatsnew-panel" role="dialog" aria-modal="true" aria-label="What's new">
      <div className="tutorial-heading">
        <h2>WHAT'S NEW</h2>
        <button className="control-button" type="button" onClick={onClose}>CLOSE</button>
      </div>
      {releases.map((release) => (
        <div className="whatsnew-release" key={release.date}>
          <div className="label">
            <span className="whatsnew-date">{formatReleaseDate(release.date)}</span>
            {release.label !== undefined && <span className="whatsnew-label">{release.label.toUpperCase()}</span>}
          </div>
          <ul className="whatsnew-items">
            {release.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function WhatsNew({ onClose }: { onClose(): void }) {
  // Escape closes, matching the other browse-screen dialogs (LeaderboardPanel).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="tutorial-backdrop">
      <WhatsNewBody releases={WHATS_NEW} onClose={onClose} />
    </div>
  );
}
