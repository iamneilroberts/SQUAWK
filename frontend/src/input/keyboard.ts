/*
 * Window-level key capture: a Set of held key codes, nothing more. Sampling that Set into
 * a control vector is controls.ts's job, so this file has no idea what a throttle is.
 *
 * `code` (physical key) not `key` (character) so the bindings survive a non-US layout.
 * Escape is deliberately absent from GAME_KEY_CODES: it cannot be preventDefault'ed out of
 * exiting pointer lock anyway, and the flight loop wants it as the pause key (spec §6).
 */
export const GAME_KEY_CODES: ReadonlySet<string> = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "KeyW", "KeyS", "KeyA", "KeyD",
  "Equal", "Minus", "NumpadAdd", "NumpadSubtract",
  "KeyF", "KeyV", "KeyG", "KeyB",
  "Comma", "Period",
  // Return-to-level assist (issue #5a): the flight loop edge-detects it from the held set, the
  // same way the sampler edge-detects the flap keys. KeyR (re-sync) is deliberately NOT here —
  // it fires a one-shot React action in FlightSession, so it stays a chrome key like KeyC/Slash.
  "KeyL",
  // Free-look (issue #9): FlightSession watches KeyQ down/up to drive pointer lock and mouse
  // capture; it lives here so the preventDefault + Ctrl/Cmd/Alt guard cover it like the others.
  // The control sampler never reads it, so it does not touch the flight inputs.
  "KeyQ",
]);

export type KeyboardTarget = {
  addEventListener(type: string, fn: (e: any) => void): void;
  removeEventListener(type: string, fn: (e: any) => void): void;
};

export function createKeyboard(target: KeyboardTarget): { held: Set<string>; dispose(): void } {
  const held = new Set<string>();

  const onKeyDown = (e: {
    code: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    preventDefault(): void;
  }) => {
    // Ctrl/Cmd/Alt+<game key> is a browser shortcut (close-tab, select-all, save, find...)
    // sharing a `code` with a game key — let it through untouched, don't capture it.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (GAME_KEY_CODES.has(e.code)) {
      e.preventDefault(); // arrows must not scroll the page out from under the sim
      held.add(e.code);
    }
  };
  const onKeyUp = (e: { code: string }) => {
    held.delete(e.code);
  };
  // Losing focus mid-throttle would otherwise leave the key "held" forever.
  const onBlur = () => held.clear();

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);

  return {
    held,
    dispose() {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", onBlur);
      held.clear();
    },
  };
}
