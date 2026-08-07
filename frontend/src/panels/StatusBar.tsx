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

const RADIUS_PRESETS_NM = [40, 80, 150, 250];

/** Cycles the feed-radius preset ladder; an unrecognized current value resets to the first preset. */
export function nextRadius(current: number): number {
  const i = RADIUS_PRESETS_NM.indexOf(current);
  return RADIUS_PRESETS_NM[(i + 1) % RADIUS_PRESETS_NM.length];
}

export function radiusChipLabel(n: number): string {
  return `RADIUS ${n} NM`;
}

type StatusBarProps = {
  /** Bridged down from App.tsx, which gets it from ViewerHost — not zustand (see App.tsx). */
  terrainNote: string | null;
};

export default function StatusBar({ terrainNote }: StatusBarProps) {
  const feedStatus = useStore((s) => s.feedStatus);
  const feedSource = useStore((s) => s.feedSource);
  const contactCount = useStore((s) => s.contacts.size);
  const radiusNm = useStore((s) => s.radiusNm);
  const setRadiusNm = useStore((s) => s.setRadiusNm);
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
      <button
        type="button"
        className="status-chip-button"
        onClick={() => setRadiusNm(nextRadius(radiusNm))}
      >
        {radiusChipLabel(radiusNm)}
      </button>
      <span>{formatUtcClock(now)}</span>
      <span className="flex-1" />
      <span>IMAGERY © ESRI · {terrainNote ?? "TERRAIN LOADING…"}</span>
    </div>
  );
}
