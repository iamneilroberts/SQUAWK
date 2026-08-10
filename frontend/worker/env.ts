import type { AdsbProviderEnvironment } from "./adsb/provider";

export type Env = WorkerEnv &
  AdsbProviderEnvironment & {
    HOME_LAT?: string;
    HOME_LON?: string;
    DB: D1Database;
    CSRF_SECRET: string;
    EMAIL_KEY_SECRET: string;
    TURNSTILE_SECRET: string;
    TURNSTILE_SITE_KEY?: string;
    AUTH_FROM_EMAIL: string;
    PUBLIC_ORIGIN?: string;
    AUTH_REQUEST_RATE_LIMITER?: RateLimit;
    TRAFFIC_REQUEST_RATE_LIMITER?: RateLimit;
  };
