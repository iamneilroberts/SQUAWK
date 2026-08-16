/*
 * The unified "glass" cockpit — Split-HUD desktop layout (owner-approved mock, 2026-08). Fixes
 * the bug where the old ONE centered bottom panel sat over the runway/gates on final: every
 * instrument is now its own small card hung off a landscape screen EDGE, leaving the center
 * (where the runway grows on approach) clear. Pieces, each the SAME reused component as before:
 *   - SPD / ALT edge tapes  : hard-left / hard-right, reusing the exact `Tape` component + tape
 *                             math the mobile Split-HUD already ships (hud/ImmersiveHudBar.tsx) —
 *                             one tape implementation for both platforms.
 *   - Primary face          : the per-class instrument (six-pack GA / EFIS airliner / HUD
 *                             fighter), chosen by DATA (profiles.ts -> PRIMARY_COMPONENTS below,
 *                             never an `if (class === ...)`), docked top-center under the
 *                             approach readout instead of bottom-center.
 *   - TACTICAL map          : NavMap (own-ship + traffic + airports + range rings; it already
 *                             absorbed the old heading-up RadarScope, see NavMap.tsx), bottom-left
 *                             corner.
 *   - Control-state strip   : THR / FLAPS / TRIM / GEAR (reused ControlState verbatim) + VSI/AGL,
 *                             bottom-center, one line.
 * WEATHER and CONTROLS (keymap help) still fold in behind the primary card's header toggles.
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
import { msToKt, mToFt } from "../sim/units";
import { Tape, tapeRangesFor } from "../hud/ImmersiveHudBar";
import { profileForClass, type PrimaryKind } from "./profiles";
import SixPack from "./SixPack";
import EfisDisplay from "./EfisDisplay";
import HudDisplay from "./HudDisplay";
import ControlState from "./ControlState";
import CompassIndicator from "./CompassIndicator";
import ThrottleIndicator from "./ThrottleIndicator";
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
  const tapeRange = tapeRangesFor(params);
  return (
    <div className="dash-strip">
      {/* SPD — hard-left edge. Same Tape component/math as mobile's Split-HUD; range null (honest
          em-dash, ground rule #1) rather than fabricating a reading when there is no snapshot. */}
      <Tape
        side="left"
        label="SPD"
        unit="KT"
        value={snapshot ? msToKt(snapshot.iasMs) : 0}
        range={snapshot ? tapeRange.ias : null}
      />
      {/* ALT — hard-right edge, moved up to sit under the compass (#hud-chrome-rework, see the
          .dash-strip .imm-tape[data-side="right"] top override in tokens.css). */}
      <Tape
        side="right"
        label="ALT"
        unit="FT"
        value={snapshot ? mToFt(snapshot.altitudeM) : 0}
        range={snapshot ? tapeRange.alt : null}
      />

      {/* Compass — top-right corner, above ALT (#hud-chrome-rework, owner-approved mock
          "Compass S · signin moved"). FULL (ImmersiveControl.tsx) keeps its own spot higher up;
          the compass sits below it, see .dash-compass in tokens.css for the exact offsets. */}
      <div className="dash-compass panel">
        <CompassIndicator headingRad={snapshot?.headingRad ?? null} />
      </div>

      {/* Throttle — prominent vertical gauge under ALT, right edge (#hud-chrome-rework). The tiny
          THR cell in the bottom control-state strip is hidden now (ControlState.tsx) so this is
          the one throttle readout on the split-HUD. */}
      <div className="dash-throttle-card panel">
        <ThrottleIndicator snapshot={snapshot} hasAfterburner={params.propulsion.afterburnerFactor > 1} />
      </div>

      {/* Per-class primary face — small, top-center, under the top HUD's approach readout stack
          (Hud.tsx's SIM bar / destination cue / approach readout). `background` is the deferred
          realistic-art seam. */}
      <section className="glass panel dash-primary">
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

        <div
          className="glass-primary"
          data-primary={profile.primary}
          style={{ background: profile.background }}
        >
          <CockpitPrimary snapshot={snapshot} params={params} />
        </div>

        {showWeather && (
          <div className="glass-aux dash-aux">
            <span className="glass-region-label label">WEATHER</span>
            <WeatherPanelBody state={weather} />
          </div>
        )}
        {showHelp && (
          <div className="glass-aux dash-aux">
            <span className="glass-region-label label">CONTROLS</span>
            <ControlsHelp />
          </div>
        )}
      </section>

      {/* Tactical map (NavMap = geographic own-ship + rings + traffic + airports; it already
          absorbed the old heading-up RadarScope) — bottom-left corner. */}
      <div className="glass panel dash-tactical">
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
          showBasemap
        />
      </div>

      {/* Control-state strip: reused ControlState (THR/FLAPS/TRIM/GEAR) + VSI/AGL — bottom-center,
          one line. */}
      <div className="glass panel dash-control-strip">
        <ControlState snapshot={snapshot} />
        <div className="control-state">
          <span className="control-state-item">{`VSI ${formatVsiFpm(snapshot?.verticalSpeedMs ?? null)}`}</span>
          <span className="control-state-item">{`AGL ${formatClearanceFt(snapshot?.terrainClearanceM ?? null)}`}</span>
        </div>
      </div>
    </div>
  );
}
