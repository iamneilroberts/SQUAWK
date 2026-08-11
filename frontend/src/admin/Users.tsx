import { useState } from "react";
import { adminGet, adminMutation } from "./api";
import { EmptyState, ErrorState, formatTime, Panel, shortId, StatusPill } from "./components";

type UserSummary = { id: string; handle: string; status: string };
type UserDetail = UserSummary & {
  createdAt: number; updatedAt: number;
  counts: { sessions: number; activeSessions: number; missions: number; results: number };
  sessions: Array<{ id: string; expiresAt: number; revokedAt: number | null; lastSeenAt: number; device: string; createdAt: number }>;
  bans: Array<{ id: string; scope: string; reason: string; expiresAt: number | null; revokedAt: number | null; createdAt: number }>;
};

export default function Users({ csrfToken }: { csrfToken: string }) {
  const [kind, setKind] = useState<"handle" | "id" | "email">("handle");
  const [query, setQuery] = useState("");
  const [user, setUser] = useState<UserDetail | null>(null);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const loadDetail = async (summary: UserSummary | null) => {
    setSearched(true);
    if (!summary) { setUser(null); return; }
    const detail = await adminGet<{ user: UserDetail }>(`/api/admin/users/${summary.id}`);
    setUser(detail.user);
  };
  const search = async () => {
    setError(null);
    try {
      const result = kind === "email"
        ? await adminMutation<{ user: UserSummary | null }>("/api/admin/users/lookup", { email: query }, csrfToken)
        : await adminGet<{ user: UserSummary | null }>(`/api/admin/users?kind=${kind}&query=${encodeURIComponent(query)}`);
      await loadDetail(result.user);
    } catch (reason) { setError(reason); }
  };
  const ban = async () => {
    if (!user) return;
    const confirmation = window.prompt(`Type BAN ${user.id} to ban ${user.handle}.`);
    if (confirmation !== `BAN ${user.id}`) return;
    const reason = window.prompt("Operational reason (at least 8 characters):") ?? "";
    if (reason.length < 8) return;
    await adminMutation(`/api/admin/users/${user.id}/ban`, { scope: "permanent", expiresAt: null, reason, confirmation }, csrfToken);
    await loadDetail(user);
  };
  const unban = async (banId: string) => {
    const reason = window.prompt("Unban reason (at least 8 characters):") ?? "";
    if (reason.length < 8) return;
    await adminMutation(`/api/admin/bans/${banId}/unban`, { reason }, csrfToken);
    if (user) await loadDetail(user);
  };
  return (
    <div className="admin-grid">
      <Panel title="User lookup" note="ID and handle are exact-match. Email is HMAC-derived in memory and is never returned or stored in admin logs.">
        <div className="admin-toolbar">
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="handle">Handle</option><option value="id">User ID</option><option value="email">Exact email</option></select>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === "email" ? "Exact email" : kind === "id" ? "UUID" : "Handle"} />
          <button onClick={() => void search()} disabled={!query}>Search</button>
        </div>
        {error ? <ErrorState error={error} /> : null}
        {searched && !user ? <EmptyState>No exact user match.</EmptyState> : null}
      </Panel>
      {user ? <Panel title={user.handle} note={user.id}>
        <dl className="admin-kpis">
          <div><dt>Status</dt><dd><StatusPill value={user.status} /></dd></div>
          <div><dt>Sessions</dt><dd>{user.counts.activeSessions} / {user.counts.sessions}</dd></div>
          <div><dt>Missions</dt><dd>{user.counts.missions}</dd></div>
          <div><dt>Results</dt><dd>{user.counts.results}</dd></div>
          <div><dt>Created</dt><dd>{formatTime(user.createdAt)}</dd></div>
          <div><dt>Updated</dt><dd>{formatTime(user.updatedAt)}</dd></div>
        </dl>
        <div className="admin-actions">{user.status !== "banned" ? <button className="danger" onClick={() => void ban()}>Ban user</button> : null}</div>
        <h3>Sessions</h3>
        {user.sessions.length === 0 ? <EmptyState>No retained sessions.</EmptyState> : <ul className="admin-list">{user.sessions.map((session) => <li key={session.id}><code>{shortId(session.id)}</code><span>{session.device}</span><span>{formatTime(session.lastSeenAt)}</span><StatusPill value={session.revokedAt === null && session.expiresAt > Date.now() ? "active" : "inactive"} /></li>)}</ul>}
        <h3>Bans</h3>
        {user.bans.length === 0 ? <EmptyState>No retained bans.</EmptyState> : <ul className="admin-list">{user.bans.map((ban) => <li key={ban.id}><code>{shortId(ban.id)}</code><span>{ban.scope}</span><span>{ban.reason}</span>{ban.revokedAt === null ? <button onClick={() => void unban(ban.id)}>Unban</button> : <StatusPill value="revoked" />}</li>)}</ul>}
      </Panel> : null}
    </div>
  );
}
