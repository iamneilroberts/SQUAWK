import { describe, expect, it } from "vitest";

import type { BrokerTransition } from "../durable/protocol";
import { ALERT_COOLDOWN_MS, ALERT_RECIPIENT } from "./types";
import {
  dueAlerts,
  emptyAlertState,
  markAlertDelivered,
  markAlertFailed,
  observeAlert,
} from "./transitions";
import { alertEmailMessage } from "./email";

const START = Date.parse("2026-08-10T23:59:00.000Z");

function brokerTransition(
  sequence: number,
  kind: BrokerTransition["kind"],
  from: string,
  to: string,
  atMs = START,
): BrokerTransition {
  return { sequence, kind, from, to, atMs } as BrokerTransition;
}

describe("alert transitions", () => {
  it("queues budget transitions once and emits the UTC reset recovery", () => {
    const state = emptyAlertState(START);
    observeAlert(state, {
      type: "broker-transition",
      transition: brokerTransition(1, "budget", "normal", "conservation"),
      remainingCapacity: 30_000,
    });
    observeAlert(state, {
      type: "broker-transition",
      transition: brokerTransition(1, "budget", "normal", "conservation"),
      remainingCapacity: 30_000,
    });
    observeAlert(state, {
      type: "broker-transition",
      transition: brokerTransition(2, "budget", "conservation", "normal", START + 60_000),
      remainingCapacity: 100_000,
    });

    expect(state.outbox).toHaveLength(2);
    expect(state.outbox[0]?.alert.threshold).toBe("70% of daily request capacity");
    expect(state.outbox[1]?.alert).toMatchObject({
      phase: "recovery",
      threshold: "UTC daily capacity reset",
    });
  });

  it("requires both a minimum count and failure rate and then recovers", () => {
    const state = emptyAlertState(START);
    for (let index = 0; index < 20; index += 1) {
      observeAlert(state, {
        type: "request-outcome",
        outcome: index < 5 ? "failure" : "success",
        atMs: START + index,
      });
    }
    expect(state.outbox.at(-1)?.alert).toMatchObject({ kind: "api-health", phase: "active" });
    markAlertDelivered(state, state.outbox[0]!.alert.fingerprint);

    observeAlert(state, { type: "cron", atMs: START + 5 * 60_000 });
    for (let index = 0; index < 20; index += 1) {
      observeAlert(state, {
        type: "request-outcome",
        outcome: "success",
        atMs: START + 5 * 60_000 + index,
      });
    }
    expect(state.outbox.at(-1)?.alert).toMatchObject({ kind: "api-health", phase: "recovery" });
  });

  it("alerts at provider 70/90/100 percent and recovers on the UTC reset", () => {
    const state = emptyAlertState(START);
    for (const [used, expected] of [[350, "70"], [450, "90"], [500, "100"]] as const) {
      observeAlert(state, { type: "provider-capacity", used, limit: 500, atMs: START + used });
      expect(state.outbox.at(-1)?.alert).toMatchObject({
        kind: "provider-capacity",
        threshold: `${expected}% of daily provider allowance`,
        remainingCapacity: 500 - used,
      });
    }
    observeAlert(state, { type: "provider-capacity", used: 0, limit: 500, atMs: START + 86_400_000 });
    expect(state.outbox.at(-1)?.alert).toMatchObject({
      phase: "recovery",
      threshold: "UTC daily provider capacity reset",
    });
  });

  it("deduplicates repeated provider observations and applies a persisted cooldown", () => {
    const state = emptyAlertState(START);
    for (let index = 0; index < 6; index += 1) {
      observeAlert(state, {
        type: "component-outcome",
        component: "provider",
        outcome: "failure",
        atMs: START + index,
      });
    }
    expect(state.outbox).toHaveLength(1);
    markAlertDelivered(state, state.outbox[0]!.alert.fingerprint);
    // Recovery is silent (no recovery email) but still clears `active` internally, so a
    // fresh run of failures below can re-trigger an active alert once cooldown allows it.
    for (let index = 0; index < 3; index += 1) {
      observeAlert(state, { type: "component-outcome", component: "provider", outcome: "success", atMs: START + 10 + index });
    }
    expect(state.outbox).toHaveLength(0);

    for (let index = 0; index < 6; index += 1) {
      observeAlert(state, {
        type: "component-outcome",
        component: "provider",
        outcome: "failure",
        atMs: START + 20 + index,
      });
    }
    // Still within the cooldown window from the first active alert, so no second is queued.
    expect(state.outbox).toHaveLength(0);

    for (let index = 0; index < 3; index += 1) {
      observeAlert(state, { type: "component-outcome", component: "provider", outcome: "success", atMs: START + 30 + index });
    }
    observeAlert(state, { type: "component-outcome", component: "provider", outcome: "failure", atMs: START + ALERT_COOLDOWN_MS + 30 });
    for (let index = 0; index < 6; index += 1) {
      observeAlert(state, {
        type: "component-outcome",
        component: "provider",
        outcome: "failure",
        atMs: START + ALERT_COOLDOWN_MS + 40 + index,
      });
    }
    expect(state.outbox.at(-1)?.alert.phase).toBe("active");
  });

  it("never emails again while a flapping provider keeps falling short of 3 consecutive successes", () => {
    const state = emptyAlertState(START);
    for (let index = 0; index < 6; index += 1) {
      observeAlert(state, {
        type: "component-outcome",
        component: "provider",
        outcome: "failure",
        atMs: START + index,
      });
    }
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0]?.alert.phase).toBe("active");
    markAlertDelivered(state, state.outbox[0]!.alert.fingerprint);

    // Flap success/success/failure for many cycles: consecutiveSuccesses peaks at 2 (never
    // the 3 needed to recover) and consecutiveFailures peaks at 1 (never the 6 needed for a
    // repeat active alert). This is the real-world every-20-30-min SDR flap the owner reported.
    let atMs = START + 100;
    for (let cycle = 0; cycle < 30; cycle += 1) {
      observeAlert(state, { type: "component-outcome", component: "provider", outcome: "success", atMs: atMs++ });
      observeAlert(state, { type: "component-outcome", component: "provider", outcome: "success", atMs: atMs++ });
      observeAlert(state, { type: "component-outcome", component: "provider", outcome: "failure", atMs: atMs++ });
    }

    expect(state.outbox).toHaveLength(0);
    const provider = state.signals.find((candidate) => candidate.key === "provider-health");
    expect(provider).toMatchObject({ active: true, consecutiveFailures: 1, consecutiveSuccesses: 0 });
  });

  it("retains failed deliveries and retries them with backoff", () => {
    const state = emptyAlertState(START);
    observeAlert(state, { type: "test", auditId: crypto.randomUUID(), requestId: crypto.randomUUID(), atMs: START });
    const fingerprint = state.outbox[0]!.alert.fingerprint;
    markAlertFailed(state, fingerprint, START);

    expect(dueAlerts(state, START + 59_999)).toEqual([]);
    expect(dueAlerts(state, START + 60_000)).toHaveLength(1);
    expect(state.outbox[0]).toMatchObject({ attempts: 1, nextAttemptAtMs: START + 60_000 });
  });

  it("addresses only the fixed recipient and marks test mail in subject and body", () => {
    const state = emptyAlertState(START);
    observeAlert(state, { type: "test", auditId: crypto.randomUUID(), requestId: crypto.randomUUID(), atMs: START });
    const message = alertEmailMessage(
      state.outbox[0]!.alert,
      "staging",
      "https://example.test/admin",
    );

    expect(message.to).toBe(ALERT_RECIPIENT);
    expect(message.subject).toContain("[TEST]");
    expect(message.text).toContain("TEST ALERT");
    expect(message.text).toContain("Time (UTC): 2026-08-10T23:59:00.000Z");
    expect(message.text).not.toContain("reason");
  });
});
