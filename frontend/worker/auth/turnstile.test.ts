import { describe, expect, it, vi } from "vitest";

import { verifyTurnstile } from "./turnstile";

const SECRET = "turnstile-secret";
const RESPONSE = "challenge-response";

describe("Turnstile verification", () => {
  it("accepts only a successful response for the expected action and hostname", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        secret: SECRET,
        response: RESPONSE,
        remoteip: "203.0.113.4",
        idempotency_key: "00000000-0000-4000-8000-000000000001",
      });
      return Response.json({
        success: true,
        action: "magic-link",
        hostname: "squawk.example",
      });
    });

    await expect(
      verifyTurnstile({
        secret: SECRET,
        response: RESPONSE,
        remoteIp: "203.0.113.4",
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        expectedAction: "magic-link",
        expectedHostname: "squawk.example",
        fetcher,
      }),
    ).resolves.toBe(true);
  });

  it.each([
    { success: false, action: "magic-link", hostname: "squawk.example" },
    { success: true, action: "wrong-action", hostname: "squawk.example" },
    { success: true, action: "magic-link", hostname: "evil.example" },
  ])("fails closed for an invalid verification result", async (payload) => {
    await expect(
      verifyTurnstile({
        secret: SECRET,
        response: RESPONSE,
        remoteIp: null,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        expectedAction: "magic-link",
        expectedHostname: "squawk.example",
        fetcher: async () => Response.json(payload),
      }),
    ).resolves.toBe(false);
  });

  it("fails closed without echoing a challenge when verification is unavailable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      verifyTurnstile({
        secret: SECRET,
        response: RESPONSE,
        remoteIp: null,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        expectedAction: "magic-link",
        expectedHostname: "squawk.example",
        fetcher: async () => {
          throw new Error(`must not escape: ${RESPONSE}`);
        },
      }),
    ).resolves.toBe(false);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
