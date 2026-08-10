import { readFile } from "node:fs/promises";

import { createTestHarness } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const server = createTestHarness({
  workers: [{ configPath: "./dist/voygent_adsb_game/wrangler.json" }],
});

beforeAll(async () => {
  await server.listen();
}, 30_000);

afterAll(async () => {
  await server.close();
}, 30_000);

function expectSecurityHeaders(response, { hsts }) {
  const csp = response.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'");
  expect(csp).toContain("worker-src 'self' blob:");
  expect(csp).toContain("frame-src https://challenges.cloudflare.com");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  expect(response.headers.get("permissions-policy")).toContain("camera=()");
  expect(response.headers.has("strict-transport-security")).toBe(hsts);
}

describe("Cloudflare application routing", () => {
  it("runs the Worker for the status route and exact API namespace root", async () => {
    const statusResponse = await server.fetch("/api/status");
    const statusBody = await statusResponse.json();

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.headers.get("content-type")).toContain("application/json");
    expectSecurityHeaders(statusResponse, { hsts: false });
    expect(statusBody).toMatchObject({
      ok: true,
      code: "OK",
      mode: "NORMAL",
      data: { status: "ok" },
    });

    const apiRootResponse = await server.fetch("/api");
    expect(apiRootResponse.status).toBe(404);
    expect(apiRootResponse.headers.get("content-type")).toContain("application/json");
    expectSecurityHeaders(apiRootResponse, { hsts: false });
    expect(await apiRootResponse.text()).not.toContain("<!doctype html>");
  });

  it("serves an SPA route and a built hashed asset through the configured boundary", async () => {
    const routeResponse = await server.fetch("/flights/demo");
    expect(routeResponse.status).toBe(200);
    expect(routeResponse.headers.get("content-type")).toContain("text/html");
    expectSecurityHeaders(routeResponse, { hsts: true });
    expect(await routeResponse.text()).toContain("<title>ADSB-GAME</title>");

    const indexHtml = await readFile("./dist/client/index.html", "utf8");
    const assetPath = indexHtml.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    expect(assetPath).toBeDefined();

    const assetResponse = await server.fetch(assetPath);
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toContain("javascript");
    expectSecurityHeaders(assetResponse, { hsts: true });
  });
});
