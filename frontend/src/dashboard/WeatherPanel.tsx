/*
 * The weather panel (spec D-5, issue #10). Real METAR for the nearest ICAO station to the
 * aircraft, proxied through the backend's /api/metar/{icao}, honouring the honest-data rule to
 * the letter:
 *
 *   - The only numbers on this panel come from a real report. Every field the METAR omits is an
 *     em-dash, never a substituted or zeroed value (a "0 KT" gust is a fake reading, not "no
 *     gust"). A test asserts the offline / no-station / no-report states contain no digits AT
 *     ALL — the cheapest way to ship a fake reading is to make an empty screen "look finished".
 *   - Feed down (our proxy unreachable, or the proxy up but aviationweather.gov down) → an
 *     explicit NO FEED state, same semantics as the radar scope's OFFLINE.
 *   - A station with no current report → an explicit NO METAR state (out of coverage or simply
 *     no report), distinct from NO FEED — we do not invent a reading to fill it.
 *   - Attribution is shown whenever a report is on screen (data-sources table rule).
 *
 * Split like TrafficDetailCard: `useWeather` owns the position sampling, station selection, fetch
 * and polling (hooks); `WeatherPanelBody` is hook-free and holds every element, so it is tested
 * without a renderer via the same collectText element-tree style as the other panels. The
 * hook-owning half lives one level up in DashboardStrip, which passes the state down — the panel
 * body DashboardStripBody renders must stay hook-free.
 */
import { useEffect, useRef, useState } from "react";
import type { HudSnapshot } from "../hud/snapshot";
import type { MetarFields, MetarResponse } from "../data/types";
import type { Airport } from "../data/airports";
import { loadAirports } from "../data/airports";
import { fetchMetar } from "../data/api";
import { nearestIcaoStation } from "../data/metarStation";
import { EM_DASH } from "../hud/format";

/** How often we re-check which station is nearest (cheap local math over the bundled airports). */
const STATION_CHECK_MS = 60_000;
/** How often we re-fetch the same station's METAR. Reports refresh ~hourly; poll modestly. */
const METAR_REFRESH_MS = 8 * 60_000;

export type WeatherState =
  | { kind: "no-position" }
  | { kind: "no-station" }
  | { kind: "loading"; station: Airport; rangeNm: number }
  | { kind: "unreachable"; station: Airport; rangeNm: number }
  | { kind: "ok"; station: Airport; rangeNm: number; resp: MetarResponse };

// ---- pure formatters (every one em-dashes a missing value) ----------------------------------

const orDash = (v: string | number | null | undefined, suffix = ""): string =>
  v === null || v === undefined || v === "" ? EM_DASH : `${v}${suffix}`;

const pad3 = (n: number): string => String(n).padStart(3, "0");

export function formatWind(m: MetarFields): string {
  if (m.windSpeedKt === null) return EM_DASH;
  if (m.windSpeedKt === 0 && !m.windVariable) return "CALM";
  const dir = m.windVariable ? "VRB" : m.windDirDeg === null ? EM_DASH : `${pad3(m.windDirDeg)}°`;
  const gust = m.windGustKt === null ? "" : `G${m.windGustKt}`;
  return `${dir} ${m.windSpeedKt}${gust} KT`;
}

export function formatVisibility(m: MetarFields): string {
  return m.visibility === null ? EM_DASH : `${m.visibility} SM`;
}

export function formatCeiling(m: MetarFields): string {
  return m.ceilingFt === null ? "NONE" : `${m.ceilingFt} FT`;
}

export function formatClouds(m: MetarFields): string {
  if (m.clouds.length === 0) return "CLR";
  return m.clouds
    .map((c) => `${c.cover ?? EM_DASH}${c.baseFt === null ? "" : pad3(Math.round(c.baseFt / 100))}`)
    .join(" ");
}

export function formatTempDew(m: MetarFields): string {
  const t = m.tempC === null ? EM_DASH : `${Math.round(m.tempC)}°C`;
  const d = m.dewpointC === null ? EM_DASH : `${Math.round(m.dewpointC)}°C`;
  return `${t} / ${d}`;
}

/** Real observation age from obsTime — never faked; an absent obsTime is an em-dash. */
export function formatObsAge(obsTime: number | null, nowMs: number): string {
  if (obsTime === null) return EM_DASH;
  const mins = Math.max(0, Math.floor((nowMs / 1000 - obsTime) / 60));
  if (mins < 60) return `${mins} MIN`;
  return `${Math.floor(mins / 60)}H ${mins % 60}M`;
}

// ---- the hook-free body ---------------------------------------------------------------------

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="metar-row">
      <span className="label">{label}</span>
      <span className="metar-value">{value}</span>
    </div>
  );
}

/** An honest empty state: a single amber line, no numbers. Reused for every no-data condition. */
function Empty({ state, note }: { state: string; note?: string }) {
  return (
    <div className="dash-empty">
      <div className="dash-empty-state">{state}</div>
      {note ? <div className="dash-empty-note">{note}</div> : null}
    </div>
  );
}

export function WeatherPanelBody({
  state,
  nowMs = Date.now(),
}: {
  state: WeatherState;
  nowMs?: number;
}) {
  if (state.kind === "no-position") return <Empty state="AWAITING OWN POSITION" />;
  if (state.kind === "no-station") return <Empty state="NO METAR STATION NEARBY" note="OUT OF COVERAGE" />;
  if (state.kind === "loading") {
    return <Empty state={`METAR ${state.station.ident}`} note="LOOKUP…" />;
  }

  // Feed down: our proxy unreachable, OR the proxy answered but aviationweather.gov did not
  // (available:false). Both mean the same thing to the pilot — no live feed — and neither is
  // "no report", so neither may show a reading.
  const offline = state.kind === "unreachable" || (state.kind === "ok" && !state.resp.available);
  if (offline) return <Empty state="NO FEED · WEATHER OFFLINE" note={state.station.ident} />;

  // ok + available but no report for this station: an honest empty, distinct from NO FEED.
  if (state.resp.metar === null) {
    return <Empty state="NO METAR" note={state.station.ident} />;
  }

  const m = state.resp.metar;
  return (
    <div className="metar">
      <Row label="STATION" value={`${state.resp.icao} · ${Math.round(state.rangeNm)} NM`} />
      <Row label="WIND" value={formatWind(m)} />
      <Row label="VISIBILITY" value={formatVisibility(m)} />
      <Row label="CEILING" value={formatCeiling(m)} />
      <Row label="CLOUD" value={formatClouds(m)} />
      <Row label="ALTIMETER" value={orDash(m.altimInHg, " IN")} />
      <Row label="TEMP/DEW" value={formatTempDew(m)} />
      <Row label="OBS AGE" value={formatObsAge(m.obsTime, nowMs)} />
      <div className="metar-attribution">{state.resp.attribution}</div>
    </div>
  );
}

// ---- the hook: position -> nearest station -> fetch -> poll ----------------------------------

/**
 * Turns the live own-ship snapshot into a WeatherState. Position is sampled from a ref on a slow
 * timer rather than recomputed on every ~10 Hz snapshot render, so the nearest-station scan over
 * the bundled airports runs about once a minute, not sixty times a second. A METAR is fetched
 * when the nearest station changes or the current one goes stale (METAR_REFRESH_MS) — never on
 * every tick.
 */
export function useWeather(snapshot: HudSnapshot | null): WeatherState {
  const [state, setState] = useState<WeatherState>({ kind: "no-position" });
  const posRef = useRef<{ lat: number; lon: number } | null>(null);
  posRef.current = snapshot ? { lat: snapshot.latDeg, lon: snapshot.lonDeg } : null;
  const fetchedIdentRef = useRef<string | null>(null);
  const lastFetchMsRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    const airports = loadAirports();

    function tick() {
      const pos = posRef.current;
      if (pos === null) {
        if (fetchedIdentRef.current === null) setState({ kind: "no-position" });
        return;
      }
      const nearest = nearestIcaoStation(pos.lat, pos.lon, airports);
      if (nearest === null) {
        fetchedIdentRef.current = null;
        setState({ kind: "no-station" });
        return;
      }
      const { airport, rangeNm } = nearest;
      const now = Date.now();
      const stationChanged = airport.ident !== fetchedIdentRef.current;
      const stale = now - lastFetchMsRef.current >= METAR_REFRESH_MS;
      if (!stationChanged && !stale) return;

      fetchedIdentRef.current = airport.ident;
      lastFetchMsRef.current = now;
      setState({ kind: "loading", station: airport, rangeNm });
      fetchMetar(airport.ident)
        .then((resp) => {
          if (!cancelled) setState({ kind: "ok", station: airport, rangeNm, resp });
        })
        .catch(() => {
          if (!cancelled) setState({ kind: "unreachable", station: airport, rangeNm });
        });
    }

    tick();
    const timer = setInterval(tick, STATION_CHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return state;
}
