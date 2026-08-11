import type { AdsbProviderEnvironment } from "./adsb/provider";

export type Env = WorkerEnv &
  AdsbProviderEnvironment & {
    HOME_LAT?: string;
    HOME_LON?: string;
    DB: D1Database;
    CSRF_SECRET: string;
    MISSION_SIGNING_SECRET: string;
    EMAIL_KEY_SECRET: string;
    TURNSTILE_SECRET: string;
    TURNSTILE_SITE_KEY?: string;
    AUTH_FROM_EMAIL: string;
    PUBLIC_ORIGIN?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    AUTH_REQUEST_RATE_LIMITER?: RateLimit;
    TRAFFIC_REQUEST_RATE_LIMITER?: RateLimit;
    MISSION_REQUEST_RATE_LIMITER?: RateLimit;
    ADMIN_RATE_LIMITER?: RateLimit;
    RESULT_TRACES?: R2Bucket;
    CLOUDFLARE_ACCOUNT_ID?: string;
    ANALYTICS_READ_TOKEN?: string;
    REQUEST_ANALYTICS_DATASET?: string;
  };
