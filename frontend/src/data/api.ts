import type { Contact, MetarResponse, TypeInfo } from "./types";

export class FeedDownError extends Error {
  constructor(status: number) {
    super(`feed request failed: HTTP ${status}`);
    this.name = "FeedDownError";
  }
}

export async function fetchConfig(): Promise<{ home: { lat: number; lon: number } }> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new FeedDownError(res.status);
  return res.json();
}

export async function fetchAdsb(
  lat: number,
  lon: number,
  radiusNm: number
): Promise<{ contacts: Contact[]; source: string; fetched_at: number }> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius_nm: String(radiusNm),
  });
  const res = await fetch(`/api/adsb?${params}`);
  if (!res.ok) throw new FeedDownError(res.status);
  return res.json();
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
  if (!res.ok) throw new FeedDownError(res.status);
  return res.json();
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
  if (!res.ok) throw new FeedDownError(res.status);
  return res.json();
}
