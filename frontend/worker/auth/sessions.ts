import { hashSessionToken } from "../crypto";
import { hasActiveBanForIdentity } from "../db/bans";
import { getActiveSessionByDigest, touchSessionLastSeen } from "../db/sessions";
import { getUserById } from "../db/users";
import type { RequestActor } from "../telemetry/requestContext";

export const SESSION_COOKIE_NAME = "__Host-adsb_session";

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function assertOpaqueToken(token: string): void {
  if (!OPAQUE_TOKEN.test(token)) throw new TypeError("Opaque token is invalid");
}

export function encodeOpaqueToken(bytes: Uint8Array): string {
  if (bytes.byteLength !== 32) throw new TypeError("Opaque tokens require 256 bits");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function generateOpaqueToken(): string {
  return encodeOpaqueToken(crypto.getRandomValues(new Uint8Array(32)));
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  assertOpaqueToken(token);
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1) {
    throw new TypeError("Session cookie max age is invalid");
  }
  return `${SESSION_COOKIE_NAME}=${token}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readSessionCookie(cookieHeader: string | null): string | null {
  if (cookieHeader === null) return null;
  const values = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`))
    .map((part) => part.slice(SESSION_COOKIE_NAME.length + 1));
  if (values.length !== 1) return null;
  return OPAQUE_TOKEN.test(values[0] ?? "") ? values[0] ?? null : null;
}

export async function authorizeSession(
  request: Request,
  db: D1Database,
  now: number,
  anonymousActor: RequestActor,
  onBlockedUser?: (userId: string) => Promise<void>,
): Promise<RequestActor> {
  const rawToken = readSessionCookie(request.headers.get("cookie"));
  if (rawToken === null) return anonymousActor;

  const session = await getActiveSessionByDigest(
    db,
    await hashSessionToken(rawToken),
    now,
  );
  if (session === null) return anonymousActor;
  const user = await getUserById(db, session.userId);
  if (
    user === null ||
    user.status === "disabled" ||
    (await hasActiveBanForIdentity(db, user.id, user.emailKey, now))
  ) {
    if (user !== null && onBlockedUser !== undefined) {
      await onBlockedUser(user.id).catch(() => undefined);
    }
    return anonymousActor;
  }
  await touchSessionLastSeen(db, session.id, now).catch(() => undefined);
  return {
    kind: "authenticated",
    userId: user.id,
    sessionId: session.id,
    samplingKey: `user:${user.id}`,
  };
}
