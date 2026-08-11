import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearAnalyticsCacheForTest, queryRequestAnalytics } from "./analytics";

const ENV = {
  CLOUDFLARE_ACCOUNT_ID: "5c2997e723bf93da998a627e799cd443",
  ANALYTICS_READ_TOKEN: "read-only-test-token",
  REQUEST_ANALYTICS_DATASET: "voygent_adsb_game_requests_staging",
};

beforeEach(() => clearAnalyticsCacheForTest());

describe("admin request analytics", () => {
  it("reports an explicit degraded state when the read token is not configured", async () => {
    const fetcher = vi.fn();
    await expect(queryRequestAnalytics({}, "summary", "1h", { fetch: fetcher, now: () => 10 }))
      .resolves.toMatchObject({ available: false, degraded: true, reason: "not-configured", rows: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses a fixed sample-weighted SQL template and briefly caches bounded rows", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(init?.body)).toContain("sum(_sample_interval)");
      expect(String(init?.body)).toContain("voygent_adsb_game_requests_staging");
      expect(String(init?.body)).toContain("INTERVAL '1 HOUR'");
      return new Response(JSON.stringify({ data: [{ route: "traffic", status_class: "2xx", requests: 12, avg_latency_ms: 4.5 }] }), {
        headers: { "content-type": "application/json" },
      });
    });
    const first = await queryRequestAnalytics(ENV, "routes", "1h", { fetch: fetcher, now: () => 100 });
    const second = await queryRequestAnalytics(ENV, "routes", "1h", { fetch: fetcher, now: () => 101 });
    expect(first).toMatchObject({ available: true, sampled: true, rows: [{ requests: 12 }] });
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("distinguishes empty, unavailable, and malformed analytics responses", async () => {
    await expect(queryRequestAnalytics(ENV, "traffic", "15m", {
      fetch: async () => new Response(JSON.stringify({ data: [] })), now: () => 1,
    })).resolves.toMatchObject({ available: true, degraded: false, rows: [] });
    clearAnalyticsCacheForTest();
    await expect(queryRequestAnalytics(ENV, "traffic", "15m", {
      fetch: async () => new Response("unavailable", { status: 503 }), now: () => 2,
    })).resolves.toMatchObject({ available: false, reason: "upstream-unavailable" });
    clearAnalyticsCacheForTest();
    await expect(queryRequestAnalytics(ENV, "traffic", "15m", {
      fetch: async () => new Response(JSON.stringify({ data: [{ unsafe: { nested: true } }] })), now: () => 3,
    })).resolves.toMatchObject({ available: false, reason: "invalid-response" });
  });

  it("labels delayed analytics without turning it into an availability failure", async () => {
    await expect(queryRequestAnalytics(ENV, "summary", "6h", {
      fetch: async () => new Response(JSON.stringify({ data: [{ requests: 3, freshest_timestamp: "2026-08-10T10:00:00.000Z" }] })),
      now: () => Date.parse("2026-08-10T10:11:00.000Z"),
    })).resolves.toMatchObject({ available: true, delayed: true, dataLagMs: 660_000 });
  });
});
