import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Contact } from "../../src/data/types";
import {
  missionChoiceKey,
  missionVersions,
  type MissionPreparationPayload,
} from "../../src/mission/contract";
import { missionProfileForClass } from "../../src/mission/profiles";
import type { RunwayAssignment } from "../../src/mission/types";
import { DATA_VERSIONS } from "../../src/shared/versions";
import { createUser } from "../db/users";
import { signMissionPreparation } from "./authorization";
import {
  lockAuthoritativeMission,
  type MissionLeaseDependencies,
} from "./lock";

const NOW = 1_700_000_000_000;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PREPARATION_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_PREPARATION_ID = "33333333-3333-4333-8333-333333333333";
const SECRET = "test-only-mission-secret-with-at-least-32-bytes";
const IDEMPOTENCY_KEY = "mission-test-idempotency-key";

type TestEnvironment = Cloudflare.Env & {
  TEST_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

function runtime(): TestEnvironment {
  return env as TestEnvironment;
}

const contact: Contact = {
  hex: "a0b1c2",
  flight: "N123",
  t: "C172",
  lat: 30,
  lon: -88,
  alt_geom: 3_500,
  alt_baro: 3_400,
  gs: 110,
  track: 90,
  baro_rate: 0,
  military: false,
  seen_pos: 1,
};

const assignment: RunwayAssignment = {
  airportIdent: "TST",
  airportName: "TEST FIELD",
  airportLatDeg: 30,
  airportLonDeg: -87.8,
  airportElevationFt: 100,
  runwayId: "09-27",
  runwayIdent: "09/27",
  runwayEndIdent: "09",
  runwayHeadingDeg: 90,
  runwayLengthFt: 5_000,
  runwayWidthFt: 100,
  runwaySurface: "HARD",
  runwayLighted: true,
  assignedEnd: {
    ident: "09",
    latDeg: 30,
    lonDeg: -87.8,
    elevationFt: 100,
    headingDeg: 90,
    displacedThresholdFt: 0,
  },
  distanceNm: 10,
  estimatedMinutes: 5,
  suitability: 1,
};

function payload(
  preparationId = PREPARATION_ID,
  issuedAt = NOW - 1_000,
  expiresAt = NOW + 60_000,
): MissionPreparationPayload {
  const profile = missionProfileForClass("c172s");
  return {
    schemaVersion: 1,
    purpose: "mission-preparation",
    preparationId,
    userId: USER_ID,
    issuedAt,
    expiresAt,
    contact,
    traffic: {
      source: "fixture",
      sourceTime: NOW / 1_000,
      fetchedAt: NOW / 1_000,
      cacheAgeSeconds: 0,
      cacheStatus: "MISS",
      regionKey: "fixture",
      radiusNm: 25,
    },
    classId: "c172s",
    selected: assignment,
    eligibleChoices: [assignment],
    versions: missionVersions({
      datasetVersion: DATA_VERSIONS.airport,
      profileVersion: profile.profileVersion,
      assignmentVersion: profile.assignmentVersion,
      scoringVersion: profile.scoringVersion,
    }),
    fingerprint: "fixture",
  };
}

class FakeLeases implements MissionLeaseDependencies {
  readonly active = new Set<string>();
  readonly releases: string[] = [];
  deny = false;

  async acquire(userId: string, missionId: string) {
    if (this.deny) return null;
    this.active.add(`${userId}:${missionId}`);
    return { expiresAtMs: NOW + 45_000 };
  }

  async release(userId: string, missionId: string) {
    const key = `${userId}:${missionId}`;
    this.active.delete(key);
    this.releases.push(key);
  }
}

class BarrierLeases extends FakeLeases {
  private arrivals = 0;
  private releaseBarrier: (() => void) | null = null;
  private readonly barrier = new Promise<void>((resolve) => {
    this.releaseBarrier = resolve;
  });

  override async acquire(userId: string, missionId: string) {
    const lease = await super.acquire(userId, missionId);
    this.arrivals += 1;
    if (this.arrivals === 2) this.releaseBarrier?.();
    await this.barrier;
    return lease;
  }
}

async function token(value = payload()): Promise<string> {
  return signMissionPreparation(value, SECRET);
}

async function lock(options: {
  lease: FakeLeases;
  preparationToken?: string;
  choiceKey?: string;
  idempotencyKey?: string;
  now?: number;
}) {
  return lockAuthoritativeMission({
    db: runtime().TEST_DB,
    lease: options.lease,
    userId: USER_ID,
    idempotencyKey: options.idempotencyKey ?? IDEMPOTENCY_KEY,
    signingSecret: SECRET,
    now: options.now ?? NOW,
    request: {
      preparationToken: options.preparationToken ?? await token(),
      choiceKey: options.choiceKey ?? missionChoiceKey(assignment),
      assist: "high",
    },
  });
}

beforeEach(async () => {
  await reset();
  const { TEST_DB, TEST_MIGRATIONS } = runtime();
  await applyD1Migrations(TEST_DB, TEST_MIGRATIONS);
  await createUser(TEST_DB, {
    id: USER_ID,
    emailKey: "a".repeat(64),
    handle: "MissionPilot",
    createdAt: NOW - 10_000,
    updatedAt: NOW - 10_000,
  });
});

describe("authoritative mission lock", () => {
  it("commits one locked mission and one logical lease across duplicate retries", async () => {
    const lease = new FakeLeases();
    const preparationToken = await token();
    const first = await lock({ lease, preparationToken });
    const replay = await lock({ lease, preparationToken });

    expect(replay.missionId).toBe(first.missionId);
    expect(first.status).toBe("locked");
    expect(first.assignment.airportIdent).toBe("TST");
    await expect(
      runtime().TEST_DB.prepare("SELECT COUNT(*) AS count FROM missions").first<number>("count"),
    ).resolves.toBe(1);
    expect(lease.active.size).toBe(1);
  });

  it("returns an already committed idempotent result even after its preparation expires", async () => {
    const lease = new FakeLeases();
    const preparationToken = await token();
    const first = await lock({ lease, preparationToken });
    const replay = await lock({
      lease,
      preparationToken,
      now: NOW + 60_001,
    });
    expect(replay.missionId).toBe(first.missionId);
    await expect(
      runtime().TEST_DB.prepare("SELECT COUNT(*) AS count FROM missions").first<number>("count"),
    ).resolves.toBe(1);
  });

  it("does not release the winner's shared lease when a concurrent changed-key replay loses", async () => {
    const lease = new BarrierLeases();
    const preparationToken = await token();
    const results = await Promise.allSettled([
      lock({ lease, preparationToken, idempotencyKey: "concurrent-key-one" }),
      lock({ lease, preparationToken, idempotencyKey: "concurrent-key-two" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "MISSION_IDEMPOTENCY_CONFLICT" },
    });
    expect(lease.active.size).toBe(1);
    expect(lease.releases).toEqual([]);
    await expect(
      runtime().TEST_DB.prepare("SELECT COUNT(*) AS count FROM missions").first<number>("count"),
    ).resolves.toBe(1);
  });

  it("rejects an altered destination and an expired preparation before leasing", async () => {
    const lease = new FakeLeases();
    await expect(lock({ lease, choiceKey: "KNEW:01-19:01" }))
      .rejects.toMatchObject({ code: "MISSION_DESTINATION_INVALID" });
    const expired = await token(payload(PREPARATION_ID, NOW - 120_000, NOW - 1));
    await expect(lock({ lease, preparationToken: expired }))
      .rejects.toMatchObject({ code: "MISSION_PREPARATION_EXPIRED" });
    expect(lease.active.size).toBe(0);
  });

  it("rejects preparation replay or idempotency-key reuse with changed inputs", async () => {
    const lease = new FakeLeases();
    await lock({ lease });
    await expect(lock({ lease, idempotencyKey: "different-idempotency-key" }))
      .rejects.toMatchObject({ code: "MISSION_IDEMPOTENCY_CONFLICT" });

    const second = await token(payload(SECOND_PREPARATION_ID));
    await expect(lock({ lease, preparationToken: second }))
      .rejects.toMatchObject({ code: "MISSION_IDEMPOTENCY_CONFLICT" });
  });

  it("releases the lease when D1 fails after acquisition", async () => {
    const lease = new FakeLeases();
    await runtime().TEST_DB.prepare(
      `CREATE TRIGGER reject_task9_mission
       BEFORE INSERT ON missions
       BEGIN
         SELECT RAISE(ABORT, 'fixture D1 failure');
       END`,
    ).run();

    await expect(lock({ lease })).rejects.toMatchObject({ code: "MISSION_COMMIT_FAILED" });
    expect(lease.active.size).toBe(0);
    expect(lease.releases).toEqual([`${USER_ID}:${PREPARATION_ID}`]);
  });

  it("does not write when the broker denies flight capacity", async () => {
    const lease = new FakeLeases();
    lease.deny = true;
    await expect(lock({ lease })).rejects.toMatchObject({ code: "MISSION_CAPACITY_UNAVAILABLE" });
    await expect(
      runtime().TEST_DB.prepare("SELECT COUNT(*) AS count FROM missions").first<number>("count"),
    ).resolves.toBe(0);
  });
});
