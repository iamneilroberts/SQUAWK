/*
 * Player-chosen SIM callsign (issue #20). Ground rule 2 pins the synthetic callsign's shape to
 * `SIM-<hex>` — that stays the default. Picking a preset swaps the hex suffix for a curated
 * word (`SIM-<PRESET>`), keeping the SIM prefix so the callsign is still unmistakably synthetic.
 * Presets are plain words, never real-world flight-number shapes (letters+digits like AAL123),
 * so a chosen callsign can't be confused with a genuine feed contact — no uniqueness check
 * against the live feed is needed. No free-type in v1: an open-ended string could accidentally
 * mimic a real callsign, which the picker itself is meant to rule out.
 */
import { formatCallsign } from "../hud/format";

export const CALLSIGN_PRESETS: readonly string[] = [
  "MAVERICK",
  "GOOSE",
  "ICEMAN",
  "VIPER",
  "HOTSHOT",
  "ROOSTER",
  "WILDCARD",
  "MOOSE",
  "BANANA-1",
  "TUMBLEWEED",
];

/** `preset` is `null` for the default, or one of `CALLSIGN_PRESETS`; anything else falls back
 *  to the default rather than letting an unrecognized value through. */
export function resolveCallsign(hex: string, preset: string | null): string {
  if (preset !== null && CALLSIGN_PRESETS.includes(preset)) {
    return `SIM-${preset}`;
  }
  return formatCallsign(hex);
}
