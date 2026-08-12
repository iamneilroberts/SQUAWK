import { describe, expect, it } from "vitest";

import { codeDigest, constantTimeEqual } from "../crypto";
import { generateSignInCode } from "./sessions";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("generateSignInCode", () => {
  it("always returns six decimal digits, leading zeros allowed", () => {
    for (let index = 0; index < 2000; index += 1) {
      expect(generateSignInCode()).toMatch(/^\d{6}$/);
    }
  });

  it("produces varied codes across the space (rejection-sampled, unbiased)", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 500; index += 1) seen.add(generateSignInCode());
    expect(seen.size).toBeGreaterThan(100);
  });
});

describe("codeDigest", () => {
  it("is the sha256 hex of `${emailKey}:${code}` (email_key salt)", async () => {
    const emailKey = "a".repeat(64);
    const code = "012345";
    await expect(codeDigest(emailKey, code)).resolves.toBe(
      await sha256Hex(`${emailKey}:${code}`),
    );
  });

  it("differs when the salt (email_key) differs for the same code", async () => {
    const code = "012345";
    const a = await codeDigest("a".repeat(64), code);
    const b = await codeDigest("2".repeat(64), code);
    expect(a).not.toBe(b);
  });

  it("differs when the code differs for the same salt", async () => {
    const emailKey = "a".repeat(64);
    expect(await codeDigest(emailKey, "012345")).not.toBe(
      await codeDigest(emailKey, "012346"),
    );
  });
});

describe("constantTimeEqual", () => {
  it("matches equal digests and rejects any difference", () => {
    expect(constantTimeEqual("a".repeat(64), "a".repeat(64))).toBe(true);
    expect(constantTimeEqual("a".repeat(64), "b".repeat(64))).toBe(false);
    expect(constantTimeEqual("a".repeat(63), "a".repeat(64))).toBe(false);
  });
});
