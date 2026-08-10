import { env as testEnv, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import type { Env } from "./env";
import worker from "./index";

function fakeEnv(
  assetBody = "<!doctype html><title>ADS-B Game</title>",
  appEnv: WorkerEnv["APP_ENV"] = "local",
) {
  const fetch = vi.fn(async () =>
    new Response(assetBody, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );
  const writeDataPoint = vi.fn();

  return {
    env: {
      ASSETS: { fetch },
      APP_ENV: appEnv,
      FORCE_MODE: "NORMAL",
      ADSB_BROKER: (testEnv as WorkerEnv).ADSB_BROKER,
      REQUEST_ANALYTICS: { writeDataPoint },
    } as unknown as Env,
    fetch,
    writeDataPoint,
  };
}

describe("Worker entry", () => {
  it("serves a typed status envelope without an assets or Python hop", async () => {
    const response = await exports.default.fetch(
      new Request("https://fly.voygent.app/api/status"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.has("strict-transport-security")).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      code: "OK",
      mode: "NORMAL",
      data: { status: "ok" },
      requestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      serverTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("does not consult assets for the status route", async () => {
    const { env, fetch, writeDataPoint } = fakeEnv();
    const response = await worker.fetch(
      new Request("https://fly.voygent.app/api/status"),
      env,
    );

    expect(response.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(writeDataPoint).toHaveBeenCalledOnce();
  });

  it("adds dynamic HSTS only in production", async () => {
    const production = await worker.fetch(
      new Request("https://fly.voygent.app/api/status"),
      fakeEnv(undefined, "production").env,
    );
    const staging = await worker.fetch(
      new Request("https://fly.voygent.app/api/status"),
      fakeEnv(undefined, "staging").env,
    );

    expect(production.headers.get("strict-transport-security")).toContain("max-age=");
    expect(staging.headers.has("strict-transport-security")).toBe(false);
  });

  it("uses the assets binding outside /api", async () => {
    const { env, fetch } = fakeEnv();
    const request = new Request("https://fly.voygent.app/flights/demo");
    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("ADS-B Game");
    expect(fetch).toHaveBeenCalledWith(request);
  });

  it("never turns an unknown API route into the SPA", async () => {
    const { env, fetch } = fakeEnv();
    const response = await worker.fetch(
      new Request("https://fly.voygent.app/api/unknown"),
      env,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(await response.text()).not.toContain("<!doctype html>");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects unsupported status methods explicitly", async () => {
    const { env } = fakeEnv();
    const response = await worker.fetch(
      new Request("https://fly.voygent.app/api/status", { method: "POST" }),
      env,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });

  it("fails closed without the broker while FORCE_MODE can still kill independently", async () => {
    const missingBroker = fakeEnv().env as unknown as Record<string, unknown>;
    delete missingBroker.ADSB_BROKER;
    const unavailable = await worker.fetch(
      new Request("https://fly.voygent.app/api/status"),
      missingBroker as unknown as Env,
    );
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      code: "BROKER_UNAVAILABLE",
      mode: "NORMAL",
    });

    const forcedEnv = {
      ...missingBroker,
      FORCE_MODE: "KILL_SWITCH",
    } as unknown as Env;
    const forced = await worker.fetch(
      new Request("https://fly.voygent.app/api/status"),
      forcedEnv,
    );
    expect(forced.status).toBe(503);
    await expect(forced.json()).resolves.toMatchObject({
      code: "ADMISSION_DENIED",
      mode: "KILL_SWITCH",
    });
  });
});
