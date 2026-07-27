import type { Contact } from "./types";

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
