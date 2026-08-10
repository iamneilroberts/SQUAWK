import { describe, expect, it } from "vitest";

import { redactSensitive } from "./redact";

describe("redactSensitive", () => {
  it("scrubs nested credentials, PII, payloads, and sensitive query values", () => {
    const input = {
      authorization: "Bearer secret-token",
      cookie: "session=secret",
      email: "pilot@example.com",
      ip: "203.0.113.42",
      nested: {
        token: "abc.def.ghi",
        password: "hunter2",
        evidence: { touchdown: 1 },
        adsb: [{ hex: "abc123" }],
        body: { raw: true },
        url: "https://fly.voygent.app/callback?token=raw-token&safe=ok",
      },
      message: "user pilot@example.com from 2001:db8::1 sent Bearer top-secret",
      safe: "route-status",
    };

    const redacted = redactSensitive(input);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("pilot@example.com");
    expect(serialized).not.toContain("203.0.113.42");
    expect(serialized).not.toContain("2001:db8::1");
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain("touchdown");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).toContain("route-status");
  });

  it("is bounded and cycle safe", () => {
    const cyclic: Record<string, unknown> = { safe: "ok" };
    cyclic.self = cyclic;
    cyclic.deep = { one: { two: { three: { four: { five: "hidden" } } } } };

    expect(redactSensitive(cyclic, { maxDepth: 3 })).toEqual({
      safe: "ok",
      self: "[CIRCULAR]",
      deep: { one: { two: "[TRUNCATED]" } },
    });
  });

  it("scrubs common credential parameters, assignments, cookie headers, and JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.raw-signature";
    const input = {
      session: "standalone-session",
      message: [
        "https://example.test/callback?access_token=access-raw&refresh_token=refresh-raw",
        "client_secret=client-raw api_key=api-raw password=password-raw",
        "session=session-raw Authorization: Basic basic-raw",
        "Cookie: sid=cookie-raw; theme=dark",
        jwt,
      ].join(" "),
    };

    const serialized = JSON.stringify(redactSensitive(input));
    for (const secret of [
      "standalone-session",
      "access-raw",
      "refresh-raw",
      "client-raw",
      "api-raw",
      "password-raw",
      "session-raw",
      "basic-raw",
      "cookie-raw",
      jwt,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("omits arbitrary exception messages and whole multi-token authorization values", () => {
    const customError = new Error("Invalid session token raw-session-value");
    customError.name = "SessionToken-rawSecret123";
    const serialized = JSON.stringify(
      redactSensitive({
        error: customError,
        digest: 'Authorization: Digest username="pilot", response="digest-raw"',
        aws: "Authorization: AWS4-HMAC-SHA256 Credential=AKIA-RAW, Signature=aws-raw",
        whitespace: "access token whitespace-raw",
      }),
    );

    for (const secret of [
      "raw-session-value",
      "SessionToken-rawSecret123",
      "pilot",
      "digest-raw",
      "AKIA-RAW",
      "aws-raw",
      "whitespace-raw",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("[REDACTED_ERROR_MESSAGE]");
    expect(serialized).toContain('"name":"Error"');
  });
});
