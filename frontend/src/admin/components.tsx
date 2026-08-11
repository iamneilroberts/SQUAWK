import type { ReactNode } from "react";

export function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="admin-panel">
      <header>
        <h2>{title}</h2>
        {note ? <p>{note}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function StatusPill({ value }: { value: string | boolean | null }) {
  const label = value === null ? "UNAVAILABLE" : typeof value === "boolean" ? (value ? "ON" : "OFF") : value;
  const tone = /normal|available|active|configured|on/i.test(label)
    ? "good"
    : /kill|error|failed|unavailable|off|banned/i.test(label)
      ? "bad"
      : "warn";
  return <span className={`admin-pill admin-pill--${tone}`}>{label}</span>;
}

export function Meter({ used, limit, label }: { used: number; limit: number | null; label: string }) {
  const percent = limit === null || limit <= 0 ? 0 : Math.min(100, used / limit * 100);
  return (
    <div className="admin-meter">
      <div><span>{label}</span><strong>{used.toLocaleString()} / {limit?.toLocaleString() ?? "unknown"}</strong></div>
      <div className="admin-meter__track"><i style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="admin-empty">{children}</p>;
}

export function LoadingState() {
  return <p className="admin-loading" role="status">Loading operational data…</p>;
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <p className="admin-error" role="alert">
      {error instanceof Error ? error.message : "Operational data is unavailable."}
    </p>
  );
}

export function formatTime(value: number | null): string {
  return value === null ? "—" : new Date(value).toLocaleString();
}

export function shortId(value: string): string {
  return value.length > 13 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}
