/*
 * The unified "glass" cockpit panel (desktop-only redesign): ONE panel replacing the old
 * five-panel strip (INSTRUMENTS / RADAR / NAVMAP / WEATHER / CONTROLS). Layout:
 *   - LEFT  : the per-class PRIMARY flight instruments, chosen by DATA (the class -> profile
 *             registry, profiles.ts) and mapped to a component through PRIMARY_COMPONENTS below.
 *             There is no `if (class === ...)` here — the primary is a table lookup.
 *   - RIGHT : the merged TACTICAL map. The old RADAR (heading-up PPI) and NAVMAP (north-up
 *             geographic) collapse into ONE geographic map. NavMap already renders the radar's
 *             traffic (it calls radarMath.blipsFor via navMath.navContacts) plus airports, range
 *             rings, own-ship and the range selector — so it IS the combined tactical picture,
 *             and the redundant heading-up scope is retired (RadarScope/radarMath live on inside
 *             NavMap). Reuse, don't rewrite.
 *   - BOTTOM: the control-state strip — THR / FLAPS / TRIM / GEAR (reused ControlState verbatim)
 *             plus VSI / AGL from the same hud/format formatters.
 * WEATHER and CONTROLS (keymap help) fold in behind small header toggles so both stay reachable
 * without cluttering the flight instruments.
 *
 * Hook-free body like DashboardStripBody: all state/handlers are props, so the test walks the
 * element tree without jsdom and proves per-class selection directly.
 */
import type { ReactNode } from "react";
import type { Airport } from "../data/airports";
import type { Contact, FeedStatus } from "../data/types";
import type { HudSnapshot } from "../hud/snapshot";
import type { ClassParams } from "../sim/types";
import { formatVsiFpm, formatClearanceFt } from "../hud/format";
import { profileForClass, type PrimaryKind } from "./profiles";
import SixPack from "./SixPack";
import EfisDisplay from "./EfisDisplay";
import HudDisplay from "./HudDisplay";
import ControlState from "./ControlState";
import NavMap from "./NavMap";
import ControlsHelp from "./ControlsHelp";
import { WeatherPanelBody, type WeatherState } from "./WeatherPanel";
import type { NavWeatherState } from "./navWeatherMath";

/**
 * The render-side data table: a primary KIND resolves to its component. This is the second half
 * of "data, not branches" — profiles.ts maps class id -> primary kind, and this maps kind ->
 * component, so no component ever branches on class. All three share the ({snapshot, params})
 * shape, which is why SixPack drops straight in.
 */
const PRIMARY_COMPONENTS: Record<
  PrimaryKind,
  (p: { snapshot: HudSnapshot | null; params: ClassParams }) => ReactNode
> = {
  sixpack: SixPack,
  efis: EfisDisplay,
  hud: HudDisplay,
};

/** The class-selected primary instrument face, shared by the live glass and pre-auth preview. */
export function CockpitPrimary({
  snapshot,
  params,
}: {
  snapshot: HudSnapshot | null;
  params: ClassParams;
}) {
  const profile = profileForClass(params.id);
  const Primary = PRIMARY_COMPONENTS[profile.primary];
  return <Primary snapshot={snapshot} params={params} />;
}

export function UnifiedGlassBody({
  snapshot, params, contacts, feedStatus, ghostHex, feedRadiusNm, airports,
  navRangeNm, weather, navWeather, showWeather, showHelp,
  onNavRangeChange, onToggleWeather, onToggleHelp, onToggleStrip,
}: {
  snapshot: HudSnapshot | null;
  params: ClassParams;
  contacts: Map<string, Contact>;
  feedStatus: FeedStatus;
  ghostHex: string | null;
  feedRadiusNm: number;
  airports: Airport[];
  navRangeNm: number;
  weather: WeatherState;
  navWeather: NavWeatherState;
  showWeather: boolean;
  showHelp: boolean;
  onNavRangeChange(nm: number): void;
  onToggleWeather(): void;
  onToggleHelp(): void;
  onToggleStrip(): void;
}) {
  const profile = profileForClass(params.id);
  return (
    <div className="dash-strip">
      <section className="glass panel">
        <header className="glass-header">
          <span className="glass-title label">GLASS · {params.label}</span>
          <div className="glass-header-actions">
            <button
              type="button"
              className={showWeather ? "status-chip-button status-chip-button-active" : "status-chip-button"}
              onClick={onToggleWeather}
            >
              WX
            </button>
            <button
              type="button"
              className={showHelp ? "status-chip-button status-chip-button-active" : "status-chip-button"}
              onClick={onToggleHelp}
            >
              CTRL [/]
            </button>
            <button type="button" className="status-chip-button" onClick={onToggleStrip}>
              HIDE [C]
            </button>
          </div>
        </header>

        <div className="glass-main">
          {/* LEFT — per-class primary. `background` is the deferred realistic-art seam. */}
          <div
            className="glass-primary"
            data-primary={profile.primary}
            style={{ background: profile.background }}
          >
            <CockpitPrimary snapshot={snapshot} params={params} />
          </div>

          {/* RIGHT — merged tactical map (NavMap = geographic own-ship + rings + traffic + airports). */}
          <div className="glass-tactical">
            <span className="glass-region-label label">TACTICAL</span>
            <NavMap
              snapshot={snapshot}
              airports={airports}
              contacts={contacts}
              feedStatus={feedStatus}
              ghostHex={ghostHex}
              navRangeNm={navRangeNm}
              feedRadiusNm={feedRadiusNm}
              onRangeChange={onNavRangeChange}
              showRadar={showWeather}
              navWeather={navWeather}
            />
          </div>
        </div>

        {/* BOTTOM — control-state strip: reused ControlState (THR/FLAPS/TRIM/GEAR) + VSI/AGL. */}
        <div className="glass-control-strip">
          <ControlState snapshot={snapshot} />
          <div className="control-state">
            <span className="control-state-item">{`VSI ${formatVsiFpm(snapshot?.verticalSpeedMs ?? null)}`}</span>
            <span className="control-state-item">{`AGL ${formatClearanceFt(snapshot?.terrainClearanceM ?? null)}`}</span>
          </div>
        </div>

        {showWeather && (
          <div className="glass-aux">
            <span className="glass-region-label label">WEATHER</span>
            <WeatherPanelBody state={weather} />
          </div>
        )}
        {showHelp && (
          <div className="glass-aux">
            <span className="glass-region-label label">CONTROLS</span>
            <ControlsHelp />
          </div>
        )}
      </section>
    </div>
  );
}
