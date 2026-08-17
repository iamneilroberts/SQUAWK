import type {
  BrokerTransition,
  BudgetBand,
  FlightCapacityBand,
} from "../durable/protocol";

export const ALERT_STATE_KEY = "alert-state:v1";
export const ALERT_COOLDOWN_MS = 60 * 60 * 1_000;
export const ALERT_RETRY_BASE_MS = 60 * 1_000;

export type AlertKind =
  | "budget"
  | "flight-capacity"
  | "api-health"
  | "component-health"
  | "provider-health"
  | "provider-capacity"
  | "admin-action"
  | "test";

export type AlertPhase = "active" | "recovery" | "test";
export type AlertSeverity = "warning" | "error" | "recovery" | "test";
export type AlertComponent = "d1" | "r2" | "email" | "provider";

export type AlertNotification = {
  fingerprint: string;
  signalKey: string;
  kind: AlertKind;
  phase: AlertPhase;
  severity: AlertSeverity;
  occurredAtMs: number;
  title: string;
  threshold: string | null;
  action: string | null;
  remainingCapacity: number | null;
  requestId: string | null;
  auditId: string | null;
};

export type AlertOutboxItem = {
  alert: AlertNotification;
  attempts: number;
  nextAttemptAtMs: number;
};

export type AlertSignalState = {
  key: string;
  active: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  sequence: number;
};

export type AlertCooldown = {
  key: string;
  queuedAtMs: number;
};

export type AlertCoordinatorState = {
  version: 1;
  lastBrokerTransitionSequence: number;
  signals: AlertSignalState[];
  apiWindow: {
    startedAtMs: number;
    total: number;
    failures: number;
    active: boolean;
    sequence: number;
  };
  providerCapacity: {
    band: "normal" | "70" | "90" | "100";
    sequence: number;
  };
  seenAuditIds: string[];
  cooldowns: AlertCooldown[];
  outbox: AlertOutboxItem[];
  deliveredFingerprints: string[];
  lastCronAtMs: number | null;
};

export type AlertObservation =
  | {
      type: "broker-transition";
      transition: BrokerTransition;
      remainingCapacity: number;
    }
  | {
      type: "request-outcome";
      outcome: "success" | "failure";
      atMs: number;
    }
  | {
      type: "component-outcome";
      component: AlertComponent;
      outcome: "success" | "failure";
      atMs: number;
    }
  | {
      type: "provider-staleness";
      stale: boolean;
      atMs: number;
    }
  | {
      type: "provider-capacity";
      used: number;
      limit: number;
      atMs: number;
    }
  | {
      type: "admin-action";
      action: string;
      auditId: string;
      requestId: string;
      atMs: number;
    }
  | {
      type: "test";
      auditId: string;
      requestId: string;
      atMs: number;
    }
  | { type: "cron"; atMs: number };

export function isBudgetBand(value: string): value is BudgetBand {
  return ["normal", "conservation", "read-only", "kill-switch"].includes(value);
}

export function isFlightCapacityBand(value: string): value is FlightCapacityBand {
  return ["normal", "warning", "full"].includes(value);
}
