import { env } from "cloudflare:workers";
import {
  evictDurableObject,
  reset,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AdsbBroker,
  seedAdmittedRequestsForTest,
  setBrokerClockForTest,
} from "./AdsbBroker";
import { FakeClock } from "./clock";
import {
  brokerStub,
  sendBrokerCommand,
  type AdmissionResult,
  type BrokerCommand,
  type LeaseResult,
} from "./protocol";

const USER_IDS = Array.from(
  { length: 11 },
  (_, index) => `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
);
const MISSION_IDS = Array.from(
  { length: 12 },
  (_, index) => `${String(index + 1).padStart(8, "0")}-2222-4222-8222-222222222222`,
);
// Keep lease alarms in the future relative to the real workerd alarm manager;
// broker time itself remains controlled by FakeClock.
const START = Date.parse("2030-08-10T12:00:00.000Z");

type TestEnvironment = Cloudflare.Env & {
  ADSB_BROKER: DurableObjectNamespace<AdsbBroker>;
};

function testEnvironment(): TestEnvironment {
  return env as TestEnvironment;
}

function stub(): DurableObjectStub<AdsbBroker> {
  return brokerStub(testEnvironment().ADSB_BROKER) as DurableObjectStub<AdsbBroker>;
}

async function setClock(target: DurableObjectStub<AdsbBroker>, clock: FakeClock) {
  await runInDurableObject<AdsbBroker, void>(target, (broker) => {
    setBrokerClockForTest(broker, clock);
  });
}

async function seedCount(target: DurableObjectStub<AdsbBroker>, count: number) {
  await runInDurableObject<AdsbBroker, void>(target, async (broker, state) => {
    await seedAdmittedRequestsForTest(broker, state, count);
  });
}

async function command<T extends BrokerCommand>(target: DurableObjectStub, value: T) {
  const namespace = testEnvironment().ADSB_BROKER;
  expect(target.id.equals(brokerStub(namespace).id)).toBe(true);
  return sendBrokerCommand(namespace, value);
}

async function acquire(
  target: DurableObjectStub,
  userId: string,
  missionId: string,
) {
  return command(target, {
    type: "lease-acquire",
    forceMode: "NORMAL",
    userId,
    missionId,
  }) as Promise<LeaseResult>;
}

beforeEach(async () => {
  await reset();
});

describe("AdsbBroker", () => {
  it("transitions exactly at 70/90/100 percent and rolls over at UTC midnight", async () => {
    const target = stub();
    const clock = new FakeClock(Date.parse("2026-08-10T23:59:59.999Z"));
    await setClock(target, clock);

    await seedCount(target, 69_999);
    const conservation = (await command(target, {
      type: "admit",
      kind: "public-read",
      forceMode: "NORMAL",
    })) as AdmissionResult;
    expect(conservation).toMatchObject({
      allowed: true,
      status: { admittedRequests: 70_000, budgetBand: "conservation", automaticMode: "NORMAL" },
    });

    await seedCount(target, 89_999);
    const readOnly = (await command(target, {
      type: "admit",
      kind: "public-read",
      forceMode: "NORMAL",
    })) as AdmissionResult;
    expect(readOnly).toMatchObject({
      allowed: true,
      status: { admittedRequests: 90_000, budgetBand: "read-only", automaticMode: "READ_ONLY" },
    });

    await seedCount(target, 99_999);
    const finalAdmission = (await command(target, {
      type: "admit",
      kind: "public-read",
      forceMode: "NORMAL",
    })) as AdmissionResult;
    expect(finalAdmission).toMatchObject({
      allowed: true,
      status: { admittedRequests: 100_000, budgetBand: "kill-switch", automaticMode: "KILL_SWITCH" },
    });
    const denied = (await command(target, {
      type: "admit",
      kind: "public-read",
      forceMode: "NORMAL",
    })) as AdmissionResult;
    expect(denied).toMatchObject({ allowed: false, reason: "kill-switch" });

    clock.advance(1);
    const nextDay = (await command(target, {
      type: "admit",
      kind: "public-read",
      forceMode: "NORMAL",
    })) as AdmissionResult;
    expect(nextDay).toMatchObject({
      allowed: true,
      status: {
        utcDay: "2026-08-11",
        admittedRequests: 1,
        budgetBand: "normal",
        automaticMode: "NORMAL",
      },
    });
  });

  it("allocates 150 protected refreshes per active lease and returns unused reserve", async () => {
    const target = stub();
    await setClock(target, new FakeClock(START));
    await acquire(target, USER_IDS[0]!, MISSION_IDS[0]!);
    await acquire(target, USER_IDS[1]!, MISSION_IDS[1]!);
    await seedCount(target, 89_999);

    const threshold = (await command(target, {
      type: "admit",
      kind: "public-read",
      forceMode: "NORMAL",
    })) as AdmissionResult;
    expect(threshold.status.protectedReserveRemaining).toBe(300);

    await seedCount(target, 99_700);
    const browseDenied = (await command(target, {
      type: "admit",
      kind: "public-read",
      forceMode: "NORMAL",
    })) as AdmissionResult;
    expect(browseDenied).toMatchObject({ allowed: false, reason: "protected-reserve" });

    const protectedFlight = (await command(target, {
      type: "admit",
      kind: "active-flight",
      forceMode: "NORMAL",
      userId: USER_IDS[0]!,
      missionId: MISSION_IDS[0]!,
    })) as AdmissionResult;
    expect(protectedFlight).toMatchObject({
      allowed: true,
      status: { admittedRequests: 99_701, protectedReserveRemaining: 299 },
    });

    await command(target, {
      type: "lease-release",
      userId: USER_IDS[1]!,
      missionId: MISSION_IDS[1]!,
    });
    const afterRelease = await command(target, { type: "status", forceMode: "NORMAL" });
    expect(afterRelease.status.protectedReserveRemaining).toBe(149);
  });

  it("serializes concurrent requests at the exact daily ceiling", async () => {
    const target = stub();
    await setClock(target, new FakeClock(START));
    await seedCount(target, 99_999);

    const outcomes = await Promise.all([
      command(target, { type: "admit", kind: "public-read", forceMode: "NORMAL" }),
      command(target, { type: "admit", kind: "public-read", forceMode: "NORMAL" }),
    ]);
    const admissions = outcomes as AdmissionResult[];
    expect(admissions.filter(({ allowed }) => allowed)).toHaveLength(1);
    expect(admissions.filter(({ allowed }) => !allowed)).toHaveLength(1);
    expect(admissions.find(({ allowed }) => !allowed)?.reason).toBe("kill-switch");
    expect(admissions.every(({ status }) => status.admittedRequests === 100_000)).toBe(true);
  });

  it("enforces one lease per user, ten globally, warning/full transitions, and concurrency", async () => {
    const target = stub();
    await setClock(target, new FakeClock(START));

    const duplicateUser = await Promise.all([
      acquire(target, USER_IDS[0]!, MISSION_IDS[0]!),
      acquire(target, USER_IDS[0]!, MISSION_IDS[1]!),
    ]);
    expect(duplicateUser.filter(({ allowed }) => allowed)).toHaveLength(1);
    expect(duplicateUser.find(({ allowed }) => !allowed)?.reason).toBe("user-limit");
    await command(target, { type: "lease-release-user", userId: USER_IDS[0]! });

    const outcomes = await Promise.all(
      USER_IDS.slice(0, 10).map((userId, index) => acquire(target, userId, MISSION_IDS[index]!)),
    );
    expect(outcomes.filter(({ allowed }) => allowed)).toHaveLength(10);
    expect(
      outcomes.some(({ status: brokerStatus }) =>
        brokerStatus.lastAlertTransition?.kind === "flight-capacity" &&
        brokerStatus.lastAlertTransition.from === "normal" &&
        brokerStatus.lastAlertTransition.to === "warning"),
    ).toBe(true);
    expect(
      outcomes.some(({ status: brokerStatus }) =>
        brokerStatus.lastAlertTransition?.kind === "flight-capacity" &&
        brokerStatus.lastAlertTransition.from === "warning" &&
        brokerStatus.lastAlertTransition.to === "full"),
    ).toBe(true);

    await expect(acquire(target, USER_IDS[10]!, MISSION_IDS[10]!)).resolves.toMatchObject({
      allowed: false,
      reason: "global-limit",
    });
    await command(target, {
      type: "lease-release",
      userId: USER_IDS[9]!,
      missionId: MISSION_IDS[9]!,
    });
    await expect(acquire(target, USER_IDS[0]!, MISSION_IDS[11]!)).resolves.toMatchObject({
      allowed: false,
      reason: "user-limit",
    });
    await expect(
      command(target, { type: "lease-release-user", userId: USER_IDS[0]! }),
    ).resolves.toMatchObject({
      allowed: true,
      status: { activeFlights: 8, flightCapacityBand: "warning" },
    });
  });

  it("renews on an active poll and expires stale leases at the exact boundary", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    await setClock(target, clock);
    const initial = await acquire(target, USER_IDS[0]!, MISSION_IDS[0]!);
    expect(initial.lease?.expiresAtMs).toBe(START + 45_000);
    await runInDurableObject<AdsbBroker, void>(target, async (_broker, state) => {
      await expect(state.storage.getAlarm()).resolves.toBe(START + 45_000);
    });

    clock.advance(44_000);
    const renewed = (await command(target, {
      type: "admit",
      kind: "active-flight",
      forceMode: "NORMAL",
      userId: USER_IDS[0]!,
      missionId: MISSION_IDS[0]!,
    })) as AdmissionResult;
    expect(renewed.allowed).toBe(true);

    clock.advance(45_000);
    await expect(runDurableObjectAlarm(target)).resolves.toBe(true);
    const expired = (await command(target, {
      type: "admit",
      kind: "active-flight",
      forceMode: "NORMAL",
      userId: USER_IDS[0]!,
      missionId: MISSION_IDS[0]!,
    })) as AdmissionResult;
    expect(expired).toMatchObject({ allowed: false, reason: "lease-required" });
    expect(expired.status.activeFlights).toBe(0);
    await runInDurableObject<AdsbBroker, void>(target, async (_broker, state) => {
      await expect(state.storage.getAlarm()).resolves.toBeNull();
    });
  });

  it("persists counters, modes, leases, health, and transition deduplication across eviction", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    await setClock(target, clock);
    await acquire(target, USER_IDS[0]!, MISSION_IDS[0]!);
    await seedCount(target, 69_999);
    await command(target, { type: "admit", kind: "public-read", forceMode: "NORMAL" });
    const firstTransition = await command(target, { type: "transitions", forceMode: "NORMAL" });
    await command(target, { type: "admit", kind: "public-read", forceMode: "NORMAL" });
    const duplicate = await command(target, { type: "transitions", forceMode: "NORMAL" });
    if (firstTransition.type !== "transition" || duplicate.type !== "transition") {
      throw new TypeError("Expected transition results");
    }
    expect(duplicate.transition).toEqual(firstTransition.transition);
    await command(target, { type: "provider-record", outcome: "failure" });
    await command(target, {
      type: "health-record",
      component: "d1",
      outcome: "failure",
    });
    await command(target, {
      type: "mode-set",
      requestedMode: "READ_ONLY",
      forceMode: "NORMAL",
    });

    await evictDurableObject(target);
    await setClock(target, clock);
    const recovered = await command(target, { type: "status", forceMode: "NORMAL" });
    expect(recovered.status).toMatchObject({
      admittedRequests: 70_001,
      requestedMode: "READ_ONLY",
      effectiveMode: "READ_ONLY",
      activeFlights: 1,
      providerRequests: 1,
      health: { providerFailures: 1, componentFailures: 1 },
    });
    const resetHealth = await command(target, {
      type: "recover",
      action: "reset-health-counters",
      forceMode: "NORMAL",
    });
    expect(resetHealth.status.health).toEqual({
      admitted: 0,
      admissionRejected: 0,
      leaseRejected: 0,
      providerCalls: 0,
      providerFailures: 0,
      componentFailures: 0,
    });
  });

  it("keeps automatic and deployment modes stricter than administrator requests", async () => {
    const target = stub();
    await setClock(target, new FakeClock(START));
    await seedCount(target, 90_000);

    const adminNormal = await command(target, {
      type: "mode-set",
      requestedMode: "NORMAL",
      forceMode: "NORMAL",
    });
    expect(adminNormal.status.effectiveMode).toBe("READ_ONLY");

    const forced = await command(target, {
      type: "mode-set",
      requestedMode: "NORMAL",
      forceMode: "KILL_SWITCH",
    });
    expect(forced.status.effectiveMode).toBe("KILL_SWITCH");
  });

  it("rejects malformed or externally shaped requests without state detail", async () => {
    const target = stub();
    const badMethod = await target.fetch("https://adsb-broker.invalid/internal/broker");
    expect(badMethod.status).toBe(405);

    const malformed = await target.fetch("https://adsb-broker.invalid/internal/broker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "status", forceMode: "NORMAL", objectName: "other" }),
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      ok: false,
      error: { code: "INVALID_COMMAND", message: "Invalid broker command" },
    });
  });

  it("fails closed with a generic response when persisted state is invalid", async () => {
    const target = stub();
    await setClock(target, new FakeClock(START));
    await command(target, { type: "status", forceMode: "NORMAL" });
    await runInDurableObject<AdsbBroker, void>(target, async (_broker, state) => {
      await state.storage.put("broker-state:v1", {
        version: 1,
        utcDay: "raw-secret-invalid-state",
      });
    });

    const response = await target.fetch("https://adsb-broker.invalid/internal/broker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "status", forceMode: "NORMAL" }),
    });
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("Broker command failed");
    expect(body).not.toContain("raw-secret-invalid-state");
  });
});
