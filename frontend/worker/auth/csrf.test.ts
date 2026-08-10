import { describe, expect, it } from "vitest";

import { hashOpaqueToken } from "../crypto";
import { verifyCsrfToken } from "./csrf";

describe("session-bound CSRF", () => {
  it("accepts only the raw token matching the stored digest", async () => {
    const token = "c".repeat(43);
    const digest = await hashOpaqueToken(token);

    await expect(verifyCsrfToken(token, digest)).resolves.toBe(true);
    await expect(verifyCsrfToken("d".repeat(43), digest)).resolves.toBe(false);
    await expect(verifyCsrfToken(null, digest)).resolves.toBe(false);
    await expect(verifyCsrfToken(token, null)).resolves.toBe(false);
  });
});
