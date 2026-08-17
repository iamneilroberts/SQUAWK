import { describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { serveAdminShell } from "./shell";

function runtime() {
  const fetch = vi.fn(async () => new Response("<!doctype html><title>Admin</title>", {
    headers: { "cache-control": "public, max-age=3600", "content-type": "text/html" },
  }));
  return {
    env: {
      APP_ENV: "staging",
      ASSETS: { fetch },
    } as unknown as Env,
    fetch,
  };
}

describe("admin shell", () => {
  it("denies the shell before assets when Access authorization fails", async () => {
    const { env, fetch } = runtime();
    const response = await serveAdminShell(
      new Request("https://squawk.example/admin"),
      env,
      vi.fn(async () => { throw new Error("private verifier detail"); }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cf-Access-Jwt-Assertion");
    expect(await response.text()).not.toContain("private verifier detail");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serves assets only after Access authorization and strips public caching", async () => {
    const { env, fetch } = runtime();
    const request = new Request("https://squawk.example/admin/users", {
      headers: { "cf-access-jwt-assertion": "signed-access-token" },
    });
    const authorize = vi.fn(async () => ({
      kind: "admin" as const,
      userId: "access:owner",
      sessionId: "11111111-1111-4111-8111-111111111111",
      samplingKey: "admin:owner",
    }));
    const response = await serveAdminShell(request, env, authorize);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cf-Access-Jwt-Assertion");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(fetch).toHaveBeenCalledWith(request);
    expect(authorize).toHaveBeenCalledWith(request, env);
  });
});
