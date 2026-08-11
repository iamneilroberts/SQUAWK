import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminApp from "./AdminApp";
import Controls from "./Controls";

describe("admin console", () => {
  it("starts in a bounded loading state without rendering the public globe", () => {
    const html = renderToStaticMarkup(<AdminApp />);
    expect(html).toContain("Loading operational data");
    expect(html).not.toContain("cesium");
  });

  it("explains effective-mode precedence and keeps destructive controls explicit", () => {
    const html = renderToStaticMarkup(<Controls
      csrfToken="csrf"
      reload={async () => undefined}
      status={{
        utcDay: "2026-08-10",
        admittedRequests: 90_000,
        providerRequests: 2,
        automaticMode: "READ_ONLY",
        requestedMode: "NORMAL",
        effectiveMode: "READ_ONLY",
        budgetBand: "read-only",
        activeFlights: 1,
        protectedReserveRemaining: 150,
        registrationEnabled: true,
        providerCacheOnly: false,
        health: {},
      }}
    />);
    expect(html).toContain("cannot relax an automatic READ_ONLY");
    expect(html).toContain("KILL_SWITCH");
    expect(html).toContain("Clear one cache region");
    expect(html).toContain("available after alert setup");
  });
});
