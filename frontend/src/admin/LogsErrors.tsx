import { useCallback, useEffect, useState } from "react";
import { adminGet, saveDownload } from "./api";
import { EmptyState, ErrorState, formatTime, LoadingState, Panel, shortId, StatusPill } from "./components";

type EventItem = {
  id: string; level: string; category: string; eventKey: string; requestId: string | null;
  context: Record<string, unknown>; hasTrace: boolean; traceExpiresAt: number | null; createdAt: number;
};
type EventData = { events: EventItem[]; fullLogStream: false; workersLogsUrl: string };

export default function LogsErrors() {
  const [data, setData] = useState<EventData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [level, setLevel] = useState("");
  const [category, setCategory] = useState("");
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const filters = useCallback((includeFormat?: "csv" | "json") => {
    const search = new URLSearchParams({ limit: includeFormat ? "250" : "100" });
    if (level) search.set("level", level);
    if (category) search.set("category", category);
    if (after && Number.isFinite(Date.parse(after))) search.set("after", String(Date.parse(after)));
    if (before && Number.isFinite(Date.parse(before))) search.set("before", String(Date.parse(before)));
    if (includeFormat) search.set("format", includeFormat);
    return search;
  }, [after, before, category, level]);
  const load = useCallback(() => {
    setError(null);
    return adminGet<EventData>(`/api/admin/events?${filters()}`).then(setData).catch(setError);
  }, [filters]);
  useEffect(() => { void load(); }, [load]);
  const download = async (format: "csv" | "json") => {
    const file = await adminGet<{ filename: string; contentType: string; content: string }>(
      `/api/admin/events/export?${filters(format)}`,
    );
    saveDownload(file);
  };
  if (error) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;
  return (
    <Panel title="Logs & errors" note="Scrubbed application warning, error, and transition events—not a complete Workers log stream.">
      <div className="admin-toolbar">
        <label>Level <select value={level} onChange={(event) => setLevel(event.target.value)}><option value="">All</option><option value="warning">Warning</option><option value="error">Error</option><option value="transition">Transition</option></select></label>
        <label>Type / category <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Exact category" /></label>
        <label>After <input type="datetime-local" value={after} onChange={(event) => setAfter(event.target.value)} /></label>
        <label>Before <input type="datetime-local" value={before} onChange={(event) => setBefore(event.target.value)} /></label>
        <button onClick={() => void download("csv")}>Export CSV</button>
        <button onClick={() => void download("json")}>Export JSON</button>
        <a href={data.workersLogsUrl} target="_blank" rel="noreferrer">Open Workers Logs</a>
      </div>
      {data.events.length === 0 ? <EmptyState>No scrubbed events match this filter.</EmptyState> : (
        <div className="admin-table-wrap"><table><thead><tr><th>Time</th><th>Level</th><th>Event</th><th>Request</th><th>Scrubbed context</th></tr></thead><tbody>
          {data.events.map((event) => <tr key={event.id}>
            <td>{formatTime(event.createdAt)}</td>
            <td><StatusPill value={event.level} /></td>
            <td><strong>{event.eventKey}</strong><small>{event.category}</small></td>
            <td>{event.requestId ? shortId(event.requestId) : "—"}</td>
            <td><code className="admin-context">{JSON.stringify(event.context)}</code></td>
          </tr>)}
        </tbody></table></div>
      )}
    </Panel>
  );
}
