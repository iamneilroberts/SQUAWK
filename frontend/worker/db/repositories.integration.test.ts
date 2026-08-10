import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  executeAuditedMutation,
  getAdminAuditById,
} from "./audit";
import { banUser, getActiveBansForUser } from "./bans";
import { DatabaseValidationError } from "./client";
import {
  appendSystemEvent,
  clearExpiredEventTracePointers,
  pruneSystemEvents,
} from "./events";
import {
  clearExpiredMissionTracePointers,
  createMission,
  getMissionById,
  lockMission,
} from "./missions";
import { finalizeResult, getResultByMissionId } from "./results";
import {
  createSession,
  deleteExpiredSessions,
  getActiveSessionByDigest,
  rotateSession,
} from "./sessions";
import {
  consumeMagicLink,
  createMagicLink,
  createUser,
  deleteExpiredMagicLinks,
  getUserByEmailKey,
  getUserById,
  upsertUserPreferences,
} from "./users";

const NOW = 1_700_000_000_000;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const NEXT_SESSION_ID = "33333333-3333-4333-8333-333333333333";
const MAGIC_LINK_ID = "44444444-4444-4444-8444-444444444444";
const MISSION_ID = "55555555-5555-4555-8555-555555555555";
const RESULT_ID = "66666666-6666-4666-8666-666666666666";
const BAN_ID = "77777777-7777-4777-8777-777777777777";
const AUDIT_ID = "88888888-8888-4888-8888-888888888888";
const SECOND_AUDIT_ID = "99999999-9999-4999-8999-999999999999";

type TestEnvironment = Cloudflare.Env & {
  TEST_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

function testEnvironment(): TestEnvironment {
  return env as TestEnvironment;
}

function digest(character: string): string {
  return character.repeat(64);
}

async function seedUser(db: D1Database) {
  return createUser(db, {
    id: USER_ID,
    emailKey: digest("a"),
    handle: "SkyPilot",
    createdAt: NOW,
    updatedAt: NOW,
  });
}

beforeEach(async () => {
  const { TEST_DB, TEST_MIGRATIONS } = testEnvironment();
  await reset();
  await applyD1Migrations(TEST_DB, TEST_MIGRATIONS);
});

describe("D1 repositories", () => {
  it("creates users and preferences while enforcing digest and handle uniqueness", async () => {
    const { TEST_DB } = testEnvironment();
    const user = await seedUser(TEST_DB);
    const preferences = await upsertUserPreferences(TEST_DB, {
      userId: user.id,
      centerLat: 30.69,
      centerLon: -88.04,
      regionKey: "us-gulf-30.7--88.0",
      defaultAssist: "medium",
      tutorialState: "started",
      coachingEnabled: true,
      updatedAt: NOW + 1,
    });

    await expect(getUserByEmailKey(TEST_DB, digest("a"))).resolves.toEqual(user);
    expect(preferences).toMatchObject({ userId: USER_ID, coachingEnabled: true });
    await expect(
      createUser(TEST_DB, {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        emailKey: digest("a"),
        handle: "OtherPilot",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).rejects.toThrow();
    await expect(
      createUser(TEST_DB, {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        emailKey: digest("b"),
        handle: "skypilot",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).rejects.toThrow();
  });

  it("atomically consumes a magic link once and deletes expired token rows", async () => {
    const { TEST_DB } = testEnvironment();
    await createMagicLink(TEST_DB, {
      id: MAGIC_LINK_ID,
      tokenDigest: digest("b"),
      emailKey: digest("a"),
      expiresAt: NOW + 100,
      requestId: "request-123",
      requestedAt: NOW,
    });

    await expect(
      consumeMagicLink(TEST_DB, digest("b"), NOW + 1),
    ).resolves.toMatchObject({ consumedAt: NOW + 1 });
    await expect(
      consumeMagicLink(TEST_DB, digest("b"), NOW + 1),
    ).resolves.toBeNull();
    await expect(
      TEST_DB.prepare("UPDATE magic_links SET consumed_at = ? WHERE id = ?")
        .bind(NOW + 2, MAGIC_LINK_ID)
        .run(),
    ).rejects.toThrow();
    await createMagicLink(TEST_DB, {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      tokenDigest: digest("e"),
      emailKey: digest("a"),
      expiresAt: NOW + 100,
      requestId: "request-expiry-boundary",
      requestedAt: NOW,
    });
    await expect(
      consumeMagicLink(TEST_DB, digest("e"), NOW + 100),
    ).resolves.toBeNull();
    await expect(deleteExpiredMagicLinks(TEST_DB, NOW + 100)).resolves.toBe(2);
  });

  it("rotates an active session atomically and rejects replay of the old digest", async () => {
    const { TEST_DB } = testEnvironment();
    await seedUser(TEST_DB);
    await createSession(TEST_DB, {
      id: SESSION_ID,
      userId: USER_ID,
      sessionDigest: digest("c"),
      csrfDigest: digest("f"),
      expiresAt: NOW + 100,
      lastSeenAt: NOW,
      deviceLabel: "Firefox on test device",
      rotatedFromId: null,
      createdAt: NOW,
    });
    const replacement = {
      id: NEXT_SESSION_ID,
      userId: USER_ID,
      sessionDigest: digest("d"),
      csrfDigest: digest("e"),
      expiresAt: NOW + 200,
      lastSeenAt: NOW + 1,
      deviceLabel: "Firefox on test device",
      rotatedFromId: null,
      createdAt: NOW + 1,
    };

    await expect(
      rotateSession(TEST_DB, digest("c"), replacement, NOW + 1),
    ).resolves.toMatchObject({
      id: NEXT_SESSION_ID,
      rotatedFromId: SESSION_ID,
    });
    await expect(
      getActiveSessionByDigest(TEST_DB, digest("c"), NOW + 2),
    ).resolves.toBeNull();
    await expect(
      rotateSession(
        TEST_DB,
        digest("c"),
        {
          ...replacement,
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          createdAt: NOW + 2,
          lastSeenAt: NOW + 2,
        },
        NOW + 2,
      ),
    ).resolves.toBeNull();
    await expect(
      deleteExpiredSessions(TEST_DB, NOW + 150),
    ).resolves.toBeGreaterThanOrEqual(1);
    await expect(
      getActiveSessionByDigest(TEST_DB, digest("d"), NOW + 150),
    ).resolves.toMatchObject({ id: NEXT_SESSION_ID });
    await expect(
      getActiveSessionByDigest(TEST_DB, digest("d"), NOW + 200),
    ).resolves.toBeNull();
  });

  it("locks a bounded mission snapshot and finalizes exactly one result", async () => {
    const { TEST_DB } = testEnvironment();
    await seedUser(TEST_DB);
    await createMission(TEST_DB, {
      id: MISSION_ID,
      userId: USER_ID,
      aircraftHex: "Ab12Cd",
      aircraftClass: "light-jet",
      adsbSnapshot: { schemaVersion: 1, aircraft: { altitudeFt: 12_000 } },
      airportIcao: "kmob",
      runwayIdent: "15",
      scoringVersion: "score-v1",
      physicsVersion: "physics-v1",
      assists: { schemaVersion: 1, enabled: ["glideslope"] },
      tracePointer: "trace/mission-1",
      traceExpiresAt: NOW + 5,
      createdAt: NOW,
    });

    await expect(
      lockMission(TEST_DB, {
        missionId: MISSION_ID,
        lockedAt: NOW + 1,
        adsbSnapshot: { schemaVersion: 1, aircraft: { altitudeFt: 11_900 } },
        assists: { schemaVersion: 1, enabled: ["glideslope"] },
      }),
    ).resolves.toMatchObject({ status: "locked", lockedAt: NOW + 1 });
    await expect(
      lockMission(TEST_DB, {
        missionId: MISSION_ID,
        lockedAt: NOW + 2,
        adsbSnapshot: { schemaVersion: 1 },
        assists: { schemaVersion: 1 },
      }),
    ).resolves.toBeNull();

    await expect(
      finalizeResult(TEST_DB, {
        id: RESULT_ID,
        missionId: MISSION_ID,
        outcome: "landed",
        measurements: { schemaVersion: 1, sinkRateFpm: 120 },
        score: 98_500,
        highestAssist: "medium",
        evidenceStatus: "verified",
        evidenceSummary: { schemaVersion: 1, touchdown: "within-zone" },
        createdAt: NOW + 3,
      }),
    ).resolves.toMatchObject({ id: RESULT_ID, score: 98_500 });
    await expect(getMissionById(TEST_DB, MISSION_ID)).resolves.toMatchObject({
      status: "finalized",
      finalizedAt: NOW + 3,
    });
    await expect(
      TEST_DB.prepare(
        `INSERT INTO flight_results
         SELECT ?, mission_id, outcome, measurements_json, score, highest_assist,
                evidence_status, evidence_summary_json, created_at
           FROM flight_results WHERE mission_id = ?`,
      )
        .bind("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", MISSION_ID)
        .run(),
    ).rejects.toThrow();
    await expect(getResultByMissionId(TEST_DB, MISSION_ID)).resolves.toMatchObject({
      id: RESULT_ID,
    });
    await expect(clearExpiredMissionTracePointers(TEST_DB, NOW + 10)).resolves.toBe(
      1,
    );
  });

  it("rejects oversized or identity-bearing structured JSON before D1", async () => {
    const { TEST_DB } = testEnvironment();
    await seedUser(TEST_DB);
    const baseMission = {
      id: MISSION_ID,
      userId: USER_ID,
      aircraftHex: "ab12cd",
      aircraftClass: "light-jet",
      airportIcao: "KMOB",
      runwayIdent: "15",
      scoringVersion: "score-v1",
      physicsVersion: "physics-v1",
      assists: { schemaVersion: 1 },
      createdAt: NOW,
    };

    await expect(
      createMission(TEST_DB, {
        ...baseMission,
        adsbSnapshot: { schemaVersion: 1, raw: "x".repeat(25_000) },
      }),
    ).rejects.toBeInstanceOf(DatabaseValidationError);
    await expect(
      createMission(TEST_DB, {
        ...baseMission,
        adsbSnapshot: { schemaVersion: 1, pilot: "pilot@example.com" },
      }),
    ).rejects.toThrow("ADS-B snapshot is invalid");
  });

  it("batches bans, bounded events, retention, and append-only audit mutations", async () => {
    const { TEST_DB } = testEnvironment();
    await seedUser(TEST_DB);
    await expect(
      banUser(TEST_DB, {
        id: BAN_ID,
        userId: USER_ID,
        emailKey: digest("a"),
        scope: "temporary",
        reason: "Repeated abusive automation",
        actor: "access:admin-1",
        expiresAt: NOW + 10_000,
        createdAt: NOW + 1,
      }),
    ).resolves.toMatchObject({ id: BAN_ID, scope: "temporary" });
    await expect(getUserById(TEST_DB, USER_ID)).resolves.toMatchObject({
      status: "banned",
    });
    await expect(getActiveBansForUser(TEST_DB, USER_ID, NOW + 2)).resolves.toHaveLength(
      1,
    );
    await expect(
      getActiveBansForUser(TEST_DB, USER_ID, NOW + 10_000),
    ).resolves.toHaveLength(0);

    for (const [offset, id] of [
      [2, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      [3, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      [4, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
    ] as const) {
      await appendSystemEvent(TEST_DB, {
        id,
        level: "transition",
        category: "mode",
        eventKey: `mode-change-${offset}`,
        requestId: `request-${offset}`,
        context: {
          schemaVersion: 1,
          mode: "normal",
          email: offset === 4 ? "event-pilot@example.com" : undefined,
          token: offset === 4 ? "event-raw-token" : undefined,
        },
        tracePointer: offset === 4 ? "trace/event-4" : null,
        traceExpiresAt: offset === 4 ? NOW + 5 : null,
        createdAt: NOW + offset,
      });
    }
    await expect(clearExpiredEventTracePointers(TEST_DB, NOW + 6)).resolves.toBe(1);
    await expect(pruneSystemEvents(TEST_DB, NOW + 4, 1)).resolves.toBe(2);
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM system_events").first<number>(
        "count",
      ),
    ).resolves.toBe(1);
    const retainedContext = await TEST_DB.prepare(
      "SELECT context_json FROM system_events",
    ).first<string>("context_json");
    expect(retainedContext).not.toContain("event-pilot@example.com");
    expect(retainedContext).not.toContain("event-raw-token");

    await executeAuditedMutation(
      TEST_DB,
      TEST_DB.prepare("UPDATE users SET handle = ?, updated_at = ? WHERE id = ?").bind(
        "GroundPilot",
        NOW + 5,
        USER_ID,
      ),
      {
        id: AUDIT_ID,
        action: "user.handle.update",
        actor: "access:admin-1",
        targetType: "user",
        targetId: USER_ID,
        oldState: { schemaVersion: 1, handle: "SkyPilot" },
        newState: {
          schemaVersion: 1,
          handle: "GroundPilot",
          sessionToken: "audit-raw-session-token",
        },
        reason: "Owner-requested rename",
        requestId: "request-audit-1",
        createdAt: NOW + 5,
      },
    );
    await expect(getAdminAuditById(TEST_DB, AUDIT_ID)).resolves.toMatchObject({
      action: "user.handle.update",
    });
    const audit = await getAdminAuditById(TEST_DB, AUDIT_ID);
    expect(audit?.newStateJson).not.toContain("audit-raw-session-token");
    await expect(
      TEST_DB.prepare("DELETE FROM admin_audit WHERE id = ?")
        .bind(AUDIT_ID)
        .run(),
    ).rejects.toThrow();

    await expect(
      executeAuditedMutation(
        TEST_DB,
        TEST_DB.prepare("UPDATE users SET handle = '' WHERE id = ?").bind(USER_ID),
        {
          id: SECOND_AUDIT_ID,
          action: "user.handle.update",
          actor: "access:admin-1",
          targetType: "user",
          targetId: USER_ID,
          oldState: { schemaVersion: 1, handle: "GroundPilot" },
          newState: { schemaVersion: 1, handle: "" },
          reason: "Invalid rollback fixture",
          requestId: "request-audit-2",
          createdAt: NOW + 6,
        },
      ),
    ).rejects.toThrow();
    await expect(getAdminAuditById(TEST_DB, SECOND_AUDIT_ID)).resolves.toBeNull();
  });

  it("stores only digests rather than a raw normalized email", async () => {
    const { TEST_DB } = testEnvironment();
    const rawEmail = "pilot@example.com";
    await seedUser(TEST_DB);
    await createMagicLink(TEST_DB, {
      id: MAGIC_LINK_ID,
      tokenDigest: digest("b"),
      emailKey: digest("a"),
      expiresAt: NOW + 100,
      requestId: "request-raw-email-check",
      requestedAt: NOW,
    });

    const stored = await TEST_DB.prepare(
      `SELECT users.email_key AS user_email_key,
              magic_links.email_key AS link_email_key,
              magic_links.token_digest
         FROM users JOIN magic_links ON users.email_key = magic_links.email_key`,
    ).first<Record<string, unknown>>();
    expect(JSON.stringify(stored)).not.toContain(rawEmail);
    expect(JSON.stringify(stored)).toContain(digest("a"));

    let validationError = "";
    try {
      await banUser(TEST_DB, {
        id: BAN_ID,
        userId: USER_ID,
        emailKey: digest("a"),
        scope: "permanent",
        reason: `Account ${rawEmail} requested deletion`,
        actor: "access:admin-1",
        expiresAt: null,
        createdAt: NOW + 1,
      });
    } catch (caught) {
      validationError = String(caught);
    }
    expect(validationError).not.toContain(rawEmail);
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM user_bans").first<number>(
        "count",
      ),
    ).resolves.toBe(0);
  });
});
