import { useEffect, useState } from "react";
import { adminGet } from "./api";
import { EmptyState, ErrorState, formatTime, LoadingState, Panel, StatusPill } from "./components";

type Capacity = {
  capturedAtMs: number;
  cacheRegions: Array<{
    regionKey: string; fetchedAtMs: number | null; expiresAtMs: number; lastAccessAtMs: number;
    providerAvailable: boolean; failureCount: number; retryAtMs: number; viewerCount: number;
  }>;
  providerWork: { queuedByPriority: number[]; inFlightRegions: number; runningPriority: number | null };
  status: { providerRequests: number; activeFlights: number; budgetBand: string; health: Record<string, number> };
  source: string;
};
type Analytics = { available: boolean; degraded: boolean; reason: string; sampled: boolean; rows: Array<Record<string, string | number | null>> };

export default function TrafficCapacity() {
  const [value, setValue] = useState<{ capacity: Capacity; routes: Analytics; traffic: Analytics } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [window, setWindow] = useState<"15m" | "1h" | "6h" | "24h">("1h");
  useEffect(() => {
    let active = true;
    void Promise.all([
      adminGet<Capacity>("/api/admin/capacity"),
      adminGet<Analytics>(`/api/admin/analytics?view=routes&window=${window}`),
      adminGet<Analytics>(`/api/admin/analytics?view=traffic&window=${window}`),
    ]).then(([capacity, routes, traffic]) => { if (active) setValue({ capacity, routes, traffic }); })
      .catch((reason) => { if (active) setError(reason); });
    return () => { active = false; };
  }, [window]);
  if (error) return <ErrorState error={error} />;
  if (!value) return <LoadingState />;
  const { capacity, routes, traffic } = value;
  const cacheSamples = traffic.rows.reduce((total, row) => total + Number(row.requests ?? 0), 0);
  const cacheHits = traffic.rows.reduce((total, row) =>
    total + (["HIT", "COALESCED"].includes(String(row.cache_status)) ? Number(row.requests ?? 0) : 0), 0);
  const cacheHitRate = cacheSamples === 0 ? null : cacheHits / cacheSamples * 100;
  const routeCount = (matcher: (route: string) => boolean) => routes.rows.reduce((total, row) =>
    total + (matcher(String(row.route ?? "")) ? Number(row.requests ?? 0) : 0), 0);
  return (
    <div><div className="admin-toolbar admin-window"><label>Analytics window <select value={window} onChange={(event) => setWindow(event.target.value as typeof window)}><option value="15m">15 minutes</option><option value="1h">1 hour</option><option value="6h">6 hours</option><option value="24h">24 hours</option></select></label></div><div className="admin-grid">
      <Panel title="Provider capacity" note="Application snapshot, not an authoritative provider invoice.">
        <dl className="admin-kpis">
          <div><dt>Calls today</dt><dd>{capacity.status.providerRequests}</dd></div>
          <div><dt>Active flights</dt><dd>{capacity.status.activeFlights}</dd></div>
          <div><dt>Budget band</dt><dd><StatusPill value={capacity.status.budgetBand} /></dd></div>
          <div><dt>In flight</dt><dd>{capacity.providerWork.inFlightRegions}</dd></div>
          <div><dt>Queue 0–3</dt><dd>{capacity.providerWork.queuedByPriority.join(" / ")}</dd></div>
          <div><dt>Failures</dt><dd>{capacity.status.health.providerFailures ?? 0}</dd></div>
        </dl>
      </Panel>
      <Panel title="Regional cache" note="No aircraft contacts or raw positions are exposed.">
        {capacity.cacheRegions.length === 0 ? <EmptyState>No cached regions.</EmptyState> : (
          <div className="admin-table-wrap"><table><thead><tr><th>Region</th><th>Age / expiry</th><th>Viewers</th><th>Provider</th><th>Failures</th></tr></thead><tbody>
            {capacity.cacheRegions.map((region) => <tr key={region.regionKey}>
              <td><code>{region.regionKey}</code></td>
              <td>{formatTime(region.fetchedAtMs)}<small>expires {formatTime(region.expiresAtMs)}</small></td>
              <td>{region.viewerCount}</td>
              <td><StatusPill value={region.providerAvailable ? "available" : "unavailable"} /></td>
              <td>{region.failureCount}</td>
            </tr>)}
          </tbody></table></div>
        )}
      </Panel>
      <Panel title="Route & status trend" note="Sample-weighted Analytics Engine data; Cloudflare dashboard is authoritative.">
        {!routes.available ? <EmptyState>Analytics {routes.reason}. The operational snapshot above remains available.</EmptyState> : (
          <div className="admin-table-wrap"><table><thead><tr><th>Route</th><th>Status</th><th>Requests</th><th>Average latency</th></tr></thead><tbody>
            {routes.rows.map((row, index) => <tr key={index}><td>{row.route}</td><td>{row.status_class}</td><td>{row.requests}</td><td>{Math.round(Number(row.avg_latency_ms ?? 0))} ms</td></tr>)}
          </tbody></table></div>
        )}
      </Panel>
      <Panel title="Traffic cache outcomes" note="Sample-weighted telemetry. Empty data is distinct from unavailable analytics.">
        {!traffic.available ? <EmptyState>Analytics {traffic.reason}.</EmptyState> : traffic.rows.length === 0 ? <EmptyState>No traffic samples in this window.</EmptyState> : (
          <><p className="admin-caption">Cache hit/coalesced rate: {cacheHitRate === null ? "no samples" : `${cacheHitRate.toFixed(1)}%`}</p><div className="admin-table-wrap"><table><thead><tr><th>Cache</th><th>Provider</th><th>Requests</th></tr></thead><tbody>
            {traffic.rows.map((row, index) => <tr key={index}><td>{row.cache_status}</td><td>{row.operation}</td><td>{row.requests}</td></tr>)}
          </tbody></table></div></>
        )}
      </Panel>
      <Panel title="Platform path estimates" note="Sample-weighted request-path estimates—not D1, R2, Email Routing, or billing operation totals.">
        {!routes.available ? <EmptyState>Analytics {routes.reason}.</EmptyState> : <dl className="admin-kpis">
          <div><dt>D1 paths</dt><dd>{routeCount((route) => !["status", "config", "traffic"].includes(route)).toLocaleString()}</dd></div>
          <div><dt>R2 result paths</dt><dd>{routeCount((route) => route.includes("result")).toLocaleString()}</dd></div>
          <div><dt>Email auth paths</dt><dd>{routeCount((route) => route.includes("auth-request")).toLocaleString()}</dd></div>
        </dl>}
      </Panel>
    </div></div>
  );
}
