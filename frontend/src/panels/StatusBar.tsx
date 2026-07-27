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

export default function StatusBar() {
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
      <span>CONTACTS {contactCount}</span>
      <span>{formatUtcClock(now)}</span>
      <span className="flex-1" />
      <span>IMAGERY © ESRI</span>
    </div>
  );
}
