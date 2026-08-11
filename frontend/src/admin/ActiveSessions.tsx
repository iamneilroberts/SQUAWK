import { useCallback, useEffect, useState } from "react";
import { adminGet, adminMutation } from "./api";
import { EmptyState, ErrorState, formatTime, LoadingState, Panel, shortId, StatusPill } from "./components";

type Session = {
  sessionId: string; userId: string; handle: string; userStatus: string; lastSeenAt: number; expiresAt: number;
  device: string; coarseRegion: string | null; presenceAtMs: number | null;
  mission: null | { id: string; aircraftClass: string | null; airportIcao: string | null; durationMs: number; assists: string; leaseActive: boolean };
};
type SessionData = { sessions: Session[]; capturedAtMs: number; presenceEphemeral: boolean };

export default function ActiveSessions({ csrfToken }: { csrfToken: string }) {
  const [data, setData] = useState<SessionData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    return adminGet<SessionData>("/api/admin/sessions?limit=100").then(setData).catch(setError);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const revoke = async (session: Session) => {
    const confirmation = window.prompt(`Type REVOKE ${session.sessionId} to revoke ${session.handle}'s session.`);
    if (confirmation !== `REVOKE ${session.sessionId}`) return;
    const reason = window.prompt("Operational reason (at least 8 characters):") ?? "";
    if (reason.length < 8) return;
    await adminMutation(`/api/admin/sessions/${session.sessionId}/revoke`, { reason, confirmation }, csrfToken);
    await load();
  };
  const terminate = async (session: Session) => {
    if (!session.mission) return;
    const confirmation = window.prompt(`Type TERMINATE ${session.mission.id} to end this flight.`);
    if (confirmation !== `TERMINATE ${session.mission.id}`) return;
    const reason = window.prompt("Operational reason (at least 8 characters):") ?? "";
    if (reason.length < 8) return;
    await adminMutation(`/api/admin/flights/${session.mission.id}/terminate`, { reason, confirmation }, csrfToken);
    await load();
  };
  if (error) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;
  return (
    <Panel title="Active sessions" note="Presence and coarse region expire after 45 seconds; D1 last-seen writes are limited to once per minute.">
      {data.sessions.length === 0 ? <EmptyState>No active sessions.</EmptyState> : (
        <div className="admin-table-wrap"><table><thead><tr><th>User</th><th>Activity</th><th>Device / region</th><th>Mission</th><th>Actions</th></tr></thead><tbody>
          {data.sessions.map((session) => <tr key={session.sessionId}>
            <td><strong>{session.handle}</strong><small>{shortId(session.userId)} · {shortId(session.sessionId)}</small><StatusPill value={session.userStatus} /></td>
            <td>{formatTime(session.lastSeenAt)}<small>expires {formatTime(session.expiresAt)}</small></td>
            <td>{session.device}<small>{session.coarseRegion ?? "No current presence"}</small></td>
            <td>{session.mission ? <><strong>{session.mission.aircraftClass ?? "Unknown class"}</strong><small>{session.mission.airportIcao} · {Math.round(session.mission.durationMs / 60_000)} min · {session.mission.assists}</small><StatusPill value={session.mission.leaseActive ? "active" : "lease expired"} /></> : "—"}</td>
            <td className="admin-actions"><button onClick={() => void revoke(session)}>Revoke</button>{session.mission ? <button className="danger" onClick={() => void terminate(session)}>End flight</button> : null}</td>
          </tr>)}
        </tbody></table></div>
      )}
    </Panel>
  );
}

