import { describe, expect, it } from "vitest";

import { AuthClientError } from "./session";
import { CODE_ENTRY_ERROR_COPY, codeEntryErrorState } from "./SignInSheet";

// Pure state-logic pin (no RTL/jsdom harness exists in this repo — see docs/decisions.md
// 2026-08-12 #40 Task 3). A 429 from verifyAuthCode (IP rate limiter tripped) must render
// distinct copy from a 401 (wrong/expired code): a rate-limited user who then types the
// CORRECT code must see a reason to wait, not "invalid", or they retry forever.
describe("codeEntryErrorState", () => {
  it("maps a RATE_LIMITED AuthClientError to the rate-limited state", () => {
    const error = new AuthClientError(429, "RATE_LIMITED");
    expect(codeEntryErrorState(error)).toBe("code-rate-limited");
  });

  it("maps an AUTH_CODE_INVALID AuthClientError to the code-error state", () => {
    const error = new AuthClientError(401, "AUTH_CODE_INVALID");
    expect(codeEntryErrorState(error)).toBe("code-error");
  });

  it("maps any other error (network failure, non-AuthClientError) to code-error", () => {
    expect(codeEntryErrorState(new TypeError("boom"))).toBe("code-error");
    expect(codeEntryErrorState(new AuthClientError(500, null))).toBe("code-error");
  });
});

describe("CODE_ENTRY_ERROR_COPY", () => {
  it("pins the exact rate-limited and invalid-code copy, and they differ", () => {
    expect(CODE_ENTRY_ERROR_COPY["code-error"]).toBe("CODE INVALID OR EXPIRED.");
    expect(CODE_ENTRY_ERROR_COPY["code-rate-limited"]).toBe(
      "TOO MANY ATTEMPTS — WAIT A MINUTE AND TRY AGAIN.",
    );
    expect(CODE_ENTRY_ERROR_COPY["code-error"]).not.toBe(
      CODE_ENTRY_ERROR_COPY["code-rate-limited"],
    );
  });
});
