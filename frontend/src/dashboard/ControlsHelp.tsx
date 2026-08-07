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
  KeyL: "L",
  KeyQ: "Q",
  KeyR: "R",
  KeyC: "C",
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

export default function ControlsHelp() {
  return (
    <div className="controls-help">
      {groupKeymap(KEYMAP).map((row) => (
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
  );
}
