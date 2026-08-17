/*
 * Mobile NAV/WX combo (owner ask 2026-08-11). The desktop cockpit (DashboardStrip → UnifiedGlass)
 * is hidden on phones by design; this surfaces just the tactical NavMap (with the precip-radar
 * overlay) + the METAR weather panel on mobile, collapsed by default so it never clutters the
 * minimal immersive flying view.
 *
 * Collapsed: a NAV/WX chip with a one-glance WX token (CLR/BKN030/OFF/…). Tap to expand into a
 * translucent overlay that floats OVER the flight view (does not shrink it); ✕ collapses back.
 * Reuses the exact NavMap + WeatherPanelBody the desktop glass renders and the same store data
 * DashboardStrip feeds them, so there is no new rendering or fetch logic — only the mount +
 * collapse toggle. Frugal: the precip-radar layer is fetched only while the panel is open.
 */
import { useState } from "react";
import type { HudSnapshot } from "../hud/snapshot";
import { loadAirports } from "../data/airports";
import { useStore } from "../state/store";
import { DEFAULT_NAV_RANGE_NM } from "./navMath";
import NavMap from "./NavMap";
import { WeatherPanelBody, formatClouds, type WeatherState } from "./WeatherPanel";
import { useWeather } from "./WeatherPanel";
import { useNavWeather } from "./NavWeatherLayer";

/**
 * One-glance WX token for the collapsed chip. Honest to the same rule as the panel: it never
 * invents a reading — the cloud/ceiling code only appears from a real report, every other state
 * is an explicit word, and a missing report is "NO OBS", not a number.
 */
export function navWxChipStatus(state: WeatherState): string {
  switch (state.kind) {
    case "no-position":
      return "—";
    case "no-station":
      return "NO STN";
    case "loading":
      return "…";
    case "unreachable":
      return "WX OFF";
    case "ok":
      if (!state.resp.available) return "WX OFF";
      if (state.resp.metar === null) return "NO OBS";
      return formatClouds(state.resp.metar);
  }
}

export default function MobileNavWx(
  { snapshot, faded = false }: { snapshot: HudSnapshot | null; faded?: boolean },
) {
  const [expanded, setExpanded] = useState(false);
  const [navRangeNm, setNavRangeNm] = useState(DEFAULT_NAV_RANGE_NM);
  const contacts = useStore((s) => s.contacts);
  const feedStatus = useStore((s) => s.feedStatus);
  const origin = useStore((s) => s.origin);
  const radiusNm = useStore((s) => s.radiusNm);
  const labelsOn = useStore((s) => s.labelsOn);
  const weather = useWeather(snapshot);
  // Frugal: only fetch the precip-radar overlay while the panel is actually open.
  const navWeather = useNavWeather(snapshot, expanded);

  if (!expanded) {
    return (
      <button
        type="button"
        className={"mobile-navwx-chip" + (faded ? " mobile-navwx-chip-faded" : "")}
        onClick={() => setExpanded(true)}
        aria-label="Open nav and weather"
      >
        <span className="mobile-navwx-chip-label">NAV/WX ▸</span>
        <span className="mobile-navwx-chip-status">{navWxChipStatus(weather)}</span>
      </button>
    );
  }

  return (
    <div className="mobile-navwx-overlay" role="dialog" aria-label="Nav and weather">
      <div className="mobile-navwx-head">
        <span className="glass-region-label label">NAV / WX</span>
        <button
          type="button"
          className="mobile-navwx-close"
          onClick={() => setExpanded(false)}
          aria-label="Close nav and weather"
        >
          ✕
        </button>
      </div>
      <div className="mobile-navwx-map">
        <NavMap
          snapshot={snapshot}
          airports={loadAirports()}
          contacts={contacts}
          feedStatus={feedStatus}
          ghostHex={origin?.hex ?? null}
          navRangeNm={navRangeNm}
          feedRadiusNm={radiusNm}
          onRangeChange={setNavRangeNm}
          showRadar
          navWeather={navWeather}
          showBasemap
          showLabels={labelsOn}
        />
      </div>
      <div className="mobile-navwx-wx">
        <span className="glass-region-label label">WEATHER</span>
        <WeatherPanelBody state={weather} />
      </div>
    </div>
  );
}
