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

export type TrafficFreshness = "FRESH" | "STALE" | "EXPIRED";
export type TrafficCacheStatus = "MISS" | "HIT" | "COALESCED" | "STALE" | "EXPIRED";

export type TrafficData = {
  contacts: Contact[];
  source: string | null;
  sourceTime: number | null;
  fetchedAt: number | null;
  cacheAgeSeconds: number | null;
  freshness: TrafficFreshness;
  providerAvailable: boolean;
  regionKey: string;
  nextRefreshSeconds: number;
  cacheStatus: TrafficCacheStatus;
  radiusNm: number;
};

/** One reported cloud layer. `baseFt` is height above ground in feet, or null if not given. */
export type MetarCloud = {
  cover: string | null;
  baseFt: number | null;
};

/**
 * A parsed METAR, flattened by the backend's /api/metar/{icao} proxy. Every field is nullable:
 * whatever the report omitted is null, which the panel renders as an em-dash — never a
 * substituted or zeroed value.
 */
export type MetarFields = {
  /** Observation time, epoch seconds. The panel shows its real age from this. */
  obsTime: number | null;
  windDirDeg: number | null;
  /** True when the wind direction is variable (METAR "VRB") — a flag, not a fake heading. */
  windVariable: boolean;
  windSpeedKt: number | null;
  windGustKt: number | null;
  /** Statute miles, as reported — kept as a string so the API's "10+" marker survives. */
  visibility: string | null;
  tempC: number | null;
  dewpointC: number | null;
  altimInHg: number | null;
  clouds: MetarCloud[];
  /** Lowest broken-or-worse layer, feet; null when there is no ceiling. */
  ceilingFt: number | null;
  flightCategory: string | null;
  stationName: string | null;
  raw: string | null;
};

/**
 * The backend's METAR answer. Same honest-data shape as TypeInfo: `available: false` means the
 * proxy reached us but aviationweather.gov did not answer (NO FEED), as distinct from
 * `available: true` with `metar: null`, which is the station genuinely having no current report.
 */
export type MetarResponse = {
  icao: string;
  available: boolean;
  metar: MetarFields | null;
  attribution: string;
};

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
