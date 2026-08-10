import { describe, expect, it, vi } from "vitest";

import { enforceSameOrigin, securityHeaders } from "./security";

describe("request and response security", () => {
  it("fails closed when a protected mutation omits or mismatches Origin", () => {
    expect(() =>
      enforceSameOrigin(new Request("https://fly.voygent.app/api/test", { method: "POST" })),
    ).toThrowError(expect.objectContaining({ code: "ORIGIN_REQUIRED" }));
    expect(() =>
      enforceSameOrigin(
        new Request("https://fly.voygent.app/api/test", {
          method: "POST",
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "ORIGIN_MISMATCH" }));

    expect(() =>
      enforceSameOrigin(
        new Request("https://fly.voygent.app/api/test", {
          method: "POST",
          headers: { origin: "https://fly.voygent.app" },
        }),
      ),
    ).not.toThrow();
  });

  it("sets the restrictive Cesium-compatible headers and production-only HSTS", () => {
    const production = securityHeaders("production");
    const staging = securityHeaders("staging");
    const csp = production.get("content-security-policy") ?? "";

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("services.arcgisonline.com");
    expect(csp).toContain("*.reearth.land");
    expect(csp).toContain("*.rainviewer.com");
    expect(csp).toContain("*.cesium.com");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(production.get("x-content-type-options")).toBe("nosniff");
    expect(production.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(production.get("permissions-policy")).toContain("camera=()");
    expect(production.get("strict-transport-security")).toContain("max-age=");
    expect(staging.has("strict-transport-security")).toBe(false);
  });

  it("runs an injected CSRF hook rather than trusting a header in the router", async () => {
    const csrf = vi.fn(async (_request: Request) => true);
    await expect(csrf(new Request("https://fly.voygent.app"))).resolves.toBe(true);
    expect(csrf).toHaveBeenCalledOnce();
  });
});
