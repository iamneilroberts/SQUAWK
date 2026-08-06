/*
 * Bottom status strip: honest feed health (LIVE/STALE/OFFLINE), live contact count, a UTC
 * clock, and the static Esri attribution line. The clock ticks on a plain 1s interval,
 * cleaned up on unmount — no fancier scheduling needed for a display-only readout.
 */
import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import type { FeedStatus } from "../data/types";

export function formatUtcClock(now: Date): string {
  return now.toISOString().slice(11, 19) + "Z";
}

export function feedChipLabel(status: FeedStatus, source: string | null): string {
  if (status === "live") return `LIVE ${source ?? "—"}`;
  return status.toUpperCase();
}

/**
 * Honest terrain-tier readout (spec's degrade-honestly rule): cyan for a real terrain source
 * (Re:Earth or the ion fallback), amber for the flat-ellipsoid warning. Null (not yet attached)
 * reads as nominal so the chip doesn't flash amber before the first attachTerrain resolves.
 */
export function terrainChipClass(note: string | null): string {
  return note !== null && note.includes("UNAVAILABLE") ? "status-chip-warn" : "status-chip-live";
}

type StatusBarProps = {
  /** Bridged down from App.tsx, which gets it from ViewerHost — not zustand (see App.tsx). */
  terrainNote: string | null;
};

export default function StatusBar({ terrainNote }: StatusBarProps) {
  const feedStatus = useStore((s) => s.feedStatus);
  const feedSource = useStore((s) => s.feedSource);
  const contactCount = useStore((s) => s.contacts.size);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const chipClass = feedStatus === "live" ? "status-chip-live" : "status-chip-warn";

  return (
    <div className="status-bar">
      <span className={chipClass}>{feedChipLabel(feedStatus, feedSource)}</span>
      {feedStatus === "offline" && <span className="status-chip-warn">FEEDS UNREACHABLE</span>}
      {terrainNote !== null && <span className={terrainChipClass(terrainNote)}>{terrainNote}</span>}
      <span>CONTACTS {contactCount}</span>
      <span>{formatUtcClock(now)}</span>
      <span className="flex-1" />
      <span>IMAGERY © ESRI · {terrainNote ?? "TERRAIN LOADING…"}</span>
    </div>
  );
}
