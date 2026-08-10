import { isSystemMode, type SystemMode } from "../shared/mode";
import type { MetarResponse, TrafficData, TypeInfo } from "./types";

export class FeedDownError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;
  readonly mode: SystemMode | null;

  constructor(
    status: number,
    code: string | null = null,
    retryAfterSeconds: number | null = null,
    mode: SystemMode | null = null,
  ) {
    super(`feed request failed: HTTP ${status}`);
    this.name = "FeedDownError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.mode = mode;
  }
}

type ParsedApiData<T> = { data: T; mode: SystemMode };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readApiData<T>(response: Response): Promise<ParsedApiData<T>> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON failure is still represented by its stable HTTP status below.
  }
  if (!response.ok) {
    const retryHeaderValue = response.headers?.get("retry-after");
    const retryHeader = retryHeaderValue === null || retryHeaderValue === undefined
      ? Number.NaN
      : Number(retryHeaderValue);
    const retryBody = record(body) && record(body.error) ? Number(body.error.retryAfterSeconds) : NaN;
    const retryAfterSeconds = Number.isFinite(retryBody)
      ? retryBody
      : Number.isFinite(retryHeader)
        ? retryHeader
        : null;
    throw new FeedDownError(
      response.status,
      record(body) && typeof body.code === "string" ? body.code : null,
      retryAfterSeconds,
      record(body) && isSystemMode(body.mode) ? body.mode : null,
    );
  }
  if (
    record(body) &&
    body.ok === true &&
    "data" in body &&
    isSystemMode(body.mode)
  ) {
    return { data: body.data as T, mode: body.mode };
  }
  // Temporary compatibility for enrichment/METAR endpoints still served by Python
  // until their planned Worker tasks land. Traffic itself always uses the Worker envelope.
  return { data: body as T, mode: "NORMAL" };
}

export async function fetchConfig(): Promise<{ home: { lat: number; lon: number } }> {
  const res = await fetch("/api/config");
  return (await readApiData<{ home: { lat: number; lon: number } }>(res)).data;
}

export type TrafficFetchResult = TrafficData & { mode: SystemMode };

export async function fetchTraffic(
  lat: number,
  lon: number,
  radiusNm: number
): Promise<TrafficFetchResult> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius_nm: String(radiusNm),
  });
  const res = await fetch(`/api/traffic?${params}`);
  const parsed = await readApiData<TrafficData>(res);
  return { ...parsed.data, mode: parsed.mode };
}

export async function fetchActiveMissionTraffic(
  missionId: string,
  lat: number,
  lon: number,
  radiusNm: number,
): Promise<TrafficFetchResult> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius_nm: String(radiusNm),
  });
  const res = await fetch(`/api/missions/${missionId}/traffic?${params}`, {
    credentials: "same-origin",
  });
  const parsed = await readApiData<TrafficData>(res);
  return { ...parsed.data, mode: parsed.mode };
}

/**
 * adsbdb enrichment for one contact. Two failure modes, not one: `!res.ok` means OUR backend
 * didn't answer (thrown as FeedDownError, same as the other endpoints); a 200 with
 * `available: false` means the backend answered but adsbdb itself did not (timeout, network
 * error, non-404 HTTP error upstream) — distinct from `available: true` with all-null fields,
 * which is adsbdb genuinely having no record for this hex. The card renders the difference;
 * see TrafficDetailCard.
 */
export async function fetchTypeInfo(hex: string): Promise<TypeInfo> {
  const res = await fetch(`/api/type/${hex}`);
  return (await readApiData<TypeInfo>(res)).data;
}

/**
 * Current METAR for one ICAO station, proxied through the backend's /api/metar/{icao}. Two
 * failure modes, not one, exactly like fetchTypeInfo: `!res.ok` means OUR backend didn't answer
 * (thrown as FeedDownError → the panel's NO FEED state); a 200 with `available: false` means the
 * backend answered but aviationweather.gov did not — distinct from `available: true` with
 * `metar: null`, which is the station genuinely having no current report. The panel renders the
 * difference; see WeatherPanel.
 */
export async function fetchMetar(icao: string): Promise<MetarResponse> {
  const res = await fetch(`/api/metar/${icao}`);
  return (await readApiData<MetarResponse>(res)).data;
}
