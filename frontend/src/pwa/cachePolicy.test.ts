import { describe, expect, it } from "vitest";

import { cacheKindForRequest } from "./cachePolicy";

describe("service-worker cache policy", () => {
  it("never caches authenticated or dynamic API requests", () => {
    for (const path of ["/api/me", "/api/traffic", "/api/missions/id/result", "/admin/users"]) {
      expect(cacheKindForRequest(new URL(`https://game.test${path}`), "GET", "cors")).toBe("none");
    }
    expect(cacheKindForRequest(new URL("https://game.test/"), "POST", "navigate")).toBe("none");
  });

  it("allows only the versioned shell, static assets, airport/tutorial data, and icons", () => {
    expect(cacheKindForRequest(new URL("https://game.test/"), "GET", "navigate")).toBe("shell");
    expect(cacheKindForRequest(new URL("https://game.test/sw-assets.json"), "GET", "cors")).toBe("asset");
    expect(cacheKindForRequest(new URL("https://game.test/assets/app-abc123.js"), "GET", "cors")).toBe("asset");
    expect(cacheKindForRequest(new URL("https://game.test/data/airports/oa-2026-08-10-v1/manifest.json"), "GET", "cors")).toBe("asset");
    expect(cacheKindForRequest(new URL("https://game.test/icons/app-192.png"), "GET", "cors")).toBe("asset");
    expect(cacheKindForRequest(new URL("https://game.test/some-user-page"), "GET", "cors")).toBe("none");
    expect(cacheKindForRequest(new URL("https://third-party.test/assets/a.js"), "GET", "cors", "https://game.test")).toBe("none");
  });
});
