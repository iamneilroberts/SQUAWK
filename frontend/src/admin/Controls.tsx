import { useState } from "react";
import { adminMutation, type AdminStatus } from "./api";
import { ErrorState, Panel, StatusPill } from "./components";

export default function Controls({
  status,
  csrfToken,
  reload,
}: {
  status: AdminStatus;
  csrfToken: string;
  reload: () => Promise<void>;
}) {
  const [reason, setReason] = useState("Operational control adjustment");
  const [confirmation, setConfirmation] = useState("");
  const [latitude, setLatitude] = useState("30.6944");
  const [longitude, setLongitude] = useState("-88.0399");
  const [radius, setRadius] = useState("80");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await operation(); await reload(); } catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  const setMode = (mode: AdminStatus["requestedMode"]) => run(() => adminMutation(
    "/api/admin/mode",
    { mode, reason, ...(mode === "KILL_SWITCH" ? { confirmation } : {}) },
    csrfToken,
  ));
  return (
    <div className="admin-grid">
      <Panel title="Mode controls" note="Deployment and automatic protections always win. Requesting NORMAL cannot relax an automatic READ_ONLY or KILL_SWITCH.">
        <dl className="admin-kpis">
          <div><dt>Effective</dt><dd><StatusPill value={status.effectiveMode} /></dd></div>
          <div><dt>Requested</dt><dd><StatusPill value={status.requestedMode} /></dd></div>
          <div><dt>Automatic</dt><dd><StatusPill value={status.automaticMode} /></dd></div>
        </dl>
        <label className="admin-field">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <label className="admin-field">Kill-switch confirmation<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="KILL_SWITCH" /></label>
        <div className="admin-actions">
          <button disabled={busy || reason.length < 8} onClick={() => void setMode("NORMAL")}>Request normal</button>
          <button disabled={busy || reason.length < 8} onClick={() => void setMode("READ_ONLY")}>Request read-only</button>
          <button className="danger" disabled={busy || reason.length < 8 || confirmation !== "KILL_SWITCH"} onClick={() => void setMode("KILL_SWITCH")}>Engage kill switch</button>
        </div>
      </Panel>
      <Panel title="Traffic & registration" note="Cache-only halts provider refresh independently of request mode.">
        <dl className="admin-kpis">
          <div><dt>Registration</dt><dd><StatusPill value={status.registrationEnabled} /></dd></div>
          <div><dt>Cache only</dt><dd><StatusPill value={status.providerCacheOnly} /></dd></div>
        </dl>
        <div className="admin-actions">
          <button disabled={busy || reason.length < 8} onClick={() => void run(() => adminMutation("/api/admin/settings", { registrationEnabled: !status.registrationEnabled, providerCacheOnly: status.providerCacheOnly, reason }, csrfToken))}>{status.registrationEnabled ? "Disable" : "Enable"} registration</button>
          <button disabled={busy || reason.length < 8} onClick={() => void run(() => adminMutation("/api/admin/settings", { registrationEnabled: status.registrationEnabled, providerCacheOnly: !status.providerCacheOnly, reason }, csrfToken))}>{status.providerCacheOnly ? "Resume provider" : "Enable cache-only"}</button>
        </div>
      </Panel>
      <Panel title="Clear one cache region" note="Coordinates are normalized by the broker; this never clears all regions.">
        <div className="admin-form-row">
          <label>Latitude<input value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
          <label>Longitude<input value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
          <label>Radius NM<input value={radius} onChange={(event) => setRadius(event.target.value)} /></label>
        </div>
        <button disabled={busy || reason.length < 8} onClick={() => void run(() => adminMutation("/api/admin/cache/region", { latitude: Number(latitude), longitude: Number(longitude), radiusNm: Number(radius), reason }, csrfToken))}>Clear normalized region</button>
      </Panel>
      <Panel title="Alert drill" note="Task 16 wires the bounded alert pipeline and audited test delivery.">
        <button disabled>Send test alert — available after alert setup</button>
      </Panel>
      {error ? <ErrorState error={error} /> : null}
    </div>
  );
}

