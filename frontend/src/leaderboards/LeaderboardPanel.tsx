import { useEffect, useRef, useState } from "react";

import { missionProfileForClass } from "../mission/profiles";
import type { AircraftClassId } from "../mission/types";
import { loadLeaderboard } from "./api";
import LeaderboardResults from "./LeaderboardResults";
import type { LeaderboardAssist, LeaderboardPage } from "./types";

const CLASS_IDS: readonly AircraftClassId[] = ["c172s", "b738", "f5e"];
const ASSISTS: readonly { value: LeaderboardAssist; label: string }[] = [
  { value: "none", label: "OFF" },
  { value: "low", label: "NAV" },
  { value: "medium", label: "FULL" },
  { value: "high", label: "HIGH" },
];
const FOCUSABLE = "button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

export default function LeaderboardPanel() {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [classId, setClassId] = useState<AircraftClassId>("c172s");
  const [assist, setAssist] = useState<LeaderboardAssist>("none");
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<LeaderboardPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshAt, setRefreshAt] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const scoringVersion = missionProfileForClass(classId).scoringVersion;
  const cursor = cursorStack.at(-1) ?? null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    void loadLeaderboard({
      classId,
      highestAssist: assist,
      scoringVersion,
      ...(cursor === null ? {} : { cursor }),
    }).then((next) => {
      if (!active) return;
      setPage(next);
      setRefreshAt(Date.now() + next.minimumPollSeconds * 1_000);
      setRemainingSeconds(next.minimumPollSeconds);
    }).catch(() => {
      if (active) setFailed(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [assist, classId, cursor, open, revision, scoringVersion]);

  useEffect(() => {
    if (!open || refreshAt === 0) return;
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((refreshAt - Date.now()) / 1_000)));
    update();
    const timer = globalThis.setInterval(update, 1_000);
    return () => globalThis.clearInterval(timer);
  }, [open, refreshAt]);

  function resetPartition(nextClass: AircraftClassId, nextAssist: LeaderboardAssist): void {
    setClassId(nextClass);
    setAssist(nextAssist);
    setCursorStack([null]);
    setPage(null);
  }

  function closePanel(): void {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }

  return (
    <div className="leaderboard-control">
      <button
        ref={triggerRef}
        className="status-chip-button"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        LEADERBOARDS
      </button>
      {open && (
        <div className="leaderboard-backdrop">
          <div
            className="panel leaderboard-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Leaderboards"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closePanel();
                return;
              }
              if (event.key !== "Tab") return;
              const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
              const first = focusable[0];
              const last = focusable.at(-1);
              if (first === undefined || last === undefined) return;
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="leaderboard-heading">
              <div className="label">VERSIONED LEADERBOARDS</div>
              <button className="auth-close" type="button" aria-label="Close leaderboards" autoFocus onClick={closePanel}>×</button>
            </div>
            <div className="leaderboard-filters">
              <label className="label" htmlFor="leaderboard-class">AIRCRAFT CLASS
                <select id="leaderboard-class" className="auth-input" value={classId} onChange={(event) => {
                  resetPartition(event.target.value as AircraftClassId, assist);
                }}>
                  {CLASS_IDS.map((value) => <option value={value} key={value}>{value.toUpperCase()}</option>)}
                </select>
              </label>
              <label className="label" htmlFor="leaderboard-assist">HIGHEST ASSIST
                <select id="leaderboard-assist" className="auth-input" value={assist} onChange={(event) => {
                  resetPartition(classId, event.target.value as LeaderboardAssist);
                }}>
                  {ASSISTS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
                </select>
              </label>
            </div>
            {failed && <div className="auth-error label" role="alert">LEADERBOARD UNAVAILABLE. TRY AGAIN.</div>}
            {loading && page === null
              ? <div className="leaderboard-loading" aria-live="polite">LOADING PARTITION…</div>
              : page !== null && <LeaderboardResults page={page} />}
            <div className="leaderboard-actions">
              <button className="auth-secondary" type="button" disabled={cursorStack.length === 1 || loading} onClick={() => {
                setCursorStack((current) => current.slice(0, -1));
              }}>PREVIOUS</button>
              <button className="auth-secondary" type="button" disabled={page?.nextCursor == null || loading} onClick={() => {
                if (page?.nextCursor) setCursorStack((current) => [...current, page.nextCursor]);
              }}>NEXT</button>
              <button className="control-button" type="button" disabled={loading || remainingSeconds > 0} onClick={() => setRevision((value) => value + 1)}>
                {remainingSeconds > 0 ? `REFRESH ${remainingSeconds}s` : "REFRESH"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
