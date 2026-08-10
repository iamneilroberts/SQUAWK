const EMAIL_MAX_LENGTH = 254;
const TOKEN_MAX_LENGTH = 4_096;
const NORMALIZED_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class IdentityCryptoError extends Error {
  override readonly name = "IdentityCryptoError";
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeEmail(email: string): string {
  const normalized = email.trim().normalize("NFKC").toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > EMAIL_MAX_LENGTH ||
    !NORMALIZED_EMAIL.test(normalized)
  ) {
    throw new IdentityCryptoError("Email address is invalid");
  }
  return normalized;
}

export async function deriveEmailKey(
  email: string,
  hmacSecret: string,
): Promise<string> {
  if (hmacSecret.length < 32) {
    throw new IdentityCryptoError("Email-key secret is invalid");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(hmacSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign("HMAC", key, bytes(normalizeEmail(email))),
  );
}

export async function hashOpaqueToken(token: string): Promise<string> {
  if (token.length < 32 || token.length > TOKEN_MAX_LENGTH) {
    throw new IdentityCryptoError("Opaque token is invalid");
  }
  return hex(await crypto.subtle.digest("SHA-256", bytes(token)));
}

export const hashSessionToken = hashOpaqueToken;
