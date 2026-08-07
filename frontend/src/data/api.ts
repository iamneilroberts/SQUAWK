import type { Contact, TypeInfo } from "./types";

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
 * adsbdb enrichment for one contact. The backend already distinguishes "adsbdb says it has never
 * heard of this hex" (a 200 with all-null fields) from "adsbdb is unreachable" (also a 200 with
 * all-null fields, but uncached) — from the browser's side the difference we CAN see is a bad
 * HTTP status, which throws. The card renders three states from that; see TrafficDetailCard.
 */
export async function fetchTypeInfo(hex: string): Promise<TypeInfo> {
  const res = await fetch(`/api/type/${hex}`);
  if (!res.ok) throw new FeedDownError(res.status);
  return res.json();
}
