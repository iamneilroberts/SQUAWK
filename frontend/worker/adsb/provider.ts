import type { Contact } from "../../src/data/types";
import {
  TRAFFIC_PROVIDER_MAX_RESPONSE_BYTES,
  TRAFFIC_PROVIDER_TIMEOUT_MS,
} from "../../src/shared/limits";
import {
  adsbRows,
  normalizeAdsbPayload,
  usableTrafficContacts,
} from "./normalize";
import type { NormalizedRegion } from "./region";
import { redactSensitive } from "../telemetry/redact";

export type AdsbProviderEnvironment = {
  ADSB_PROVIDER_PRIMARY?: string;
  ADSB_PROVIDER_FALLBACK?: string;
  ADSB_PROVIDER_RESERVE?: string;
  UPSTREAM_MIN_INTERVAL?: string;
  UPSTREAM_DAILY_LIMIT?: string;
  UPSTREAM_MAX_RADIUS_NM?: string;
  UPSTREAM_TIMEOUT_MS?: string;
  UPSTREAM_MAX_RESPONSE_BYTES?: string;
};

export type ProviderSettings = {
  templates: readonly string[];
  minimumIntervalMs: number;
  dailyLimit: number;
  maximumRadiusNm: number;
  timeoutMs: number;
  maximumResponseBytes: number;
};

export type ProviderTraffic = {
  contacts: Contact[];
  source: string;
  sourceTime: number | null;
  fetchedAt: number;
};

export type ProviderAttemptGate = {
  beforeAttempt(): Promise<void>;
  attemptFailed(): Promise<void>;
};

export type ProviderDependencies = {
  fetch: typeof fetch;
  nowMs: () => number;
  setTimeout: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

export type ProviderFailureCode =
  | "configuration"
  | "timeout"
  | "rate-limited"
  | "http"
  | "response-too-large"
  | "malformed";

export class ProviderConfigurationError extends Error {
  constructor() {
    super("ADS-B provider configuration is unavailable");
    this.name = "ProviderConfigurationError";
  }
}

export class ProviderUnavailableError extends Error {
  readonly failures: readonly ProviderFailureCode[];

  constructor(failures: readonly ProviderFailureCode[]) {
    super("ADS-B provider is unavailable");
    this.name = "ProviderUnavailableError";
    this.failures = [...failures];
  }
}

class ProviderAttemptError extends Error {
  constructor(readonly code: ProviderFailureCode) {
    super(code);
    this.name = "ProviderAttemptError";
  }
}

const systemDependencies: ProviderDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
  nowMs: () => Date.now(),
  setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: (timer) => globalThis.clearTimeout(timer),
};

function requiredNumber(
  value: string | undefined,
  predicate: (candidate: number) => boolean,
): number {
  if (value === undefined || value.trim() === "") throw new ProviderConfigurationError();
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !predicate(parsed)) throw new ProviderConfigurationError();
  return parsed;
}

function optionalNumber(
  value: string | undefined,
  fallback: number,
  predicate: (candidate: number) => boolean,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !predicate(parsed)) throw new ProviderConfigurationError();
  return parsed;
}

function assertTemplate(template: string): void {
  const placeholders: string[] = template.match(/\{[^{}]*\}/g) ?? [];
  if (
    !placeholders.includes("{lat}") ||
    !placeholders.includes("{lon}") ||
    !placeholders.includes("{radius}") ||
    placeholders.some((placeholder) => !["{lat}", "{lon}", "{radius}"].includes(placeholder))
  ) {
    throw new ProviderConfigurationError();
  }
  formatProviderUrl(template, 0, 0, 10);
}

export function readProviderSettings(env: AdsbProviderEnvironment): ProviderSettings {
  if (env.ADSB_PROVIDER_PRIMARY === undefined || env.ADSB_PROVIDER_PRIMARY.trim() === "") {
    throw new ProviderConfigurationError();
  }
  const templates = [
    env.ADSB_PROVIDER_PRIMARY,
    env.ADSB_PROVIDER_FALLBACK,
    env.ADSB_PROVIDER_RESERVE,
  ].filter((value): value is string => value !== undefined && value.trim() !== "");
  for (const template of templates) assertTemplate(template);

  const minimumIntervalSeconds = requiredNumber(
    env.UPSTREAM_MIN_INTERVAL,
    (candidate) => candidate >= 0,
  );
  const minimumIntervalMs = minimumIntervalSeconds * 1_000;
  if (!Number.isSafeInteger(minimumIntervalMs)) throw new ProviderConfigurationError();

  return {
    templates,
    minimumIntervalMs,
    dailyLimit: requiredNumber(
      env.UPSTREAM_DAILY_LIMIT,
      (candidate) => Number.isSafeInteger(candidate) && candidate > 0,
    ),
    maximumRadiusNm: requiredNumber(
      env.UPSTREAM_MAX_RADIUS_NM,
      (candidate) => candidate >= 10 && candidate <= 1_000,
    ),
    timeoutMs: optionalNumber(
      env.UPSTREAM_TIMEOUT_MS,
      TRAFFIC_PROVIDER_TIMEOUT_MS,
      (candidate) => Number.isSafeInteger(candidate) && candidate >= 100 && candidate <= 60_000,
    ),
    maximumResponseBytes: optionalNumber(
      env.UPSTREAM_MAX_RESPONSE_BYTES,
      TRAFFIC_PROVIDER_MAX_RESPONSE_BYTES,
      (candidate) => Number.isSafeInteger(candidate) && candidate >= 1_024 && candidate <= 8_388_608,
    ),
  };
}

export function formatProviderUrl(
  template: string,
  latitude: number,
  longitude: number,
  radiusNm: number,
): URL {
  if (![latitude, longitude, radiusNm].every(Number.isFinite)) {
    throw new ProviderConfigurationError();
  }
  const formatted = template
    .replaceAll("{lat}", String(latitude))
    .replaceAll("{lon}", String(longitude))
    .replaceAll("{radius}", String(Math.trunc(radiusNm)));
  if (formatted.length > 2_048 || /[{}]/.test(formatted)) throw new ProviderConfigurationError();

  let url: URL;
  try {
    url = new URL(formatted);
  } catch {
    throw new ProviderConfigurationError();
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) throw new ProviderConfigurationError();
  return url;
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maximumBytes) {
    throw new ProviderAttemptError("response-too-large");
  }
  if (response.body === null) throw new ProviderAttemptError("malformed");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel("ADS-B response limit exceeded");
        throw new ProviderAttemptError("response-too-large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    ) as unknown;
  } catch {
    throw new ProviderAttemptError("malformed");
  }
}

function failureCode(error: unknown): ProviderFailureCode {
  if (error instanceof ProviderAttemptError) return error.code;
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) return "timeout";
  return "http";
}

export async function fetchProviderTraffic(
  region: NormalizedRegion,
  settings: ProviderSettings,
  gate: ProviderAttemptGate,
  dependencies: ProviderDependencies = systemDependencies,
): Promise<ProviderTraffic> {
  if (region.providerRadiusNm > settings.maximumRadiusNm) {
    throw new ProviderConfigurationError();
  }

  const failures: ProviderFailureCode[] = [];
  for (const template of settings.templates) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let claimed = false;
    try {
      const url = formatProviderUrl(
        template,
        region.providerCenter.lat,
        region.providerCenter.lon,
        region.providerRadiusNm,
      );
      await gate.beforeAttempt();
      claimed = true;
      timer = dependencies.setTimeout(() => controller.abort(), settings.timeoutMs);
      const response = await dependencies.fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "manual",
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error("adsb_provider_http_failure", { status: response.status });
        throw new ProviderAttemptError(response.status === 429 ? "rate-limited" : "http");
      }
      const payload = await readBoundedJson(response, settings.maximumResponseBytes);
      if (adsbRows(payload) === null) throw new ProviderAttemptError("malformed");
      const normalized = normalizeAdsbPayload(payload);
      return {
        contacts: usableTrafficContacts(normalized.contacts),
        source: url.hostname,
        sourceTime: normalized.sourceTime,
        fetchedAt: dependencies.nowMs() / 1_000,
      };
    } catch (error) {
      if (!claimed) throw error;
      if (!(error instanceof ProviderAttemptError)) {
        console.error(
          "adsb_provider_attempt_exception",
          redactSensitive({
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorMessage: error instanceof Error ? error.message : "Unknown provider error",
          }),
        );
      }
      failures.push(failureCode(error));
      await gate.attemptFailed();
    } finally {
      if (timer !== null) dependencies.clearTimeout(timer);
    }
  }
  throw new ProviderUnavailableError(failures);
}
