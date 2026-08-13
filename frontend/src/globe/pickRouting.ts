/*
 * What a canvas pick should do, decided purely from the current mode. Extracted so ViewerHost's
 * Cesium LEFT_CLICK handler (which can't run headless) reduces to a lookup + dispatch, and the
 * routing itself is a unit test.
 *
 * BROWSE keeps its existing semantics: a pick drives `select` (contact list + briefing flow).
 * FLYING/PAUSED drive a SEPARATE `identify` channel (a compact in-flight callout) — never select,
 * whose browse-only side effects must not fire mid-flight. Any other mode does nothing.
 *
 * `hex` is null — a dismiss — whenever the pick hit empty space OR an unknown/hidden contact
 * (isKnownContact false, e.g. a billboard gated out by showOtherAircraft): a stale or hidden hex
 * must never be identified or selected.
 */
import type { Mode } from "../game/machine";

export type PickAction =
  | { kind: "select"; hex: string | null }
  | { kind: "identify"; hex: string | null }
  | { kind: "none" };

export function resolvePickAction(
  mode: Mode,
  pickedHex: string | null,
  isKnownContact: boolean,
): PickAction {
  const hex = pickedHex !== null && isKnownContact ? pickedHex : null;
  if (mode === "BROWSE") return { kind: "select", hex };
  if (mode === "FLYING" || mode === "PAUSED") return { kind: "identify", hex };
  return { kind: "none" };
}
