import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { reserveEmailRateLimit } from "./emailIdentity";

const NOW = 1_700_000_000_000;

type TestEnvironment = Cloudflare.Env & {
  TEST_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

beforeEach(async () => {
  const runtime = env as TestEnvironment;
  await reset();
  await applyD1Migrations(runtime.TEST_DB, runtime.TEST_MIGRATIONS);
});

describe("email-digest request limiting", () => {
  it("reserves three hourly attempts atomically and permits the exact window boundary", async () => {
    const { TEST_DB } = env as TestEnvironment;
    const emailKey = "a".repeat(64);
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];

    for (const [offset, id] of ids.entries()) {
      await expect(
        reserveEmailRateLimit(TEST_DB, {
          id,
          emailKey,
          requestedAt: NOW + offset,
          windowMs: 3_600_000,
          maximum: 3,
        }),
      ).resolves.toBe(true);
    }
    await expect(
      reserveEmailRateLimit(TEST_DB, {
        id: "44444444-4444-4444-8444-444444444444",
        emailKey,
        requestedAt: NOW + 3,
        windowMs: 3_600_000,
        maximum: 3,
      }),
    ).resolves.toBe(false);
    await expect(
      reserveEmailRateLimit(TEST_DB, {
        id: "55555555-5555-4555-8555-555555555555",
        emailKey,
        requestedAt: NOW + 3_600_000,
        windowMs: 3_600_000,
        maximum: 3,
      }),
    ).resolves.toBe(true);
  });
});
