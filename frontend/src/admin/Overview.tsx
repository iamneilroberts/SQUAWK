import { useEffect, useState } from "react";
import { adminGet } from "./api";
import { ErrorState, LoadingState, Meter, Panel, StatusPill } from "./components";

type OverviewData = {
  capturedAtMs: number;
  modes: { effective: string; requested: string; automatic: string; deployment: string };
  settings: { registrationEnabled: boolean; providerCacheOnly: boolean };
  latestControl: null | { action: string; reason: string; createdAt: number };
  health: Record<string, string | number | boolean>;
  budgets: {
    admittedRequests: { used: number; limit: number; projected: number | null; source: string };
    providerRequests: { used: number; limit: number | null; projected: number | null; source: string };
  };
  activity: { activeFlights: number; activeSessions: number; signedPresence: number; protectedReserveRemaining: number };
  storage: { users: number; lockedMissions: number; results: number; scrubbedSystemEvents: number; source: string };
  links: { cloudflareDashboard: string; workersObservability: string; analyticsEngineDocs: string };
};
type AnalyticsSummary = {
  available: boolean; reason: string; sampled: boolean; delayed: boolean | null; dataLagMs: number | null;
  rows: Array<Record<string, string | number | null>>;
};

export default function Overview() {
  const [data, setData] = useState<{ overview: OverviewData; analytics: AnalyticsSummary } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([
      adminGet<OverviewData>("/api/admin/overview"),
      adminGet<AnalyticsSummary>("/api/admin/analytics?view=summary&window=1h"),
    ])
      .then(([overview, analytics]) => { if (active) setData({ overview, analytics }); })
      .catch((reason) => { if (active) setError(reason); });
    return () => { active = false; };
  }, []);
  if (error) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;
  const { overview, analytics } = data;
  const summary = analytics.rows[0];
  return (
    <div className="admin-grid">
      <Panel title="Operating mode" note="The effective mode can only become more restrictive than deployment or automatic protection.">
        <dl className="admin-kpis">
          <div><dt>Effective</dt><dd><StatusPill value={overview.modes.effective} /></dd></div>
          <div><dt>Requested</dt><dd><StatusPill value={overview.modes.requested} /></dd></div>
          <div><dt>Automatic</dt><dd><StatusPill value={overview.modes.automatic} /></dd></div>
          <div><dt>Deployment</dt><dd><StatusPill value={overview.modes.deployment} /></dd></div>
        </dl>
        <p className="admin-caption">{overview.latestControl ? `Latest ${overview.latestControl.action}: ${overview.latestControl.reason}` : "No retained mode or setting change reason."}</p>
      </Panel>
      <Panel title="Daily request budgets" note="Application counters and projections; Cloudflare billing remains authoritative.">
        <Meter label="Admitted requests" used={overview.budgets.admittedRequests.used} limit={overview.budgets.admittedRequests.limit} />
        <Meter label="ADS-B provider calls" used={overview.budgets.providerRequests.used} limit={overview.budgets.providerRequests.limit} />
        <p className="admin-caption">
          Projected: {overview.budgets.admittedRequests.projected?.toLocaleString() ?? "warming up"} app requests · {overview.budgets.providerRequests.projected?.toLocaleString() ?? "warming up"} provider calls
        </p>
      </Panel>
      <Panel title="Live activity" note="Presence is ephemeral; session activity is a bounded D1 flush.">
        <dl className="admin-kpis">
          <div><dt>Flights</dt><dd>{overview.activity.activeFlights}</dd></div>
          <div><dt>Sessions</dt><dd>{overview.activity.activeSessions}</dd></div>
          <div><dt>Presence</dt><dd>{overview.activity.signedPresence}</dd></div>
          <div><dt>Reserve</dt><dd>{overview.activity.protectedReserveRemaining}</dd></div>
        </dl>
      </Panel>
      <Panel title="Components & bindings" note="Configured means the binding exists; it is not a Cloudflare billing health assertion.">
        <dl className="admin-kpis">
          {Object.entries(overview.health).map(([key, value]) => (
            <div key={key}><dt>{key.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt><dd>{typeof value === "number" ? value : <StatusPill value={String(value)} />}</dd></div>
          ))}
        </dl>
      </Panel>
      <Panel title="Latency & errors" note="Sample-weighted Analytics Engine summary; Cloudflare observability is authoritative.">
        {!analytics.available ? <p className="admin-empty">Analytics {analytics.reason}.</p> : <dl className="admin-kpis">
          <div><dt>Requests · 1h</dt><dd>{Number(summary?.requests ?? 0).toLocaleString()}</dd></div>
          <div><dt>Errors · 1h</dt><dd>{Number(summary?.errors ?? 0).toLocaleString()}</dd></div>
          <div><dt>Average</dt><dd>{Math.round(Number(summary?.avg_latency_ms ?? 0))} ms</dd></div>
          <div><dt>P95</dt><dd>{Math.round(Number(summary?.p95_latency_ms ?? 0))} ms</dd></div>
          <div><dt>Data delay</dt><dd><StatusPill value={analytics.delayed ? "delayed" : "current"} /></dd></div>
        </dl>}
      </Panel>
      <Panel title="D1 entity snapshot" note={`${overview.storage.source}; these are not operation or billing totals.`}>
        <dl className="admin-kpis">
          <div><dt>Users</dt><dd>{overview.storage.users}</dd></div>
          <div><dt>Locked missions</dt><dd>{overview.storage.lockedMissions}</dd></div>
          <div><dt>Results</dt><dd>{overview.storage.results}</dd></div>
          <div><dt>Events</dt><dd>{overview.storage.scrubbedSystemEvents}</dd></div>
        </dl>
      </Panel>
      <Panel title="Authoritative platform views">
        <nav className="admin-links">
          <a href={overview.links.cloudflareDashboard} target="_blank" rel="noreferrer">Cloudflare dashboard</a>
          <a href={overview.links.workersObservability} target="_blank" rel="noreferrer">Workers observability</a>
          <a href={overview.links.analyticsEngineDocs} target="_blank" rel="noreferrer">Analytics Engine documentation</a>
        </nav>
      </Panel>
    </div>
  );
}
