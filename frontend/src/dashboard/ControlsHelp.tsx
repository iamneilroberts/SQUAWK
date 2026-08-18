/*
 * The keymap panel (spec D-6), rendered FROM the real `KEYMAP` constant. There is no second
 * hand-written key list anywhere in the app — `ControlsHelp.test.tsx` asserts that every action
 * in KEYMAP appears here, so a key added to the sampler and documented in KEYMAP shows up in the
 * cockpit automatically, and a key documented nowhere fails the test rather than the player.
 */
import { KEYMAP } from "../input/controls";

/**
 * Human-readable key faces. Explicit rather than derived, because "Equal" is "=" and
 * "NumpadAdd" is not "+" on its own key. The test requires an entry for every KEYMAP code.
 */
export const KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  KeyA: "A",
  KeyD: "D",
  KeyW: "W",
  KeyS: "S",
  Equal: "=",
  Minus: "-",
  NumpadAdd: "NUM +",
  NumpadSubtract: "NUM -",
  KeyF: "F",
  KeyV: "V",
  KeyG: "G",
  KeyB: "B",
  KeyR: "R",
  KeyL: "L",
  KeyE: "E",
  KeyC: "C",
  KeyT: "T",
  KeyY: "Y",
  Comma: ",",
  Period: ".",
  Slash: "?",
  Escape: "ESC",
};

/** Explicit label when we have one; otherwise the code with its DOM prefix stripped. */
export function keyLabel(code: string): string {
  const explicit = KEY_LABELS[code];
  if (explicit !== undefined) return explicit;
  return code.replace(/^(Key|Digit)/, "").toUpperCase();
}

/**
 * KEYMAP is code -> action; the panel wants action -> codes, in KEYMAP's own order, with the
 * duplicates ("throttle up" has three keys) folded into one row.
 */
export function groupKeymap(
  keymap: Readonly<Record<string, string>>,
): { action: string; keys: string[] }[] {
  const byAction = new Map<string, string[]>();
  for (const [code, action] of Object.entries(keymap)) {
    const existing = byAction.get(action);
    if (existing) existing.push(code);
    else byAction.set(action, [code]);
  }
  return [...byAction.entries()].map(([action, keys]) => ({ action, keys }));
}

/**
 * Codes the flight sampler (controls.ts) never reads — camera, session and UI chrome — vs.
 * everything else, which moves the aircraft. This is the #79 "flight controls vs cockpit
 * chrome" split; it lives here rather than in KEYMAP because it's a *presentation* grouping,
 * not part of the code -> action contract the sampler and the rest of the app share.
 */
const COCKPIT_CHROME_CODES = new Set<string>(["Escape", "KeyE", "KeyC", "KeyT", "KeyY", "Slash"]);

type ControlsHelpRow = { action: string; keys: string[] };

/**
 * Desktop mouse rows (#44, right-drag look/orbit follow-up): not in KEYMAP — nothing here is a
 * keyboard `code` — so they are hand-written rather than generated. "LEFT-DRAG"/"RIGHT-DRAG"/
 * "WHEEL" are pseudo key-faces for the same visual treatment as the keyboard rows, not real
 * KeyboardEvent codes.
 */
const MOUSE_ROWS: ControlsHelpRow[] = [
  { action: "flight stick — roll/pitch (FPV) / orbit camera (exterior)", keys: ["LEFT-DRAG"] },
  { action: "look around (FPV) / orbit camera (exterior)", keys: ["RIGHT-DRAG"] },
  { action: "throttle (FPV) / camera zoom (exterior)", keys: ["WHEEL"] },
];

function ControlsHelpGroup({ title, rows }: { title: string; rows: ControlsHelpRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="controls-help-group">
      <span className="controls-help-group-title">{title}</span>
      <div className="controls-help-list">
        {rows.map((row) => (
          <div className="controls-help-row" key={row.action}>
            <span className="controls-help-keys">
              {row.keys.map((code) => (
                <kbd className="controls-help-key" key={code}>{keyLabel(code)}</kbd>
              ))}
            </span>
            <span className="controls-help-action">{row.action}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ControlsHelp() {
  const rows = groupKeymap(KEYMAP);
  const flightRows = rows.filter((row) => !COCKPIT_CHROME_CODES.has(row.keys[0]));
  const chromeRows = rows.filter((row) => COCKPIT_CHROME_CODES.has(row.keys[0]));
  return (
    <div className="controls-help">
      <ControlsHelpGroup title="FLIGHT CONTROLS" rows={flightRows} />
      <ControlsHelpGroup title="COCKPIT" rows={chromeRows} />
      <ControlsHelpGroup title="MOUSE (DESKTOP)" rows={MOUSE_ROWS} />
    </div>
  );
}
