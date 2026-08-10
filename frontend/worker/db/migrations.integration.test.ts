import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const EXPECTED_TABLES = [
  "admin_audit",
  "auth_email_rate_events",
  "flight_results",
  "magic_links",
  "missions",
  "sessions",
  "system_events",
  "user_bans",
  "user_preferences",
  "users",
] as const;

type TestEnvironment = Cloudflare.Env & {
  TEST_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

function testEnvironment(): TestEnvironment {
  return env as TestEnvironment;
}

beforeEach(async () => {
  await reset();
});

describe("D1 migrations", () => {
  it("creates every approved logical table in an isolated local database", async () => {
    const { TEST_DB, TEST_MIGRATIONS } = testEnvironment();

    await applyD1Migrations(TEST_DB, TEST_MIGRATIONS);

    const tables = await TEST_DB.prepare(
      `SELECT name
         FROM sqlite_schema
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE '_cf_%'
          AND name != 'd1_migrations'
        ORDER BY name`,
    ).all<{ name: string }>();

    expect(tables.results.map(({ name }) => name)).toEqual(EXPECTED_TABLES);
    for (const table of EXPECTED_TABLES) {
      await expect(
        TEST_DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<number>(
          "count",
        ),
      ).resolves.toBe(0);
    }
  });

  it("applies every migration once and treats a second pass as a no-op", async () => {
    const { TEST_DB, TEST_MIGRATIONS } = testEnvironment();

    await applyD1Migrations(TEST_DB, TEST_MIGRATIONS);
    await applyD1Migrations(TEST_DB, TEST_MIGRATIONS);

    await expect(
      TEST_DB.prepare("SELECT COUNT(*) AS count FROM d1_migrations").first<number>(
        "count",
      ),
    ).resolves.toBe(TEST_MIGRATIONS.length);
  });

  it("rolls back an invalid next migration without recording or leaking its schema", async () => {
    const { TEST_DB, TEST_MIGRATIONS } = testEnvironment();
    const invalidMigration: D1Migration = {
      name: "0002_invalid_rollback_fixture.sql",
      queries: [
        "CREATE TABLE rollback_probe (id TEXT PRIMARY KEY)",
        "INSERT INTO table_that_does_not_exist (id) VALUES ('fail')",
      ],
    };

    await applyD1Migrations(TEST_DB, TEST_MIGRATIONS);
    await expect(
      applyD1Migrations(TEST_DB, [...TEST_MIGRATIONS, invalidMigration]),
    ).rejects.toThrow();

    await expect(
      TEST_DB.prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?",
      )
        .bind("rollback_probe")
        .first("name"),
    ).resolves.toBeNull();
    await expect(
      TEST_DB.prepare("SELECT name FROM d1_migrations WHERE name = ?")
        .bind(invalidMigration.name)
        .first("name"),
    ).resolves.toBeNull();
  });
});
