import { describe, expect, it, vi } from "vitest";

import { createRequestContext } from "./requestContext";

describe("RequestContext", () => {
  it("creates one correlation ID and server time and retains no raw IPv4 address", async () => {
    const uuid = vi.fn(() => "00000000-0000-4000-8000-000000000001");
    const wallClock = vi.fn(() => new Date("2026-08-10T12:34:56.000Z"));
    const digest = vi.fn(async () => "coarse-digest");

    const context = await createRequestContext(
      new Request("https://fly.voygent.app/api/status", {
        headers: { "cf-connecting-ip": "203.0.113.97" },
      }),
      { routeFamily: "status", mode: "READ_ONLY" },
      { uuid, wallClock, monotonicNow: () => 10, digest },
    );

    expect(uuid).toHaveBeenCalledOnce();
    expect(wallClock).toHaveBeenCalledOnce();
    expect(digest).toHaveBeenCalledWith("ip-network:203.0.113.0/24");
    expect(context).toMatchObject({
      requestId: "00000000-0000-4000-8000-000000000001",
      serverTime: "2026-08-10T12:34:56.000Z",
      mode: "READ_ONLY",
      routeFamily: "status",
      actor: { kind: "anonymous", samplingKey: "anon:coarse-digest" },
    });
    expect(JSON.stringify(context)).not.toContain("203.0.113.97");
  });

  it("derives a coarse IPv6 /64 sampling digest", async () => {
    const digest = vi.fn(async () => "v6-digest");
    await createRequestContext(
      new Request("https://fly.voygent.app/api/status", {
        headers: { "cf-connecting-ip": "2001:db8:abcd:1234:5678:90ab:cdef:1234" },
      }),
      { routeFamily: "status", mode: "NORMAL" },
      {
        uuid: () => "00000000-0000-4000-8000-000000000002",
        wallClock: () => new Date("2026-08-10T12:34:56.000Z"),
        monotonicNow: () => 1,
        digest,
      },
    );

    expect(digest).toHaveBeenCalledWith("ip-network:2001:db8:abcd:1234::/64");
  });
});
