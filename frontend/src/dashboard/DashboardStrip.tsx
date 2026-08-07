/*
 * The bottom cockpit strip (spec D-1): six-pack left, radar centre (Task 4), weather/ATC right,
 * controls help at the edge. Every panel folds on its own; KeyC folds the lot.
 *
 * Collapse state is LOCAL React state, on purpose (decisions.md CD-006): it is read by nothing
 * outside this subtree, it changes at human cadence, and the store's job is session state, not
 * furniture. It therefore survives PAUSE (the strip stays mounted) and resets on QUIT (the strip
 * unmounts with the flight) — which is the same "no residue" rule the rest of teardown follows.
 *
 * The component is split in two so the rendering half can be tested without a renderer:
 * `DashboardStrip` owns the hooks, `DashboardStripBody` owns every element.
 */
import { useEffect, useState } from "react";
import type { HudSnapshot } from "../hud/snapshot";
import type { ClassParams } from "../sim/types";
import { loadC172 } from "../sim/params";
import PanelFrame from "./PanelFrame";
import SixPack from "./SixPack";
import WeatherPanel from "./WeatherPanel";
import AtcPanel from "./AtcPanel";
import ControlsHelp from "./ControlsHelp";

export type PanelId = "gauges" | "radar" | "weather" | "atc" | "help";
export type StripState = { open: boolean; collapsed: Record<PanelId, boolean> };

export const PANEL_IDS: readonly PanelId[] = ["gauges", "radar", "weather", "atc", "help"];

/** Instruments and the honest placeholders are up; the help panel starts folded. */
export function defaultStripState(): StripState {
  return {
    open: true,
    collapsed: { gauges: false, radar: false, weather: false, atc: false, help: true },
  };
}

export function togglePanel(s: StripState, id: PanelId): StripState {
  return { ...s, collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } };
}

export function toggleStrip(s: StripState): StripState {
  return { ...s, open: !s.open };
}

/** The only two keys this strip claims. Everything else belongs to the aeroplane. */
export function stripKeyAction(code: string): "strip" | "help" | null {
  if (code === "KeyC") return "strip";
  if (code === "Slash") return "help";
  return null;
}

export function DashboardStripBody({ state, snapshot, params, onTogglePanel, onToggleStrip }: {
  state: StripState;
  snapshot: HudSnapshot | null;
  params: ClassParams;
  onTogglePanel(id: PanelId): void;
  onToggleStrip(): void;
}) {
  if (!state.open) {
    return (
      <div className="dash-strip dash-strip-closed">
        <button type="button" className="status-chip-button" onClick={onToggleStrip}>
          COCKPIT [C]
        </button>
      </div>
    );
  }

  return (
    <div className="dash-strip">
      <PanelFrame title="INSTRUMENTS" collapsed={state.collapsed.gauges}
        onToggle={() => onTogglePanel("gauges")}>
        <SixPack snapshot={snapshot} params={params} />
      </PanelFrame>

      <PanelFrame title="WEATHER" collapsed={state.collapsed.weather}
        onToggle={() => onTogglePanel("weather")}>
        <WeatherPanel />
      </PanelFrame>

      <PanelFrame title="ATC" collapsed={state.collapsed.atc}
        onToggle={() => onTogglePanel("atc")}>
        <AtcPanel />
      </PanelFrame>

      <PanelFrame title="CONTROLS" collapsed={state.collapsed.help}
        onToggle={() => onTogglePanel("help")}>
        <ControlsHelp />
      </PanelFrame>

      <button type="button" className="status-chip-button dash-strip-hide" onClick={onToggleStrip}>
        HIDE [C]
      </button>
    </div>
  );
}

export default function DashboardStrip({ snapshot }: { snapshot: HudSnapshot | null }) {
  const [state, setState] = useState<StripState>(defaultStripState);
  const params = loadC172();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = stripKeyAction(e.code);
      if (action === null) return;
      setState((s) => (action === "strip" ? toggleStrip(s) : togglePanel(s, "help")));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <DashboardStripBody
      state={state}
      snapshot={snapshot}
      params={params}
      onTogglePanel={(id) => setState((s) => togglePanel(s, id))}
      onToggleStrip={() => setState(toggleStrip)}
    />
  );
}
