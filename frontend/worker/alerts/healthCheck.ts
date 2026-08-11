import { isSystemMode, type SystemMode } from "../../src/shared/mode";
import type { Env } from "../env";
import type { AdsbBroker } from "../durable/AdsbBroker";
import {
  sendBrokerCommand,
  type BrokerCommand,
  type BrokerCommandResult,
} from "../durable/protocol";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION = /^[a-z][a-z0-9._-]{0,63}$/;
const LOOKBACK_MS = 10 * 60 * 1_000;

type AdminAlertRow = {
  event_key: string;
  request_id: string | null;
  context_json: string;
  created_at: number;
};

export type PendingAdminAlert = {
  action: string;
  auditId: string;
  requestId: string;
  atMs: number;
};

export type HealthCheckDependencies = {
  broker: (
    namespace: DurableObjectNamespace<AdsbBroker>,
    command: BrokerCommand,
  ) => Promise<BrokerCommandResult>;
};

const DEFAULT_DEPENDENCIES: HealthCheckDependencies = {
  broker: sendBrokerCommand,
};

function forceMode(env: Env): SystemMode {
  if (!isSystemMode(env.FORCE_MODE)) throw new TypeError("FORCE_MODE is invalid");
  return env.FORCE_MODE;
}

function parseAdminAlert(row: AdminAlertRow): PendingAdminAlert | null {
  let context: unknown;
  try {
    context = JSON.parse(row.context_json);
  } catch {
    return null;
  }
  if (context === null || typeof context !== "object" || Array.isArray(context)) return null;
  const auditId = (context as Record<string, unknown>).auditId;
  if (
    !ACTION.test(row.event_key) ||
    typeof auditId !== "string" ||
    !UUID.test(auditId) ||
    typeof row.request_id !== "string" ||
    !UUID.test(row.request_id) ||
    !Number.isSafeInteger(row.created_at) ||
    row.created_at < 0
  ) return null;
  return {
    action: row.event_key,
    auditId: auditId.toLowerCase(),
    requestId: row.request_id.toLowerCase(),
    atMs: row.created_at,
  };
}

export async function readPendingAdminAlerts(
  db: D1Database,
  scheduledAtMs: number,
): Promise<PendingAdminAlert[]> {
  const result = await db.prepare(
    `SELECT event_key, request_id, context_json, created_at
       FROM system_events
      WHERE category = 'admin-alert' AND created_at >= ? AND created_at <= ?
      ORDER BY created_at ASC
      LIMIT 200`,
  ).bind(Math.max(0, scheduledAtMs - LOOKBACK_MS), scheduledAtMs).all<AdminAlertRow>();
  return result.results.flatMap((row) => {
    const parsed = parseAdminAlert(row);
    return parsed === null ? [] : [parsed];
  });
}

export async function runHealthCheck(
  env: Env,
  scheduledAtMs: number,
  overrides: Partial<HealthCheckDependencies> = {},
): Promise<void> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const deploymentMode = forceMode(env);
  let adminAlerts: PendingAdminAlert[] = [];
  let d1Outcome: "success" | "failure" = "success";
  try {
    adminAlerts = await readPendingAdminAlerts(env.DB, scheduledAtMs);
  } catch (error) {
    d1Outcome = "failure";
    console.error("adsb_health_check_d1_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
  await dependencies.broker(env.ADSB_BROKER, {
    type: "health-record",
    component: "d1",
    outcome: d1Outcome,
  }).catch((error) => {
    console.error("adsb_health_check_broker_observation_failed", {
      observation: "d1",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  });

  for (const alert of adminAlerts) {
    await dependencies.broker(env.ADSB_BROKER, {
      type: "alert-admin",
      ...alert,
      forceMode: deploymentMode,
    }).catch((error) => {
      console.error("adsb_health_check_broker_observation_failed", {
        observation: "admin-action",
        auditId: alert.auditId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });
  }
  await dependencies.broker(env.ADSB_BROKER, {
    type: "health-check",
    scheduledAtMs,
    forceMode: deploymentMode,
  });
}
