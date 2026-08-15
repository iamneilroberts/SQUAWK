import { DAILY_ADMITTED_REQUEST_LIMIT } from "../../src/shared/limits";
import type { SystemMode } from "../../src/shared/mode";
import { sendBrokerCommand, type BrokerAdminSnapshot } from "../durable/protocol";
import type { Env } from "../env";
import type { AdminBroker } from "./mode";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HANDLE = /^[A-Za-z][A-Za-z0-9_-]{2,31}$/;

type CountRow = { count: number };

async function count(db: D1Database, sql: string, ...values: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<CountRow>();
  return Number(row?.count ?? 0);
}

function projectedDaily(countSoFar: number, nowMs: number): number | null {
  const date = new Date(nowMs);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const elapsed = nowMs - midnight;
  if (elapsed < 60_000) return null;
  return Math.round(countSoFar / (elapsed / 86_400_000));
}

export async function readBrokerAdminSnapshot(
  namespace: Env["ADSB_BROKER"],
  forceMode: SystemMode,
  broker: AdminBroker = sendBrokerCommand,
): Promise<BrokerAdminSnapshot> {
  const result = await broker(namespace, { type: "admin-snapshot", forceMode });
  if (result.type !== "admin-snapshot") throw new TypeError("Unexpected broker response");
  return result.snapshot;
}

export async function readAdminOverview(
  env: Env,
  forceMode: SystemMode,
  nowMs: number,
  broker: AdminBroker = sendBrokerCommand,
) {
  const [snapshot, users, activeSessions, lockedMissions, results, events, latestControl] = await Promise.all([
    readBrokerAdminSnapshot(env.ADSB_BROKER, forceMode, broker),
    count(env.DB, "SELECT COUNT(*) AS count FROM users"),
    count(env.DB, "SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL AND expires_at > ?", nowMs),
    count(env.DB, "SELECT COUNT(*) AS count FROM missions WHERE status = 'locked'"),
    count(env.DB, "SELECT COUNT(*) AS count FROM flight_results"),
    count(env.DB, "SELECT COUNT(*) AS count FROM system_events"),
    env.DB.prepare(
      `SELECT action, reason, created_at
         FROM admin_audit
        WHERE action IN ('mode.set', 'settings.set')
        ORDER BY created_at DESC LIMIT 1`,
    ).first<{ action: string; reason: string; created_at: number }>(),
  ]);
  const providerLimit = Number(env.UPSTREAM_DAILY_LIMIT);
  const validProviderLimit = Number.isSafeInteger(providerLimit) && providerLimit > 0
    ? providerLimit
    : null;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const cloudflareBase = accountId !== undefined && /^[0-9a-f]{32}$/i.test(accountId)
    ? `https://dash.cloudflare.com/${accountId}`
    : "https://dash.cloudflare.com/";
  return {
    capturedAtMs: snapshot.capturedAtMs,
    modes: {
      effective: snapshot.status.effectiveMode,
      requested: snapshot.status.requestedMode,
      automatic: snapshot.status.automaticMode,
      deployment: forceMode,
      effectiveCannotRelaxAutomatic: true,
    },
    settings: {
      registrationEnabled: snapshot.status.registrationEnabled,
      providerCacheOnly: snapshot.status.providerCacheOnly,
    },
    latestControl: latestControl === null ? null : {
      action: latestControl.action,
      reason: latestControl.reason,
      createdAt: latestControl.created_at,
    },
    health: {
      broker: "available",
      d1: "available",
      r2: env.RESULT_TRACES === undefined ? "not-configured" : "configured",
      email: env.AUTH_FROM_EMAIL === undefined ? "not-configured" : "configured",
      analytics: env.ANALYTICS_READ_TOKEN === undefined ? "not-configured" : "configured",
      componentFailures: snapshot.status.health.componentFailures,
      monitoringDegraded: env.ANALYTICS_READ_TOKEN === undefined,
    },
    budgets: {
      admittedRequests: {
        used: snapshot.status.admittedRequests,
        limit: DAILY_ADMITTED_REQUEST_LIMIT,
        projected: projectedDaily(snapshot.status.admittedRequests, nowMs),
        source: "application-counter",
        authoritative: false,
      },
      providerRequests: {
        used: snapshot.status.providerRequests,
        limit: validProviderLimit,
        projected: projectedDaily(snapshot.status.providerRequests, nowMs),
        source: "application-counter",
        authoritative: false,
      },
    },
    activity: {
      activeFlights: snapshot.status.activeFlights,
      activeSessions,
      signedPresence: snapshot.presence.length,
      protectedReserveRemaining: snapshot.status.protectedReserveRemaining,
      providerQueue: snapshot.providerWork,
    },
    storage: {
      users,
      lockedMissions,
      results,
      scrubbedSystemEvents: events,
      source: "d1-entity-counts",
      authoritativeBilling: false,
    },
    links: {
      cloudflareDashboard: cloudflareBase,
      workersObservability: `${cloudflareBase}/workers-and-pages`,
      analyticsEngineDocs: "https://developers.cloudflare.com/analytics/analytics-engine/",
    },
    lastTransition: snapshot.status.lastAlertTransition,
  };
}

type ActiveSessionRow = {
  session_id: string;
  user_id: string;
  handle: string;
  user_status: string;
  expires_at: number;
  last_seen_at: number;
  device_label: string | null;
  created_at: number;
  mission_id: string | null;
  aircraft_class: string | null;
  airport_icao: string | null;
  locked_at: number | null;
  assists_json: string | null;
};

function assistSummary(serialized: string | null): string {
  if (serialized === null) return "none";
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return "configured";
    const enabled = Object.entries(parsed as Record<string, unknown>)
      .filter(([key, value]) => key !== "schemaVersion" && (value === true || typeof value === "string"))
      .map(([key]) => key)
      .slice(0, 4);
    return enabled.length === 0 ? "none" : enabled.join(", ");
  } catch {
    return "configured";
  }
}

export async function listAdminActiveSessions(
  db: D1Database,
  snapshot: BrokerAdminSnapshot,
  nowMs: number,
  limit: number,
) {
  // Admin mutations (e.g. flight.terminate) commit just before this is read, and the admin
  // UI re-fetches immediately after — a plain read here can land on a D1 read replica that
  // hasn't caught up yet, showing a mission that was already abandoned. Pin this query to the
  // primary via the D1 Sessions API so admins always see the true post-mutation state (#62).
  const result = await db.withSession("first-primary").prepare(
    `SELECT s.id AS session_id, s.user_id, u.handle, u.status AS user_status,
            s.expires_at, s.last_seen_at, s.device_label, s.created_at,
            m.id AS mission_id, m.aircraft_class, m.airport_icao, m.locked_at,
            m.assists_json
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN missions m ON m.id = (
         SELECT candidate.id FROM missions candidate
          WHERE candidate.user_id = s.user_id AND candidate.status = 'locked'
          ORDER BY candidate.locked_at DESC LIMIT 1
       )
      WHERE s.revoked_at IS NULL AND s.expires_at > ?
      ORDER BY s.last_seen_at DESC LIMIT ?`,
  ).bind(nowMs, limit).all<ActiveSessionRow>();
  const latestPresence = new Map<string, BrokerAdminSnapshot["presence"][number]>();
  for (const presence of snapshot.presence) {
    if (!latestPresence.has(presence.userId)) latestPresence.set(presence.userId, presence);
  }
  const leaseUsers = new Set(snapshot.leases.map(({ userId }) => userId));
  return result.results.map((row) => {
    const presence = latestPresence.get(row.user_id);
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      handle: row.handle,
      userStatus: row.user_status,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      device: row.device_label ?? "Unknown device",
      coarseRegion: presence?.regionKey ?? null,
      presenceAtMs: presence?.lastSeenAtMs ?? null,
      mission: row.mission_id === null ? null : {
        id: row.mission_id,
        aircraftClass: row.aircraft_class,
        airportIcao: row.airport_icao,
        durationMs: Math.max(0, nowMs - (row.locked_at ?? row.created_at)),
        assists: assistSummary(row.assists_json),
        leaseActive: leaseUsers.has(row.user_id),
      },
    };
  });
}

type UserIdentityRow = { id: string; handle: string; status: string; created_at: number; updated_at: number };

export async function findAdminUserByExactIdentity(
  db: D1Database,
  kind: "id" | "handle",
  query: string,
): Promise<UserIdentityRow | null> {
  if (kind === "id" && !UUID.test(query)) return null;
  if (kind === "handle" && !HANDLE.test(query)) return null;
  const column = kind === "id" ? "id" : "handle";
  return db.prepare(
    `SELECT id, handle, status, created_at, updated_at FROM users WHERE ${column} = ? COLLATE NOCASE`,
  ).bind(query).first<UserIdentityRow>();
}

export async function readAdminUserDetail(db: D1Database, userId: string, nowMs: number) {
  if (!UUID.test(userId)) return null;
  const user = await db.prepare(
    "SELECT id, handle, status, created_at, updated_at FROM users WHERE id = ?",
  ).bind(userId).first<UserIdentityRow>();
  if (user === null) return null;
  const [sessions, results, missions, bans] = await Promise.all([
    db.prepare(
      `SELECT id, expires_at, revoked_at, last_seen_at, device_label, created_at
         FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 25`,
    ).bind(userId).all<Record<string, unknown>>(),
    count(db, `SELECT COUNT(*) AS count FROM flight_results r JOIN missions m ON m.id = r.mission_id WHERE m.user_id = ?`, userId),
    count(db, "SELECT COUNT(*) AS count FROM missions WHERE user_id = ?", userId),
    db.prepare(
      `SELECT id, scope, reason, expires_at, revoked_at, created_at
         FROM user_bans WHERE user_id = ? ORDER BY created_at DESC LIMIT 25`,
    ).bind(userId).all<Record<string, unknown>>(),
  ]);
  return {
    id: user.id,
    handle: user.handle,
    status: user.status,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    counts: {
      sessions: sessions.results.length,
      activeSessions: sessions.results.filter((row) => row.revoked_at === null && Number(row.expires_at) > nowMs).length,
      missions,
      results,
    },
    sessions: sessions.results.map((row) => ({
      id: row.id,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      lastSeenAt: row.last_seen_at,
      device: row.device_label ?? "Unknown device",
      createdAt: row.created_at,
    })),
    bans: bans.results.map((row) => ({
      id: row.id,
      scope: row.scope,
      reason: row.reason,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    })),
  };
}
