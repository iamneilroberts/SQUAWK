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
};
