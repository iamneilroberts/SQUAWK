import { hashOpaqueToken } from "../crypto";

const DIGEST = /^[0-9a-f]{64}$/;
export const CSRF_HEADER_NAME = "x-csrf-token";

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

export async function verifyCsrfToken(
  token: string | null,
  storedDigest: string | null,
): Promise<boolean> {
  if (token === null || storedDigest === null || !DIGEST.test(storedDigest)) return false;
  try {
    return constantTimeEqual(await hashOpaqueToken(token), storedDigest);
  } catch {
    return false;
  }
}
