import { describe, expect, it, vi } from "vitest";

import rateLimited from "../../test/fixtures/adsb/provider-429.json";
import timeoutFixture from "../../test/fixtures/adsb/provider-timeout.json";
import {
  fetchProviderTraffic,
  formatProviderUrl,
  ProviderConfigurationError,
  ProviderUnavailableError,
  readProviderSettings,
  type ProviderAttemptGate,
  type ProviderDependencies,
  type ProviderSettings,
} from "./provider";
import { normalizeRegion } from "./region";

const primary = "https://primary.example/v2/point/{lat}/{lon}/{radius}";
const fallback = "https://fallback.example/v2/lat/{lat}/lon/{lon}/dist/{radius}";
const region = normalizeRegion(30, -88, 80, {
  cellDegrees: 0.25,
  providerRadiusStepNm: 25,
  providerMaxRadiusNm: 300,
});

function settings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    templates: [primary, fallback],
    minimumIntervalMs: 1_000,
    dailyLimit: 1_000,
    maximumRadiusNm: 300,
    timeoutMs: timeoutFixture.afterMs,
    maximumResponseBytes: 1_024,
    ...overrides,
  };
}

function gate(): ProviderAttemptGate & { beforeAttempt: ReturnType<typeof vi.fn>; attemptFailed: ReturnType<typeof vi.fn> } {
  return {
    beforeAttempt: vi.fn(async () => undefined),
    attemptFailed: vi.fn(async () => undefined),
  };
}

function dependencies(fetchMock: typeof fetch): ProviderDependencies {
  return {
    fetch: fetchMock,
    nowMs: () => 1_785_118_050_000,
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: (timer) => clearTimeout(timer),
  };
}

describe("ADS-B provider configuration", () => {
  it("has no guessed URL, minimum interval, daily limit, or maximum radius", () => {
    for (const env of [
      {},
      { ADSB_PROVIDER_PRIMARY: primary },
      { ADSB_PROVIDER_PRIMARY: primary, UPSTREAM_MIN_INTERVAL: "1" },
      {
        ADSB_PROVIDER_PRIMARY: primary,
        UPSTREAM_MIN_INTERVAL: "1",
        UPSTREAM_DAILY_LIMIT: "1000",
      },
    ]) {
      expect(() => readProviderSettings(env)).toThrow(ProviderConfigurationError);
    }
    expect(() =>
      readProviderSettings({
        ADSB_PROVIDER_PRIMARY: "   ",
        UPSTREAM_MIN_INTERVAL: "1",
        UPSTREAM_DAILY_LIMIT: "1000",
        UPSTREAM_MAX_RADIUS_NM: "300",
      }),
    ).toThrow(ProviderConfigurationError);
    expect(() =>
      readProviderSettings({
        ADSB_PROVIDER_PRIMARY: primary,
        UPSTREAM_MIN_INTERVAL: "0.0001",
        UPSTREAM_DAILY_LIMIT: "1000",
        UPSTREAM_MAX_RADIUS_NM: "300",
      }),
    ).toThrow(ProviderConfigurationError);
  });

  it("reads ordered templates and explicit provider allowance bindings", () => {
    expect(
      readProviderSettings({
        ADSB_PROVIDER_PRIMARY: primary,
        ADSB_PROVIDER_FALLBACK: fallback,
        UPSTREAM_MIN_INTERVAL: "2.5",
        UPSTREAM_DAILY_LIMIT: "4321",
        UPSTREAM_MAX_RADIUS_NM: "300",
      }),
    ).toMatchObject({
      templates: [primary, fallback],
      minimumIntervalMs: 2_500,
      dailyLimit: 4_321,
      maximumRadiusNm: 300,
    });
  });

  it("accepts only strict HTTPS templates with known placeholders", () => {
    expect(formatProviderUrl(primary, 30, -88, 80).href).toBe(
      "https://primary.example/v2/point/30/-88/80",
    );
    for (const template of [
      "http://insecure.example/{lat}/{lon}/{radius}",
      "https://user:pass@example.test/{lat}/{lon}/{radius}",
      "https://example.test/{lat}/{lon}/{callerUrl}",
    ]) {
      expect(() =>
        readProviderSettings({
          ADSB_PROVIDER_PRIMARY: template,
          UPSTREAM_MIN_INTERVAL: "1",
          UPSTREAM_DAILY_LIMIT: "1",
          UPSTREAM_MAX_RADIUS_NM: "300",
        }),
      ).toThrow(ProviderConfigurationError);
    }
  });
});

describe("ADS-B provider fetch", () => {
  it("fails over after 429, counts both attempts, and sends only fixed request options", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://primary.example")) {
        return new Response(JSON.stringify(rateLimited), { status: rateLimited.status });
      }
      expect(init).toMatchObject({
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
      });
      return Response.json({ now: 1_785_118_044.001, ac: [{ hex: "abc123", lat: 30, lon: -88 }] });
    });
    const attemptGate = gate();
    const result = await fetchProviderTraffic(
      region,
      settings(),
      attemptGate,
      dependencies(fetchMock),
    );

    expect(result).toMatchObject({
      source: "fallback.example",
      sourceTime: 1_785_118_044.001,
      fetchedAt: 1_785_118_050,
      contacts: [{ hex: "abc123" }],
    });
    expect(attemptGate.beforeAttempt).toHaveBeenCalledTimes(2);
    expect(attemptGate.attemptFailed).toHaveBeenCalledOnce();
  });

  it("aborts a timed-out primary and fails over", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).startsWith("https://primary.example")) {
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException("", "AbortError"));
            return;
          }
          init?.signal?.addEventListener("abort", () => reject(new DOMException("", "AbortError")));
        });
      }
      return Response.json({ ac: [] });
    });
    const deps = dependencies(fetchMock);
    deps.setTimeout = (callback) => {
      queueMicrotask(callback);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    };
    deps.clearTimeout = () => undefined;
    const attemptGate = gate();
    await expect(fetchProviderTraffic(region, settings(), attemptGate, deps)).resolves.toMatchObject({
      source: "fallback.example",
    });
    expect(attemptGate.beforeAttempt).toHaveBeenCalledTimes(2);
    expect(attemptGate.attemptFailed).toHaveBeenCalledOnce();
  });

  it("rejects malformed and oversized success bodies", async () => {
    const malformed = vi.fn<typeof fetch>(async () => Response.json({ message: "not an envelope" }));
    await expect(
      fetchProviderTraffic(region, settings({ templates: [primary] }), gate(), dependencies(malformed)),
    ).rejects.toMatchObject({ failures: ["malformed"] } satisfies Partial<ProviderUnavailableError>);

    const oversized = vi.fn<typeof fetch>(async () =>
      new Response("x".repeat(2_000), { headers: { "content-length": "2000" } }),
    );
    await expect(
      fetchProviderTraffic(region, settings({ templates: [primary] }), gate(), dependencies(oversized)),
    ).rejects.toMatchObject(
      { failures: ["response-too-large"] } satisfies Partial<ProviderUnavailableError>,
    );
  });
});
