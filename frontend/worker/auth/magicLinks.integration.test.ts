import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { codeDigest } from "../crypto";
import { banUser } from "../db/bans";
import { createSession, getActiveSessionByDigest } from "../db/sessions";
import { createMagicLink, createUser } from "../db/users";
import { consumeAuthCodeSession, consumeMagicLinkSession } from "./magicLinks";

const NOW = 1_700_000_000_000;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OLD_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const LINK_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_A_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_B_ID = "55555555-5555-4555-8555-555555555555";
const NONCE_A = "66666666-6666-4666-8666-666666666666";
const NONCE_B = "77777777-7777-4777-8777-777777777777";

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

function consumeInput(
  sessionId = SESSION_A_ID,
  consumeNonce = NONCE_A,
) {
  return {
    tokenDigest: digest("b"),
    consumedAt: NOW + 1,
    consumeNonce,
    userId: USER_ID,
    handle: "Pilot_11111111",
    centerLat: 30.69,
    centerLon: -88.04,
    regionKey: "region:30.5:-88",
    sessionId,
    sessionDigest: sessionId === SESSION_A_ID ? digest("c") : digest("d"),
    csrfDigest: sessionId === SESSION_A_ID ? digest("e") : digest("f"),
    sessionExpiresAt: NOW + 2_592_000_000,
    deviceLabel: null,
  };
}

beforeEach(async () => {
  const { TEST_DB, TEST_MIGRATIONS } = testEnvironment();
  await reset();
  await applyD1Migrations(TEST_DB, TEST_MIGRATIONS);
});

describe("atomic magic-link session exchange", () => {
  it("allows exactly one concurrent consume, creates defaults, and stores no raw identity", async () => {
    const { TEST_DB } = testEnvironment();
    await createMagicLink(TEST_DB, {
      id: LINK_ID,
      tokenDigest: digest("b"),
      emailKey: digest("a"),
      expiresAt: NOW + 60_000,
      requestId: "request-concurrent",
      requestedAt: NOW,
    });

    const outcomes = await Promise.all([
      consumeMagicLinkSession(TEST_DB, consumeInput()),
      consumeMagicLinkSession(TEST_DB, consumeInput(SESSION_B_ID, NONCE_B)),
    ]);

    expect(outcomes.filter((value) => value !== null)).toHaveLength(1);
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM sessions").first<number>("count"),
    ).resolves.toBe(1);
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM users").first<number>("count"),
    ).resolves.toBe(1);
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM user_preferences").first<number>("count"),
    ).resolves.toBe(1);

    const stored = JSON.stringify(
      await TEST_DB.prepare(
        "SELECT email_key, token_digest, consume_nonce FROM magic_links",
      ).all(),
    );
    expect(stored).not.toContain("@");
    expect(stored).not.toContain("auth_token");
  });

  it("rejects replay and the exact expiry boundary", async () => {
    const { TEST_DB } = testEnvironment();
    await createMagicLink(TEST_DB, {
      id: LINK_ID,
      tokenDigest: digest("b"),
      emailKey: digest("a"),
      expiresAt: NOW + 1,
      requestId: "request-expiry",
      requestedAt: NOW,
    });

    await expect(
      consumeMagicLinkSession(TEST_DB, consumeInput()),
    ).resolves.toBeNull();

    await TEST_DB.prepare("UPDATE magic_links SET expires_at = ? WHERE id = ?")
      .bind(NOW + 60_000, LINK_ID)
      .run();
    await expect(
      consumeMagicLinkSession(TEST_DB, consumeInput()),
    ).resolves.toMatchObject({ id: SESSION_A_ID, csrfDigest: digest("e") });
    await expect(
      consumeMagicLinkSession(TEST_DB, consumeInput(SESSION_B_ID, NONCE_B)),
    ).resolves.toBeNull();
  });

  it("revokes a prior session when the link creates a replacement", async () => {
    const { TEST_DB } = testEnvironment();
    await createUser(TEST_DB, {
      id: USER_ID,
      emailKey: digest("a"),
      handle: "ExistingPilot",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await createSession(TEST_DB, {
      id: OLD_SESSION_ID,
      userId: USER_ID,
      sessionDigest: digest("9"),
      csrfDigest: digest("8"),
      expiresAt: NOW + 60_000,
      lastSeenAt: NOW,
      deviceLabel: null,
      rotatedFromId: null,
      createdAt: NOW,
    });
    await createMagicLink(TEST_DB, {
      id: LINK_ID,
      tokenDigest: digest("b"),
      emailKey: digest("a"),
      expiresAt: NOW + 60_000,
      requestId: "request-rotation",
      requestedAt: NOW,
    });

    await expect(
      consumeMagicLinkSession(TEST_DB, consumeInput()),
    ).resolves.toMatchObject({ id: SESSION_A_ID, userId: USER_ID });
    await expect(
      getActiveSessionByDigest(TEST_DB, digest("9"), NOW + 2),
    ).resolves.toBeNull();
  });

  it("burns a link without creating a user or session for an active email ban", async () => {
    const { TEST_DB } = testEnvironment();
    await banUser(TEST_DB, {
      id: "88888888-8888-4888-8888-888888888888",
      userId: null,
      emailKey: digest("a"),
      scope: "temporary",
      reason: "Active identity ban",
      actor: "access:admin",
      expiresAt: NOW + 60_000,
      createdAt: NOW,
    });
    await createMagicLink(TEST_DB, {
      id: LINK_ID,
      tokenDigest: digest("b"),
      emailKey: digest("a"),
      expiresAt: NOW + 60_000,
      requestId: "request-banned",
      requestedAt: NOW,
    });

    await expect(
      consumeMagicLinkSession(TEST_DB, consumeInput()),
    ).resolves.toBeNull();
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM sessions").first<number>("count"),
    ).resolves.toBe(0);
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM users").first<number>("count"),
    ).resolves.toBe(0);
    await expect(
      TEST_DB.prepare("SELECT consumed_at FROM magic_links WHERE id = ?")
        .bind(LINK_ID)
        .first<number>("consumed_at"),
    ).resolves.toBe(NOW + 1);
  });

  it("allows sign-in after the exact temporary-ban expiry despite denormalized user status", async () => {
    const { TEST_DB } = testEnvironment();
    await createUser(TEST_DB, {
      id: USER_ID,
      emailKey: digest("a"),
      handle: "ReturningPilot",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await banUser(TEST_DB, {
      id: "99999999-9999-4999-8999-999999999999",
      userId: USER_ID,
      emailKey: null,
      scope: "temporary",
      reason: "Short test ban",
      actor: "access:admin",
      expiresAt: NOW + 1,
      createdAt: NOW,
    });
    await createMagicLink(TEST_DB, {
      id: LINK_ID,
      tokenDigest: digest("b"),
      emailKey: digest("a"),
      expiresAt: NOW + 60_000,
      requestId: "request-expired-ban",
      requestedAt: NOW,
    });

    await expect(
      consumeMagicLinkSession(TEST_DB, consumeInput()),
    ).resolves.toMatchObject({ id: SESSION_A_ID, userId: USER_ID });
  });
});

const CODE = "012345";
const WRONG_CODE = "999999";
const EMAIL_A = digest("a");
const EMAIL_B = "2".repeat(64);

type CodeInput = {
  emailKey: string;
  code: string;
  now: number;
  consumeNonce: string;
  userId: string;
  handle: string;
  centerLat: number;
  centerLon: number;
  regionKey: string;
  sessionId: string;
  sessionDigest: string;
  csrfDigest: string;
  sessionExpiresAt: number;
  deviceLabel: string | null;
};

function codeInput(overrides: Partial<CodeInput> = {}): CodeInput {
  return {
    emailKey: EMAIL_A,
    code: CODE,
    now: NOW + 1,
    consumeNonce: NONCE_A,
    userId: USER_ID,
    handle: "Pilot_11111111",
    centerLat: 30.69,
    centerLon: -88.04,
    regionKey: "region:30.5:-88",
    sessionId: SESSION_A_ID,
    sessionDigest: digest("c"),
    csrfDigest: digest("e"),
    sessionExpiresAt: NOW + 2_592_000_000,
    deviceLabel: null,
    ...overrides,
  };
}

async function createCodeLink(
  db: D1Database,
  options: {
    email?: string;
    code?: string | null;
    expiresAt?: number;
    tokenDigest?: string;
  } = {},
): Promise<void> {
  const email = options.email ?? EMAIL_A;
  const code = options.code === undefined ? CODE : options.code;
  await createMagicLink(db, {
    id: LINK_ID,
    tokenDigest: options.tokenDigest ?? digest("b"),
    emailKey: email,
    expiresAt: options.expiresAt ?? NOW + 60_000,
    requestId: "request-code",
    requestedAt: NOW,
    codeDigest: code === null ? null : await codeDigest(email, code),
  });
}

describe("atomic auth-code session exchange", () => {
  it("issues a session for the right code and revokes the prior one", async () => {
    const { TEST_DB } = testEnvironment();
    await createUser(TEST_DB, {
      id: USER_ID,
      emailKey: EMAIL_A,
      handle: "ExistingPilot",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await createSession(TEST_DB, {
      id: OLD_SESSION_ID,
      userId: USER_ID,
      sessionDigest: digest("9"),
      csrfDigest: digest("8"),
      expiresAt: NOW + 60_000,
      lastSeenAt: NOW,
      deviceLabel: null,
      rotatedFromId: null,
      createdAt: NOW,
    });
    await createCodeLink(TEST_DB);

    await expect(
      consumeAuthCodeSession(TEST_DB, codeInput()),
    ).resolves.toMatchObject({ id: SESSION_A_ID, userId: USER_ID });
    await expect(
      getActiveSessionByDigest(TEST_DB, digest("9"), NOW + 2),
    ).resolves.toBeNull();
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL")
        .first<number>("count"),
    ).resolves.toBe(1);
  });

  it("burns the row after five wrong attempts, defeating a later correct code", async () => {
    const { TEST_DB } = testEnvironment();
    await createCodeLink(TEST_DB);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        consumeAuthCodeSession(TEST_DB, codeInput({ code: WRONG_CODE })),
      ).resolves.toBeNull();
    }
    await expect(
      TEST_DB.prepare("SELECT code_attempts FROM magic_links WHERE id = ?")
        .bind(LINK_ID)
        .first<number>("code_attempts"),
    ).resolves.toBe(5);

    await expect(
      consumeAuthCodeSession(TEST_DB, codeInput()),
    ).resolves.toBeNull();
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM sessions").first<number>("count"),
    ).resolves.toBe(0);
  });

  it("returns null for an expired row at the exact boundary", async () => {
    const { TEST_DB } = testEnvironment();
    await createCodeLink(TEST_DB, { expiresAt: NOW + 1 });

    await expect(
      consumeAuthCodeSession(TEST_DB, codeInput({ now: NOW + 1 })),
    ).resolves.toBeNull();
  });

  it("never matches a legacy row whose code_digest is NULL", async () => {
    const { TEST_DB } = testEnvironment();
    await createCodeLink(TEST_DB, { code: null });

    await expect(
      consumeAuthCodeSession(TEST_DB, codeInput()),
    ).resolves.toBeNull();
  });

  it("is salted: a row for email A cannot be consumed with email B and the same code", async () => {
    const { TEST_DB } = testEnvironment();
    await createCodeLink(TEST_DB, { email: EMAIL_A });

    await expect(
      consumeAuthCodeSession(TEST_DB, codeInput({ emailKey: EMAIL_B })),
    ).resolves.toBeNull();
  });

  it("shares one-use with the link path: consuming by LINK kills the code", async () => {
    const { TEST_DB } = testEnvironment();
    await createCodeLink(TEST_DB);

    await expect(
      consumeMagicLinkSession(TEST_DB, consumeInput()),
    ).resolves.toMatchObject({ id: SESSION_A_ID });
    await expect(
      consumeAuthCodeSession(
        TEST_DB,
        codeInput({
          consumeNonce: NONCE_B,
          sessionId: SESSION_B_ID,
          sessionDigest: digest("d"),
          csrfDigest: digest("f"),
        }),
      ),
    ).resolves.toBeNull();
  });

  it("shares one-use with the link path: consuming by CODE kills the link", async () => {
    const { TEST_DB } = testEnvironment();
    await createCodeLink(TEST_DB);

    await expect(
      consumeAuthCodeSession(TEST_DB, codeInput()),
    ).resolves.toMatchObject({ id: SESSION_A_ID });
    await expect(
      consumeMagicLinkSession(TEST_DB, consumeInput(SESSION_B_ID, NONCE_B)),
    ).resolves.toBeNull();
  });

  it("allows exactly one winner for a concurrent double-verify", async () => {
    const { TEST_DB } = testEnvironment();
    await createCodeLink(TEST_DB);

    const outcomes = await Promise.all([
      consumeAuthCodeSession(TEST_DB, codeInput()),
      consumeAuthCodeSession(
        TEST_DB,
        codeInput({
          consumeNonce: NONCE_B,
          sessionId: SESSION_B_ID,
          sessionDigest: digest("d"),
          csrfDigest: digest("f"),
        }),
      ),
    ]);

    expect(outcomes.filter((value) => value !== null)).toHaveLength(1);
    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM sessions").first<number>("count"),
    ).resolves.toBe(1);
  });
});
