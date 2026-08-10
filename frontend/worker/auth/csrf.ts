const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CSRF_SECRET_MINIMUM_LENGTH = 32;
const CSRF_SECRET_MAXIMUM_LENGTH = 4_096;
const CSRF_CONTEXT = "adsb-game:csrf:v1:";
const CSRF_TOKEN = /^[0-9a-f]{64}$/;
export const CSRF_HEADER_NAME = "x-csrf-token";

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function readCsrfToken(request: Request): string | null {
  const values = request.headers.get(CSRF_HEADER_NAME);
  return values === null || values.includes(",") ? null : values;
}

export async function deriveCsrfToken(
  sessionId: string,
  hmacSecret: string,
): Promise<string> {
  if (!UUID.test(sessionId)) throw new TypeError("CSRF session ID is invalid");
  if (
    typeof hmacSecret !== "string" ||
    hmacSecret.length < CSRF_SECRET_MINIMUM_LENGTH ||
    hmacSecret.length > CSRF_SECRET_MAXIMUM_LENGTH
  ) {
    throw new TypeError("CSRF secret is invalid");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(hmacSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      bytes(`${CSRF_CONTEXT}${sessionId.toLowerCase()}`),
    ),
  );
}

export async function verifyCsrfToken(
  token: string | null,
  sessionId: string | null,
  hmacSecret: string,
): Promise<boolean> {
  if (token === null || !CSRF_TOKEN.test(token) || sessionId === null) return false;
  try {
    return constantTimeEqual(token, await deriveCsrfToken(sessionId, hmacSecret));
  } catch {
    return false;
  }
}
