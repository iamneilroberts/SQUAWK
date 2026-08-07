export type Contact = {
  hex: string;
  flight: string | null;
  t: string | null;
  lat: number;
  lon: number;
  alt_geom: number | null;
  alt_baro: number | "ground" | null;
  gs: number | null;
  track: number | null;
  baro_rate: number | null;
  military: boolean;
  seen_pos: number | null;
};

export type FeedStatus = "live" | "stale" | "offline";

/** adsbdb enrichment, proxied through the backend's /api/type/{hex}. Any field may be null. */
export type TypeInfo = {
  type: string | null;
  manufacturer: string | null;
  registration: string | null;
  /**
   * False when the backend reached adsbdb's endpoint but adsbdb itself did not answer
   * (timeout, network error, non-404 HTTP error) — as distinct from adsbdb answering and
   * genuinely having no record for this hex, which is `available: true` with the three
   * fields above still null. Collapsing these two into one shape is what used to make an
   * outage render as "no record" on the card.
   */
  available: boolean;
};
