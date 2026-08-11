import { useCallback, useEffect, useState, type ComponentType } from "react";
import ActiveSessions from "./ActiveSessions";
import Controls from "./Controls";
import LogsErrors from "./LogsErrors";
import Overview from "./Overview";
import TrafficCapacity from "./TrafficCapacity";
import Users from "./Users";
import { loadAdminBootstrap, type AdminBootstrap } from "./api";
import { ErrorState, LoadingState, StatusPill } from "./components";

type Tab = "overview" | "capacity" | "sessions" | "events" | "users" | "controls";

const TABS: Array<{ id: Tab; label: string; component?: ComponentType }> = [
  { id: "overview", label: "Overview", component: Overview },
  { id: "capacity", label: "Traffic & Capacity", component: TrafficCapacity },
  { id: "sessions", label: "Active Sessions" },
  { id: "events", label: "Logs & Errors", component: LogsErrors },
  { id: "users", label: "Users" },
  { id: "controls", label: "Controls" },
];

export default function AdminApp() {
  const [tab, setTab] = useState<Tab>("overview");
  const [bootstrap, setBootstrap] = useState<AdminBootstrap | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(async () => {
    setError(null);
    try { setBootstrap(await loadAdminBootstrap()); } catch (failure) { setError(failure); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  if (error) return <main className="admin-shell"><ErrorState error={error} /></main>;
  if (!bootstrap) return <main className="admin-shell"><LoadingState /></main>;
  const staticComponent = TABS.find(({ id }) => id === tab)?.component;
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div><p>VOYGENT OPERATIONS</p><h1>ADSB-GAME CONTROL ROOM</h1></div>
        <div className="admin-header__status"><StatusPill value={bootstrap.status.effectiveMode} /><span>{bootstrap.status.activeFlights} active flights</span></div>
      </header>
      <nav className="admin-tabs" aria-label="Admin sections">
        {TABS.map(({ id, label }) => <button key={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      <div className="admin-content">
        {staticComponent ? (() => { const Component = staticComponent; return <Component />; })() : null}
        {tab === "sessions" ? <ActiveSessions csrfToken={bootstrap.csrfToken} /> : null}
        {tab === "users" ? <Users csrfToken={bootstrap.csrfToken} /> : null}
        {tab === "controls" ? <Controls status={bootstrap.status} csrfToken={bootstrap.csrfToken} reload={reload} /> : null}
      </div>
      <footer>Private owner console · bounded application telemetry · Cloudflare dashboards remain authoritative</footer>
    </main>
  );
}

