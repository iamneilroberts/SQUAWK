import { describe, expect, it } from "vitest";

import type { RequestContext } from "../telemetry/requestContext";
import { jsonEnvelope } from "./response";

const context: RequestContext = {
  requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  serverTime: "2026-08-10T00:00:00.000Z",
  startedAtMs: 1,
  mode: "NORMAL",
  routeFamily: "test",
  actor: { kind: "anonymous", samplingKey: "anon:test" },
};

describe("JSON response cache boundary", () => {
  it("defaults API envelopes to no-store", () => {
    const response = jsonEnvelope(context, { ok: true, code: "OK", status: 200, data: {} });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("preserves an explicit public cache policy for bounded public reads", () => {
    const response = jsonEnvelope(context, {
      ok: true,
      code: "OK",
      status: 200,
      data: {},
      headers: { "cache-control": "public, max-age=15, s-maxage=60" },
    });
    expect(response.headers.get("cache-control")).toBe("public, max-age=15, s-maxage=60");
  });
});
