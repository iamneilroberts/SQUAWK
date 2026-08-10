import { describe, expect, it } from "vitest";

import { deriveCsrfToken, verifyCsrfToken } from "./csrf";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const SECRET_A = "test-only-csrf-secret-a-with-at-least-32-bytes";
const SECRET_B = "test-only-csrf-secret-b-with-at-least-32-bytes";

describe("session-bound CSRF", () => {
  it("derives one stable token per session and changes it for a replacement session", async () => {
    const first = await deriveCsrfToken(SESSION_A, SECRET_A);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    await expect(deriveCsrfToken(SESSION_A, SECRET_A)).resolves.toBe(first);
    await expect(deriveCsrfToken(SESSION_A.toUpperCase(), SECRET_A)).resolves.toBe(first);
    await expect(deriveCsrfToken(SESSION_B, SECRET_A)).resolves.not.toBe(first);
    await expect(deriveCsrfToken(SESSION_A, SECRET_B)).resolves.not.toBe(first);
  });

  it("accepts only the token bound to the authenticated session and configured secret", async () => {
    const token = await deriveCsrfToken(SESSION_A, SECRET_A);

    await expect(verifyCsrfToken(token, SESSION_A, SECRET_A)).resolves.toBe(true);
    await expect(verifyCsrfToken(token, SESSION_B, SECRET_A)).resolves.toBe(false);
    await expect(verifyCsrfToken(token, SESSION_A, SECRET_B)).resolves.toBe(false);
    await expect(verifyCsrfToken("d".repeat(64), SESSION_A, SECRET_A)).resolves.toBe(false);
    await expect(verifyCsrfToken(null, SESSION_A, SECRET_A)).resolves.toBe(false);
    await expect(verifyCsrfToken(token, null, SECRET_A)).resolves.toBe(false);
  });

  it("fails closed for malformed session IDs and secrets", async () => {
    await expect(deriveCsrfToken("not-a-session", SECRET_A)).rejects.toThrow(
      "CSRF session ID is invalid",
    );
    await expect(deriveCsrfToken(SESSION_A, "too-short")).rejects.toThrow(
      "CSRF secret is invalid",
    );
  });
});
