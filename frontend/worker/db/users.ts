import {
  changed,
  requireDigest,
  requireFiniteNumber,
  requireInteger,
  requireOneOf,
  requireStored,
  requireText,
  requireTimestamp,
  requireUuid,
} from "./client";
import type {
  AssistLevel,
  CreateMagicLinkInput,
  CreateUserInput,
  MagicLink,
  TutorialState,
  User,
  UserPreferences,
  UserStatus,
} from "./types";

const USER_STATUSES: readonly UserStatus[] = ["active", "disabled", "banned"];
const ASSIST_LEVELS: readonly AssistLevel[] = ["none", "low", "medium", "high"];
const TUTORIAL_STATES: readonly TutorialState[] = [
  "new",
  "started",
  "complete",
  "dismissed",
];
const HANDLE = /^[A-Za-z][A-Za-z0-9_-]{2,31}$/;

type UserRow = {
  id: string;
  email_key: string;
  handle: string;
  status: UserStatus;
  created_at: number;
  updated_at: number;
};

type PreferencesRow = {
  user_id: string;
  center_lat: number;
  center_lon: number;
  region_key: string;
  default_assist: AssistLevel;
  tutorial_state: TutorialState;
  coaching_enabled: number;
  updated_at: number;
};

export type UpdateUserProfileInput = {
  userId: string;
  sessionId: string;
  handle: string;
  centerLat: number;
  centerLon: number;
  regionKey: string;
  defaultAssist: AssistLevel;
  tutorialState: TutorialState;
  coachingEnabled: boolean;
  updatedAt: number;
};

type MagicLinkRow = {
  id: string;
  token_digest: string;
  email_key: string;
  expires_at: number;
  consumed_at: number | null;
  request_id: string;
  requested_at: number;
};

const SELECT_USER = `SELECT id, email_key, handle, status, created_at, updated_at
                       FROM users`;
const SELECT_MAGIC_LINK = `SELECT id, token_digest, email_key, expires_at,
                                  consumed_at, request_id, requested_at
                             FROM magic_links`;

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    emailKey: row.email_key,
    handle: row.handle,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPreferences(row: PreferencesRow): UserPreferences {
  return {
    userId: row.user_id,
    centerLat: row.center_lat,
    centerLon: row.center_lon,
    regionKey: row.region_key,
    defaultAssist: row.default_assist,
    tutorialState: row.tutorial_state,
    coachingEnabled: row.coaching_enabled === 1,
    updatedAt: row.updated_at,
  };
}

function mapMagicLink(row: MagicLinkRow): MagicLink {
  return {
    id: row.id,
    tokenDigest: row.token_digest,
    emailKey: row.email_key,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    requestId: row.request_id,
    requestedAt: row.requested_at,
  };
}

export async function createUser(
  db: D1Database,
  input: CreateUserInput,
): Promise<User> {
  const id = requireUuid("user id", input.id);
  const emailKey = requireDigest("email key", input.emailKey);
  const handle = requireText("handle", input.handle, 3, 32, HANDLE);
  const status = requireOneOf(
    "user status",
    input.status ?? "active",
    USER_STATUSES,
  );
  const createdAt = requireTimestamp("created at", input.createdAt);
  const updatedAt = requireTimestamp("updated at", input.updatedAt);
  if (updatedAt < createdAt) throw new RangeError("updated at precedes creation");

  await db
    .prepare(
      `INSERT INTO users
         (id, email_key, handle, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, emailKey, handle, status, createdAt, updatedAt)
    .run();

  return requireStored("user", await getUserById(db, id));
}

export async function getUserById(
  db: D1Database,
  id: string,
): Promise<User | null> {
  const row = await db
    .prepare(`${SELECT_USER} WHERE id = ?`)
    .bind(requireUuid("user id", id))
    .first<UserRow>();
  return row === null ? null : mapUser(row);
}

export async function getUserByEmailKey(
  db: D1Database,
  emailKey: string,
): Promise<User | null> {
  const row = await db
    .prepare(`${SELECT_USER} WHERE email_key = ?`)
    .bind(requireDigest("email key", emailKey))
    .first<UserRow>();
  return row === null ? null : mapUser(row);
}

export async function upsertUserPreferences(
  db: D1Database,
  preferences: UserPreferences,
): Promise<UserPreferences> {
  const userId = requireUuid("user id", preferences.userId);
  const centerLat = requireFiniteNumber("center latitude", preferences.centerLat, -90, 90);
  const centerLon = requireFiniteNumber(
    "center longitude",
    preferences.centerLon,
    -180,
    180,
  );
  const regionKey = requireText("region key", preferences.regionKey, 1, 96);
  const defaultAssist = requireOneOf(
    "default assist",
    preferences.defaultAssist,
    ASSIST_LEVELS,
  );
  const tutorialState = requireOneOf(
    "tutorial state",
    preferences.tutorialState,
    TUTORIAL_STATES,
  );
  const updatedAt = requireTimestamp("updated at", preferences.updatedAt);

  await db
    .prepare(
      `INSERT INTO user_preferences
         (user_id, center_lat, center_lon, region_key, default_assist,
          tutorial_state, coaching_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         center_lat = excluded.center_lat,
         center_lon = excluded.center_lon,
         region_key = excluded.region_key,
         default_assist = excluded.default_assist,
         tutorial_state = excluded.tutorial_state,
         coaching_enabled = excluded.coaching_enabled,
         updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      centerLat,
      centerLon,
      regionKey,
      defaultAssist,
      tutorialState,
      preferences.coachingEnabled ? 1 : 0,
      updatedAt,
    )
    .run();

  const row = await db
    .prepare(
      `SELECT user_id, center_lat, center_lon, region_key, default_assist,
              tutorial_state, coaching_enabled, updated_at
         FROM user_preferences WHERE user_id = ?`,
    )
    .bind(userId)
    .first<PreferencesRow>();
  return mapPreferences(requireStored("user preferences", row));
}

export async function getUserPreferences(
  db: D1Database,
  userId: string,
): Promise<UserPreferences | null> {
  const row = await db
    .prepare(
      `SELECT user_id, center_lat, center_lon, region_key, default_assist,
              tutorial_state, coaching_enabled, updated_at
         FROM user_preferences WHERE user_id = ?`,
    )
    .bind(requireUuid("user id", userId))
    .first<PreferencesRow>();
  return row === null ? null : mapPreferences(row);
}

export async function updateUserProfileForSession(
  db: D1Database,
  input: UpdateUserProfileInput,
): Promise<{ user: User; preferences: UserPreferences } | null> {
  const userId = requireUuid("user id", input.userId);
  const sessionId = requireUuid("session id", input.sessionId);
  const handle = requireText("handle", input.handle, 3, 32, HANDLE);
  const centerLat = requireFiniteNumber("center latitude", input.centerLat, -90, 90);
  const centerLon = requireFiniteNumber("center longitude", input.centerLon, -180, 180);
  const regionKey = requireText("region key", input.regionKey, 1, 96);
  const defaultAssist = requireOneOf("default assist", input.defaultAssist, ASSIST_LEVELS);
  const tutorialState = requireOneOf(
    "tutorial state",
    input.tutorialState,
    TUTORIAL_STATES,
  );
  const updatedAt = requireTimestamp("updated at", input.updatedAt);

  const results = await db.batch([
    db
      .prepare(
        `UPDATE users SET handle = ?, updated_at = MAX(updated_at, ?)
          WHERE id = ? AND status <> 'disabled'`,
      )
      .bind(handle, updatedAt, userId),
    db
      .prepare(
        `INSERT INTO user_preferences
           (user_id, center_lat, center_lon, region_key, default_assist,
            tutorial_state, coaching_enabled, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND status <> 'disabled')
         ON CONFLICT(user_id) DO UPDATE SET
           center_lat = excluded.center_lat,
           center_lon = excluded.center_lon,
           region_key = excluded.region_key,
           default_assist = excluded.default_assist,
           tutorial_state = excluded.tutorial_state,
           coaching_enabled = excluded.coaching_enabled,
           updated_at = excluded.updated_at`,
      )
      .bind(
        userId,
        centerLat,
        centerLon,
        regionKey,
        defaultAssist,
        tutorialState,
        input.coachingEnabled ? 1 : 0,
        updatedAt,
        userId,
      ),
    db
      .prepare(
        `UPDATE sessions
            SET last_seen_at = MAX(last_seen_at, ?)
          WHERE id = ? AND user_id = ?
            AND revoked_at IS NULL AND expires_at > ?`,
      )
      .bind(updatedAt, sessionId, userId, updatedAt),
  ]);
  if (results.some((result) => !changed(result))) return null;

  const [user, preferences] = await Promise.all([
    getUserById(db, userId),
    getUserPreferences(db, userId),
  ]);
  if (user === null || preferences === null) return null;
  return { user, preferences };
}

export async function createMagicLink(
  db: D1Database,
  input: CreateMagicLinkInput,
): Promise<MagicLink> {
  const id = requireUuid("magic link id", input.id);
  const tokenDigest = requireDigest("token digest", input.tokenDigest);
  const emailKey = requireDigest("email key", input.emailKey);
  const expiresAt = requireTimestamp("expires at", input.expiresAt);
  const requestId = requireText("request id", input.requestId, 8, 128);
  const requestedAt = requireTimestamp("requested at", input.requestedAt);
  if (expiresAt <= requestedAt) throw new RangeError("magic link expiry is invalid");
  const codeDigest =
    input.codeDigest === undefined || input.codeDigest === null
      ? null
      : requireDigest("code digest", input.codeDigest);

  await db
    .prepare(
      `INSERT INTO magic_links
         (id, token_digest, email_key, expires_at, consumed_at, request_id,
          requested_at, code_digest)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
    )
    .bind(id, tokenDigest, emailKey, expiresAt, requestId, requestedAt, codeDigest)
    .run();

  return {
    id,
    tokenDigest,
    emailKey,
    expiresAt,
    consumedAt: null,
    requestId,
    requestedAt,
  };
}

export async function deleteMagicLinkByDigest(
  db: D1Database,
  tokenDigest: string,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM magic_links WHERE token_digest = ? AND consumed_at IS NULL")
    .bind(requireDigest("token digest", tokenDigest))
    .run();
  return changed(result);
}

export async function consumeMagicLink(
  db: D1Database,
  tokenDigest: string,
  consumedAt: number,
): Promise<MagicLink | null> {
  const digest = requireDigest("token digest", tokenDigest);
  const timestamp = requireTimestamp("consumed at", consumedAt);
  const [update, selected] = await db.batch<MagicLinkRow>([
    db
      .prepare(
        `UPDATE magic_links
            SET consumed_at = ?
          WHERE token_digest = ?
            AND consumed_at IS NULL
            AND expires_at > ?`,
      )
      .bind(timestamp, digest, timestamp),
    db.prepare(`${SELECT_MAGIC_LINK} WHERE token_digest = ?`).bind(digest),
  ]);

  if (!changed(update)) return null;
  const row = selected.results[0] ?? null;
  return mapMagicLink(requireStored("consumed magic link", row));
}

export async function deleteExpiredMagicLinks(
  db: D1Database,
  before: number,
  limit = 500,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM magic_links
        WHERE id IN (
          SELECT id FROM magic_links
           WHERE expires_at <= ?
           ORDER BY expires_at
           LIMIT ?
        )`,
    )
    .bind(
      requireTimestamp("retention cutoff", before),
      requireInteger("retention limit", limit, 1, 5_000),
    )
    .run();
  return result.meta.changes;
}
