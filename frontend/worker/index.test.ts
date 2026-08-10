import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import type { Env } from "./env";
import worker from "./index";

function fakeEnv(assetBody = "<!doctype html><title>ADS-B Game</title>") {
  const fetch = vi.fn(async () =>
    new Response(assetBody, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );

  return {
    env: { ASSETS: { fetch } } as unknown as Env,
    fetch,
  };
}

describe("Worker entry", () => {
  it("serves a typed status envelope without an assets or Python hop", async () => {
    const response = await exports.default.fetch(
      new Request("https://fly.voygent.app/api/status"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
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
    const { env, fetch } = fakeEnv();
    const response = await worker.fetch(
      new Request("https://fly.voygent.app/api/status"),
      env,
    );

    expect(response.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
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
});
