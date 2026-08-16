import { useEffect, useState } from "react";
import { adminGet } from "./api";
import { EmptyState, ErrorState, formatTime, LoadingState, Panel, StatusPill } from "./components";

type ProviderHealth = {
  providerKey: string;
  state: "closed" | "open" | "half-open";
  consecutiveFailures: number;
  cooldownRemainingMs: number;
  lastOutcome: "success" | "failure" | null;
  lastOutcomeAtMs: number | null;
};
type TrafficSources = {
  providers: ProviderHealth[];
  budget: {
    band: string;
    admittedRequests: { used: number; limit: number };
    providerRequests: { used: number; limit: number | null };
  };
};
type Data = { capturedAtMs: number; trafficSources: TrafficSources; source: string };

// Circuit-state labels the owner asked for, distinct from the raw closed/open/half-open the
// broker stores (adsb-game#19 phase 2a). Local to this panel -- StatusPill's generic
// good/bad/warn word-matching doesn't cover these words, so the tone is picked explicitly here.
function ProviderStatePill({ state }: { state: ProviderHealth["state"] }) {
  const tone = state === "closed" ? "good" : "warn";
  const label = state === "closed" ? "HEALTHY" : state === "open" ? "COOLING-DOWN" : "PROBING";
  return <span className={`admin-pill admin-pill--${tone}`}>{label}</span>;
}

export default function TrafficSources() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let active = true;
    void adminGet<Data>("/api/admin/traffic-sources")
      .then((value) => { if (active) setData(value); })
      .catch((reason) => { if (active) setError(reason); });
    return () => { active = false; };
  }, []);
  if (error) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;
  const { trafficSources } = data;
  return (
    <div className="admin-grid">
      <Panel title="Provider circuits" note="Per-provider circuit-breaker state (application read; not a live upstream health check).">
        {trafficSources.providers.length === 0 ? (
          <EmptyState>No provider chain configured.</EmptyState>
        ) : (
          <div className="admin-table-wrap"><table><thead><tr>
            <th>Provider</th><th>State</th><th>Consecutive failures</th><th>Cooldown</th><th>Last outcome</th>
          </tr></thead><tbody>
            {trafficSources.providers.map((provider) => (
              <tr key={provider.providerKey}>
                <td><code>{provider.providerKey}</code></td>
                <td><ProviderStatePill state={provider.state} /></td>
                <td>{provider.consecutiveFailures}</td>
                <td>{provider.cooldownRemainingMs > 0 ? `${Math.ceil(provider.cooldownRemainingMs / 1_000)}s` : "—"}</td>
                <td>
                  {provider.lastOutcome === null
                    ? "—"
                    : <><StatusPill value={provider.lastOutcome} /><small>{formatTime(provider.lastOutcomeAtMs)}</small></>}
                </td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        <p className="admin-caption">Last-served provider is not tracked in broker state — shown per-provider outcome above instead.</p>
      </Panel>
      <Panel title="Request budget" note="Same application counters as Overview, grouped here for provider-health context.">
        <dl className="admin-kpis">
          <div><dt>Budget band</dt><dd><StatusPill value={trafficSources.budget.band} /></dd></div>
          <div><dt>Admitted requests</dt><dd>{trafficSources.budget.admittedRequests.used.toLocaleString()} / {trafficSources.budget.admittedRequests.limit.toLocaleString()}</dd></div>
          <div><dt>Provider requests</dt><dd>{trafficSources.budget.providerRequests.used.toLocaleString()} / {trafficSources.budget.providerRequests.limit?.toLocaleString() ?? "—"}</dd></div>
        </dl>
      </Panel>
    </div>
  );
}
