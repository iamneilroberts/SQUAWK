export const ANALYTICS_VIEWS = ["summary", "routes", "traffic"] as const;
export const ANALYTICS_WINDOWS = ["15m", "1h", "6h", "24h"] as const;

export type AnalyticsView = typeof ANALYTICS_VIEWS[number];
export type AnalyticsWindow = typeof ANALYTICS_WINDOWS[number];

export type AnalyticsQueryEnvironment = {
  CLOUDFLARE_ACCOUNT_ID?: string;
  ANALYTICS_READ_TOKEN?: string;
  REQUEST_ANALYTICS_DATASET?: string;
};

export type AnalyticsResult = {
  available: boolean;
  degraded: boolean;
  reason: "ok" | "not-configured" | "upstream-unavailable" | "invalid-response";
  source: "cloudflare-analytics-engine";
  authoritative: false;
  sampled: true;
  delayed: boolean | null;
  dataLagMs: number | null;
  view: AnalyticsView;
  window: AnalyticsWindow;
  capturedAtMs: number;
  rows: Array<Record<string, string | number | null>>;
};

export type AnalyticsDependencies = {
  fetch: typeof fetch;
  now: () => number;
};

const DEFAULT_DEPENDENCIES: AnalyticsDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
  now: () => Date.now(),
};
const CACHE_TTL_MS = 15_000;
const MAX_ROWS = 240;
const cache = new Map<string, { expiresAtMs: number; result: AnalyticsResult }>();

const WINDOW_SQL: Record<AnalyticsWindow, string> = {
  "15m": "15 MINUTE",
  "1h": "1 HOUR",
  "6h": "6 HOUR",
  "24h": "24 HOUR",
};

function queryFor(dataset: string, view: AnalyticsView, window: AnalyticsWindow): string {
  const since = `timestamp >= NOW() - INTERVAL '${WINDOW_SQL[window]}'`;
  switch (view) {
    case "summary":
      return `SELECT sum(_sample_interval) AS requests,
        sum(if(startsWith(blob2, '5'), _sample_interval, 0)) AS errors,
        sum(double1 * _sample_interval) / greatest(sum(_sample_interval), 1) AS avg_latency_ms,
        quantileExactWeighted(0.95)(double1, _sample_interval) AS p95_latency_ms,
        max(timestamp) AS freshest_timestamp
        FROM ${dataset} WHERE ${since}`;
    case "routes":
      return `SELECT blob1 AS route, blob2 AS status_class,
        sum(_sample_interval) AS requests,
        sum(double1 * _sample_interval) / greatest(sum(_sample_interval), 1) AS avg_latency_ms,
        max(timestamp) AS freshest_timestamp
        FROM ${dataset} WHERE ${since}
        GROUP BY route, status_class ORDER BY requests DESC LIMIT ${MAX_ROWS}`;
    case "traffic":
      return `SELECT blob4 AS cache_status, blob5 AS operation,
        sum(_sample_interval) AS requests, max(timestamp) AS freshest_timestamp
        FROM ${dataset} WHERE ${since} AND blob1 = 'traffic'
        GROUP BY cache_status, operation ORDER BY requests DESC LIMIT ${MAX_ROWS}`;
  }
}

function unavailable(
  reason: AnalyticsResult["reason"],
  view: AnalyticsView,
  window: AnalyticsWindow,
  capturedAtMs: number,
): AnalyticsResult {
  return {
    available: false,
    degraded: true,
    reason,
    source: "cloudflare-analytics-engine",
    authoritative: false,
    sampled: true,
    delayed: null,
    dataLagMs: null,
    view,
    window,
    capturedAtMs,
    rows: [],
  };
}

function sanitizeRows(value: unknown): AnalyticsResult["rows"] | null {
  if (!Array.isArray(value) || value.length > MAX_ROWS) return null;
  const rows: AnalyticsResult["rows"] = [];
  for (const candidate of value) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const entries = Object.entries(candidate as Record<string, unknown>);
    if (entries.length > 16) return null;
    const row: Record<string, string | number | null> = {};
    for (const [key, cell] of entries) {
      if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key)) return null;
      if (cell !== null && typeof cell !== "string" && typeof cell !== "number") return null;
      if (typeof cell === "string" && cell.length > 128) return null;
      if (typeof cell === "number" && !Number.isFinite(cell)) return null;
      row[key] = cell;
    }
    rows.push(row);
  }
  return rows;
}

export async function queryRequestAnalytics(
  environment: AnalyticsQueryEnvironment,
  view: AnalyticsView,
  window: AnalyticsWindow,
  overrides: Partial<AnalyticsDependencies> = {},
): Promise<AnalyticsResult> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const capturedAtMs = dependencies.now();
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID;
  const token = environment.ANALYTICS_READ_TOKEN;
  const dataset = environment.REQUEST_ANALYTICS_DATASET;
  if (
    accountId === undefined || !/^[0-9a-f]{32}$/i.test(accountId) ||
    token === undefined || token.length < 16 || token.length > 512 ||
    dataset === undefined || !/^[a-z][a-z0-9_]{0,62}$/.test(dataset)
  ) return unavailable("not-configured", view, window, capturedAtMs);

  const cacheKey = `${accountId}:${dataset}:${view}:${window}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined && cached.expiresAtMs > capturedAtMs) return cached.result;

  const abort = new AbortController();
  const timer = globalThis.setTimeout(() => abort.abort(), 5_000);
  let result: AnalyticsResult;
  try {
    const response = await dependencies.fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "text/plain; charset=utf-8",
        },
        body: queryFor(dataset, view, window),
        signal: abort.signal,
      },
    );
    if (!response.ok) return unavailable("upstream-unavailable", view, window, capturedAtMs);
    const body: unknown = await response.json();
    const rows = body !== null && typeof body === "object" && "data" in body
      ? sanitizeRows((body as { data?: unknown }).data)
      : null;
    if (rows === null) return unavailable("invalid-response", view, window, capturedAtMs);
    const freshestAtMs = rows.reduce<number | null>((freshest, row) => {
      const cell = row.freshest_timestamp;
      const parsed = typeof cell === "number" ? cell : typeof cell === "string" ? Date.parse(cell) : NaN;
      return Number.isFinite(parsed) && (freshest === null || parsed > freshest) ? parsed : freshest;
    }, null);
    const dataLagMs = freshestAtMs === null ? null : Math.max(0, capturedAtMs - freshestAtMs);
    result = {
      available: true,
      degraded: false,
      reason: "ok",
      source: "cloudflare-analytics-engine",
      authoritative: false,
      sampled: true,
      delayed: dataLagMs === null ? false : dataLagMs > 10 * 60_000,
      dataLagMs,
      view,
      window,
      capturedAtMs,
      rows,
    };
  } catch {
    return unavailable("upstream-unavailable", view, window, capturedAtMs);
  } finally {
    globalThis.clearTimeout(timer);
  }
  cache.set(cacheKey, { expiresAtMs: capturedAtMs + CACHE_TTL_MS, result });
  return result;
}

export function clearAnalyticsCacheForTest(): void {
  cache.clear();
}
