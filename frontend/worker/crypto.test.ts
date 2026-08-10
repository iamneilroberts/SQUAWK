import { describe, expect, it, vi } from "vitest";

import {
  deriveEmailKey,
  hashOpaqueToken,
  hashSessionToken,
  normalizeEmail,
} from "./crypto";

const HMAC_SECRET = "test-only-email-key-secret-with-at-least-32-bytes";

describe("identity crypto", () => {
  it("normalizes case and surrounding whitespace before deriving an email key", async () => {
    expect(normalizeEmail("  Pilot@Example.COM\t")).toBe("pilot@example.com");
    await expect(deriveEmailKey("Pilot@Example.COM", HMAC_SECRET)).resolves.toBe(
      await deriveEmailKey("  pilot@example.com ", HMAC_SECRET),
    );
    await expect(deriveEmailKey("other@example.com", HMAC_SECRET)).resolves.not.toBe(
      await deriveEmailKey("pilot@example.com", HMAC_SECRET),
    );
  });

  it("hashes opaque magic-link and session tokens without retaining their raw value", async () => {
    const token = "raw-test-token-that-is-at-least-thirty-two-characters-long";
    const tokenHash = await hashOpaqueToken(token);
    const sessionHash = await hashSessionToken(token);

    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionHash).toBe(tokenHash);
    expect(tokenHash).not.toContain(token);
  });

  it("never writes or echoes raw identity material on validation failures", async () => {
    const rawEmail = "pilot@example.com raw-secret-suffix";
    const rawToken = "short-raw-token";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let emailError = "";
    let tokenError = "";
    try {
      await deriveEmailKey(rawEmail, HMAC_SECRET);
    } catch (caught) {
      emailError = String(caught);
    }
    try {
      await hashOpaqueToken(rawToken);
    } catch (caught) {
      tokenError = String(caught);
    }

    expect(emailError).not.toContain(rawEmail);
    expect(tokenError).not.toContain(rawToken);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});
