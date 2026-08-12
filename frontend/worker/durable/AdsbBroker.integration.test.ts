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
  brokerProviderQueueForTest,
  brokerSignedViewerCountForTest,
  seedAdmittedRequestsForTest,
  setBrokerAlertSenderForTest,
  setBrokerClockForTest,
  setBrokerSleeperForTest,
  setBrokerTrafficProviderForTest,
  type BrokerTrafficProvider,
} from "./AdsbBroker";
import type { AlertNotification } from "../alerts/types";
import type { ProviderSettings } from "../adsb/provider";
import type { TrafficAudience } from "../adsb/traffic";
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

const TRAFFIC_SETTINGS: ProviderSettings = {
  templates: ["https://fake-provider.test/{lat}/{lon}/{radius}"],
  minimumIntervalMs: 0,
  dailyLimit: 1_000,
  maximumRadiusNm: 300,
  timeoutMs: 12_000,
  maximumResponseBytes: 1_048_576,
};

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

async function setTrafficProvider(
  target: DurableObjectStub<AdsbBroker>,
  provider: BrokerTrafficProvider,
  settings: ProviderSettings = TRAFFIC_SETTINGS,
  sleeper?: (milliseconds: number) => Promise<void>,
) {
  await runInDurableObject<AdsbBroker, void>(target, (broker) => {
    setBrokerTrafficProviderForTest(broker, provider, settings);
    if (sleeper !== undefined) setBrokerSleeperForTest(broker, sleeper);
  });
}

async function setAlertSender(
  target: DurableObjectStub<AdsbBroker>,
  sender: (alert: AlertNotification) => Promise<void>,
) {
  await runInDurableObject<AdsbBroker, void>(target, (broker) => {
    setBrokerAlertSenderForTest(broker, (_environment, alert) => sender(alert));
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

function traffic(
  target: DurableObjectStub,
  latitude = 30,
  longitude = -88,
  audience: TrafficAudience = { kind: "anonymous" },
  forceMode: "NORMAL" | "READ_ONLY" | "KILL_SWITCH" = "NORMAL",
) {
  return command(target, {
    type: "traffic",
    forceMode,
    request: { latitude, longitude, radiusNm: 80, audience },
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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

  it("persists failed alert delivery, retries after eviction, and deduplicates the command", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    const received: AlertNotification[] = [];
    let fail = true;
    await setClock(target, clock);
    await setAlertSender(target, async (alert) => {
      if (fail) throw new Error("email unavailable");
      received.push(alert);
    });
    const auditId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const testCommand = {
      type: "alert-test" as const,
      auditId,
      requestId,
      atMs: START,
      forceMode: "NORMAL" as const,
    };

    await command(target, testCommand);
    await command(target, testCommand);
    expect(received).toEqual([]);

    await evictDurableObject(target);
    clock.advance(60_000);
    fail = false;
    await setClock(target, clock);
    await setAlertSender(target, async (alert) => {
      received.push(alert);
    });
    await command(target, {
      type: "health-check",
      scheduledAtMs: clock.nowMs(),
      forceMode: "NORMAL",
    });
    await command(target, testCommand);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      kind: "test",
      phase: "test",
      auditId,
      requestId,
    });
  });

  it("alerts once for sustained provider failure and once for recovery", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    const received: AlertNotification[] = [];
    await setClock(target, clock);
    await setAlertSender(target, async (alert) => {
      received.push(alert);
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await command(target, {
        type: "health-record",
        component: "provider",
        outcome: "failure",
      });
    }
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: "provider-health", phase: "active" });

    clock.advance(1);
    await command(target, {
      type: "health-record",
      component: "provider",
      outcome: "success",
    });
    await command(target, {
      type: "health-record",
      component: "provider",
      outcome: "success",
    });
    expect(received).toHaveLength(2);
    expect(received[1]).toMatchObject({ kind: "provider-health", phase: "recovery" });
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

  it("persists operational settings and blocks registration or provider refresh independently", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    await setClock(target, clock);
    let calls = 0;
    await setTrafficProvider(target, async (_region, _settings, gate, nowMs) => {
      await gate.beforeAttempt();
      calls += 1;
      return {
        contacts: [],
        source: "fake-provider.test",
        sourceTime: nowMs() / 1_000,
        fetchedAt: nowMs() / 1_000,
      };
    });

    const settings = await command(target, {
      type: "settings-set",
      registrationEnabled: false,
      providerCacheOnly: true,
      forceMode: "NORMAL",
    });
    expect(settings.status).toMatchObject({
      registrationEnabled: false,
      providerCacheOnly: true,
      effectiveMode: "NORMAL",
    });
    await expect(
      command(target, { type: "admit", kind: "registration", forceMode: "NORMAL" }),
    ).resolves.toMatchObject({ allowed: false, reason: "registration-disabled" });
    await expect(
      traffic(target, 30, -88, {
        kind: "active-ghost",
        userId: USER_IDS[0]!,
        missionId: MISSION_IDS[0]!,
        selectedHex: "abc123",
      }),
    ).resolves.toMatchObject({
      type: "traffic",
      traffic: { freshness: "EXPIRED", providerAvailable: false },
    });
    expect(calls).toBe(0);

    await evictDurableObject(target);
    await setClock(target, clock);
    await expect(command(target, { type: "status", forceMode: "NORMAL" })).resolves.toMatchObject({
      status: { registrationEnabled: false, providerCacheOnly: true },
    });
  });

  it("migrates the live version-one broker state with safe control defaults", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    await setClock(target, clock);
    await command(target, { type: "status", forceMode: "NORMAL" });
    await runInDurableObject<AdsbBroker, void>(target, async (_broker, state) => {
      const current = await state.storage.get<Record<string, unknown>>("broker-state:v1");
      expect(current).toBeDefined();
      const {
        registrationEnabled: _registrationEnabled,
        providerCacheOnly: _providerCacheOnly,
        ...versionOne
      } = current!;
      await state.storage.put("broker-state:v1", { ...versionOne, version: 1 });
    });

    await evictDurableObject(target);
    await setClock(target, clock);
    await expect(command(target, { type: "status", forceMode: "NORMAL" })).resolves.toMatchObject({
      status: { registrationEnabled: true, providerCacheOnly: false },
    });
  });

  it("clears exactly one normalized traffic region", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    await setClock(target, clock);
    let calls = 0;
    await setTrafficProvider(target, async (_region, _settings, gate, nowMs) => {
      await gate.beforeAttempt();
      calls += 1;
      return {
        contacts: [],
        source: "fake-provider.test",
        sourceTime: nowMs() / 1_000,
        fetchedAt: nowMs() / 1_000,
      };
    });
    const first = await traffic(target, 30, -88);
    const second = await traffic(target, 34, -88);
    if (first.type !== "traffic" || second.type !== "traffic") throw new TypeError("traffic expected");

    await expect(command(target, {
      type: "cache-clear-region",
      regionKey: first.traffic.regionKey,
      forceMode: "NORMAL",
    })).resolves.toMatchObject({
      type: "cache-cleared",
      regionKey: first.traffic.regionKey,
      cleared: true,
    });
    await expect(traffic(target, 34, -88)).resolves.toMatchObject({
      type: "traffic",
      traffic: { cacheStatus: "HIT", regionKey: second.traffic.regionKey },
    });
    await traffic(target, 30, -88);
    expect(calls).toBe(3);
  });

  it("coalesces one hundred simultaneous same-region reads to one provider fetch", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    await setClock(target, clock);
    const release = deferred();
    let providerCalls = 0;
    const provider: BrokerTrafficProvider = async (region, _settings, gate, nowMs) => {
      await gate.beforeAttempt();
      providerCalls += 1;
      await release.promise;
      return {
        contacts: [{
          hex: "abc123",
          flight: "TEST1",
          t: "C172",
          lat: region.providerCenter.lat,
          lon: region.providerCenter.lon,
          alt_geom: 1_000,
          alt_baro: 900,
          gs: 100,
          track: 90,
          baro_rate: 0,
          military: false,
          seen_pos: 0,
        }],
        source: "fake-provider.test",
        sourceTime: nowMs() / 1_000,
        fetchedAt: nowMs() / 1_000,
      };
    };
    await setTrafficProvider(target, provider);

    const requests = Array.from({ length: 100 }, () => traffic(target));
    await expect.poll(() => providerCalls).toBe(1);
    release.resolve();
    const results = await Promise.all(requests);

    expect(providerCalls).toBe(1);
    expect(results.every((result) => result.type === "traffic")).toBe(true);
    expect(
      results.every((result) => result.type !== "traffic" || result.traffic.contacts.length === 1),
    ).toBe(true);
    const brokerStatus = await command(target, { type: "status", forceMode: "NORMAL" });
    expect(brokerStatus.status).toMatchObject({ providerRequests: 1, health: { providerCalls: 1 } });
  });

  it("serializes distinct regions through the persisted global minimum interval", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    await setClock(target, clock);
    const attemptTimes: number[] = [];
    const provider: BrokerTrafficProvider = async (_region, _settings, gate, nowMs) => {
      await gate.beforeAttempt();
      attemptTimes.push(nowMs());
      return {
        contacts: [],
        source: "fake-provider.test",
        sourceTime: nowMs() / 1_000,
        fetchedAt: nowMs() / 1_000,
      };
    };
    await setTrafficProvider(
      target,
      provider,
      { ...TRAFFIC_SETTINGS, minimumIntervalMs: 1_000 },
      async (milliseconds) => {
        clock.advance(milliseconds);
      },
    );

    await Promise.all([
      traffic(target, 30, -88),
      traffic(target, 32, -88),
      traffic(target, 34, -88),
    ]);

    expect(attemptTimes).toEqual([START, START + 1_000, START + 2_000]);
    const brokerStatus = await command(target, { type: "status", forceMode: "NORMAL" });
    expect(brokerStatus.status.providerRequests).toBe(3);
  });

  it("serves bounded stale data with backoff, persists it, then expires contacts", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    await setClock(target, clock);
    let fail = false;
    let providerCalls = 0;
    const provider: BrokerTrafficProvider = async (region, _settings, gate, nowMs) => {
      await gate.beforeAttempt();
      providerCalls += 1;
      if (fail) {
        await gate.attemptFailed();
        throw new Error("fake outage");
      }
      return {
        contacts: [{
          hex: "abc123",
          flight: null,
          t: null,
          lat: region.requestedCenter.lat,
          lon: region.requestedCenter.lon,
          alt_geom: null,
          alt_baro: "ground",
          gs: null,
          track: null,
          baro_rate: null,
          military: false,
          seen_pos: 0,
        }],
        source: "fake-provider.test",
        sourceTime: nowMs() / 1_000,
        fetchedAt: nowMs() / 1_000,
      };
    };
    await setTrafficProvider(target, provider);
    await expect(traffic(target)).resolves.toMatchObject({
      type: "traffic",
      traffic: { freshness: "FRESH", providerAvailable: true, contacts: [{ hex: "abc123" }] },
    });

    clock.advance(31_000); // past the 30s TRAFFIC_FRESH_SECONDS window → STALE
    fail = true;
    await expect(traffic(target)).resolves.toMatchObject({
      type: "traffic",
      traffic: { freshness: "STALE", providerAvailable: false, contacts: [{ hex: "abc123" }] },
    });
    expect(providerCalls).toBe(2);
    await expect(traffic(target)).resolves.toMatchObject({
      type: "traffic",
      traffic: { freshness: "STALE", cacheStatus: "STALE" },
    });
    expect(providerCalls).toBe(2);

    await evictDurableObject(target);
    await setClock(target, clock);
    await setTrafficProvider(target, provider);
    await expect(traffic(target)).resolves.toMatchObject({
      type: "traffic",
      traffic: { freshness: "STALE", contacts: [{ hex: "abc123" }] },
    });
    expect(providerCalls).toBe(2);

    clock.advance(112_000);
    await expect(traffic(target)).resolves.toMatchObject({
      type: "traffic",
      traffic: { freshness: "EXPIRED", providerAvailable: false, contacts: [] },
    });
    expect(providerCalls).toBe(3);
  });

  it("bounds persisted regional cache entries and enforces the provider daily allowance", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    await setClock(target, clock);
    let calls = 0;
    const provider: BrokerTrafficProvider = async (_region, _settings, gate, nowMs) => {
      await gate.beforeAttempt();
      calls += 1;
      return {
        contacts: [],
        source: "fake-provider.test",
        sourceTime: nowMs() / 1_000,
        fetchedAt: nowMs() / 1_000,
      };
    };
    await setTrafficProvider(target, provider, { ...TRAFFIC_SETTINGS, dailyLimit: 40 });
    for (let index = 0; index < 40; index += 1) {
      await traffic(target, -80 + index * 4, -88);
      clock.advance(1);
    }
    expect(calls).toBe(40);
    await runInDurableObject<AdsbBroker, void>(target, async (_broker, state) => {
      const index = await state.storage.get<{ entries: unknown[] }>("traffic-index:v1");
      expect(index?.entries).toHaveLength(32);
      const bodies = await state.storage.list({ prefix: "traffic-body:v1:" });
      expect(bodies.size).toBe(32);
    });

    await expect(traffic(target, 85, -88)).resolves.toMatchObject({
      type: "traffic",
      traffic: { freshness: "EXPIRED", providerAvailable: false },
    });
    expect(calls).toBe(40);
  }, 10_000);

  it("records signed viewers even when the second viewer receives a cache hit", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    await setClock(target, clock);
    const provider: BrokerTrafficProvider = async (_region, _settings, gate, nowMs) => {
      await gate.beforeAttempt();
      return {
        contacts: [],
        source: "fake-provider.test",
        sourceTime: nowMs() / 1_000,
        fetchedAt: nowMs() / 1_000,
      };
    };
    await setTrafficProvider(target, provider);

    await traffic(target, 30, -88, { kind: "signed", userId: USER_IDS[0]! });
    await traffic(target, 30, -88, { kind: "signed", userId: USER_IDS[1]! });

    await expect(
      runInDurableObject<AdsbBroker, number>(target, (broker) =>
        brokerSignedViewerCountForTest(broker),
      ),
    ).resolves.toBe(2);
  });

  it("returns a bounded administrative snapshot without traffic contacts", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    await setClock(target, clock);
    await acquire(target, USER_IDS[0]!, MISSION_IDS[0]!);
    await setTrafficProvider(target, async (_region, _settings, gate, nowMs) => {
      await gate.beforeAttempt();
      return {
        contacts: [{
          hex: "abc123",
          flight: "PRIVATE1",
          t: "F16",
          lat: 30,
          lon: -88,
          alt_geom: 1_000,
          alt_baro: 900,
          gs: 100,
          track: 90,
          baro_rate: 0,
          military: true,
          seen_pos: 0,
        }],
        source: "fake-provider.test",
        sourceTime: nowMs() / 1_000,
        fetchedAt: nowMs() / 1_000,
      };
    });
    await traffic(target, 30, -88, {
      kind: "active-ghost",
      userId: USER_IDS[0]!,
      missionId: MISSION_IDS[0]!,
      selectedHex: "abc123",
    });

    const result = await command(target, { type: "admin-snapshot", forceMode: "NORMAL" });
    expect(result).toMatchObject({
      type: "admin-snapshot",
      snapshot: {
        capturedAtMs: START,
        leases: [{ userId: USER_IDS[0], missionId: MISSION_IDS[0] }],
        cacheRegions: [{ viewerCount: 1, providerAvailable: true }],
        presence: [{
          userId: USER_IDS[0],
          missionId: MISSION_IDS[0],
          audience: "active-ghost",
        }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE1");
    expect(JSON.stringify(result)).not.toContain("abc123");

    clock.advance(45_001);
    const expired = await command(target, { type: "admin-snapshot", forceMode: "NORMAL" });
    expect(expired.type === "admin-snapshot" && expired.snapshot.presence).toEqual([]);
  });

  it("serves cache-only browsing in read-only mode while active ghosts may refresh", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    await setClock(target, clock);
    let calls = 0;
    const provider: BrokerTrafficProvider = async (_region, _settings, gate, nowMs) => {
      await gate.beforeAttempt();
      calls += 1;
      return {
        contacts: [],
        source: "fake-provider.test",
        sourceTime: nowMs() / 1_000,
        fetchedAt: nowMs() / 1_000,
      };
    };
    await setTrafficProvider(target, provider);

    await expect(
      traffic(target, 30, -88, { kind: "anonymous" }, "READ_ONLY"),
    ).resolves.toMatchObject({
      type: "traffic",
      traffic: { freshness: "EXPIRED", providerAvailable: false },
      status: { effectiveMode: "READ_ONLY" },
    });
    expect(calls).toBe(0);

    await expect(
      traffic(
        target,
        30,
        -88,
        {
          kind: "active-ghost",
          userId: USER_IDS[0]!,
          missionId: MISSION_IDS[0]!,
          selectedHex: "abc123",
        },
        "READ_ONLY",
      ),
    ).resolves.toMatchObject({
      type: "traffic",
      traffic: { freshness: "FRESH", providerAvailable: true },
    });
    expect(calls).toBe(1);
  });

  it("runs queued active ghost work before anonymous and ambient work", async () => {
    const target = stub();
    const clock = new FakeClock(START);
    await setClock(target, clock);
    const firstRelease = deferred();
    const order: string[] = [];
    let first = true;
    const provider: BrokerTrafficProvider = async (region, _settings, gate, nowMs) => {
      await gate.beforeAttempt();
      order.push(String(region.providerCenter.lat));
      if (first) {
        first = false;
        await firstRelease.promise;
      }
      return {
        contacts: [],
        source: "fake-provider.test",
        sourceTime: nowMs() / 1_000,
        fetchedAt: nowMs() / 1_000,
      };
    };
    await setTrafficProvider(target, provider);
    const firstRequest = traffic(target, 10, -88);
    await expect.poll(() => order).toEqual(["10"]);
    const ambient = traffic(target, 20, -88, {
      kind: "ambient",
      userId: USER_IDS[0]!,
      missionId: MISSION_IDS[0]!,
    });
    const anonymous = traffic(target, 30, -88);
    const active = traffic(target, 40, -88, {
      kind: "active-ghost",
      userId: USER_IDS[1]!,
      missionId: MISSION_IDS[1]!,
      selectedHex: "abc123",
    });
    await expect.poll(() =>
      runInDurableObject<AdsbBroker, number>(target, (broker) =>
        brokerProviderQueueForTest(broker).length,
      ),
    ).toBe(2);
    firstRelease.resolve();
    const [, ambientResult] = await Promise.all([firstRequest, ambient, anonymous, active]);

    expect(order).toEqual(["10", "40", "30"]);
    expect(ambientResult).toMatchObject({
      type: "traffic",
      traffic: { freshness: "EXPIRED", providerAvailable: false },
    });
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
