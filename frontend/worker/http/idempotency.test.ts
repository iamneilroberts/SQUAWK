import { describe, expect, it } from "vitest";

import { readIdempotencyKey } from "./idempotency";

describe("idempotency keys", () => {
  it("accepts bounded opaque keys and rejects missing or unsafe values", () => {
    expect(readIdempotencyKey(new Headers({ "idempotency-key": "mission.abc-123" }))).toBe(
      "mission.abc-123",
    );
    expect(() => readIdempotencyKey(new Headers())).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_KEY_REQUIRED" }),
    );
    expect(() =>
      readIdempotencyKey(new Headers({ "idempotency-key": "short" })),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_INVALID" }));
    expect(() =>
      readIdempotencyKey(
        new Headers({ "idempotency-key": `validprefix-${"x".repeat(128)}` }),
      ),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_KEY_INVALID" }));
  });
});
