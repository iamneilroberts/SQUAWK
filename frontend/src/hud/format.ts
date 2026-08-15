/*
 * The display edge. SI comes in, aviation units go out, and this is the ONLY place that
 * conversion happens for the HUD. Unknown is an em-dash, never a zero — the honest-data
 * rule applies to the player's own instruments too.
 */
import type { HudSnapshot } from "./snapshot";
import type { LightPhase } from "../world/dayNight";
import { msToKt, mToFt, msToFpm, radToDeg } from "../sim/units";
import { gpwsWarningsFor } from "./gpws";

export const EM_DASH = "—";
/** At or above this sim rate the loop is keeping up and says nothing. */
export const SIM_RATE_WARNING = 0.95;

const dash = (v: number | null | undefined): v is null | undefined =>
  v === null || v === undefined || !Number.isFinite(v as number);

export function formatIasKt(ms: number | null): string {
  return dash(ms) ? EM_DASH : String(Math.round(msToKt(ms)));
}
export function formatTasKt(ms: number | null): string {
  return dash(ms) ? EM_DASH : String(Math.round(msToKt(ms)));
}
export function formatAltFt(m: number | null): string {
  return dash(m) ? EM_DASH : String(Math.round(mToFt(m)));
}

/** Signed, rounded to 10 fpm; level flight reads a bare "0". */
export function formatVsiFpm(ms: number | null): string {
  if (dash(ms)) return EM_DASH;
  const fpm = Math.round(msToFpm(ms) / 10) * 10;
  if (fpm === 0) return "0";
  return fpm > 0 ? `+${fpm}` : String(fpm);
}

/** Three digits, 000-359. 359.6 rounds to 360, which is 000, not "360". */
export function formatHeadingDeg(rad: number | null): string {
  if (dash(rad)) return EM_DASH;
  const deg = Math.round(((radToDeg(rad) % 360) + 360) % 360) % 360;
  return String(deg).padStart(3, "0");
}

export function formatAoaDeg(rad: number | null): string {
  return dash(rad) ? EM_DASH : radToDeg(rad).toFixed(1);
}

export function formatG(n: number | null): string {
  if (dash(n)) return EM_DASH;
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

export function formatThrottlePct(t: number | null): string {
  return dash(t) ? EM_DASH : `${Math.round(t * 100)}%`;
}

/** Mach number for the jet EFIS/HUD annunciator, two decimals. Unknown is an em-dash. */
export function formatMach(n: number | null): string {
  return dash(n) ? EM_DASH : n.toFixed(2);
}

/** Flight level (hundreds of feet, three digits) for the airliner altitude tape. */
export function formatFlightLevel(m: number | null): string {
  if (dash(m)) return EM_DASH;
  return `FL${String(Math.round(mToFt(m) / 100)).padStart(3, "0")}`;
}

/**
 * The F-5E's afterburner annunciator (spec §5, a plain dry/wet toggle — no FLCS path). WET is
 * the abnormal/high-energy state the HUD draws in amber; DRY is nominal. Unknown is an em-dash.
 */
export function formatAfterburner(lit: boolean | null): string {
  if (lit === null || lit === undefined) return `A/B ${EM_DASH}`;
  return lit ? "A/B WET" : "A/B DRY";
}

/**
 * Elevator trim as a signed nose-up/down percentage of full authority. Trim is [-1, 1] with
 * positive = nose-up (Period key, spec KEYMAP); centre reads NEUTRAL rather than "0%".
 */
export function formatTrim(t: number | null): string {
  if (dash(t)) return EM_DASH;
  const pct = Math.round(Math.abs(t) * 100);
  if (pct === 0) return "NEUTRAL";
  return t > 0 ? `NOSE UP ${pct}%` : `NOSE DN ${pct}%`;
}

export function formatFlaps(label: string | null): string {
  return `FLAPS ${label ?? EM_DASH}`;
}

/**
 * The 172's gear is fixed; the HUD says so rather than offering a control that does nothing.
 * A retractable class reads its integrated position: fully up/down, or IN TRANSIT between.
 */
export function formatGear(
  gear: "fixed" | "retractable" | null,
  gearPosition: number | null,
): string {
  if (gear === "fixed") return "GEAR FIXED";
  if (gear !== "retractable") return `GEAR ${EM_DASH}`;
  if (gearPosition === null || !Number.isFinite(gearPosition)) return `GEAR ${EM_DASH}`;
  if (gearPosition <= 0) return "GEAR UP";
  if (gearPosition >= 1) return "GEAR DOWN";
  return "GEAR IN TRANSIT";
}

export function formatClearanceFt(m: number | null): string {
  return dash(m) ? EM_DASH : String(Math.round(mToFt(m)));
}

export function formatAirtime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Approach-readout time-to-landing (m:ss). Null (groundspeed ~0) reads as an em-dash, never 0:00. */
export function formatTimeToLandingSec(seconds: number | null): string {
  if (dash(seconds)) return EM_DASH;
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60);
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Null when the sim is keeping up; otherwise the honest multiplier. */
export function formatSimRate(rate: number): string | null {
  if (rate >= SIM_RATE_WARNING) return null;
  return `SIM RATE ${rate.toFixed(1)}×`;
}

export function formatCallsign(hex: string): string {
  return `SIM-${hex.toUpperCase()}`;
}

/**
 * The current sky light phase, uppercase for the HUD (issue #14). "TWILIGHT" covers both dawn
 * and dusk — civil twilight is the same sun-below-the-horizon band either way, and the readout
 * does not claim to know which. A lookup, not a branch, so a new phase is one row here.
 */
const LIGHT_PHASE_LABELS: Record<LightPhase, string> = {
  day: "DAY",
  "civil-twilight": "TWILIGHT",
  night: "NIGHT",
};
export function formatLightPhase(phase: LightPhase | null): string {
  return phase === null ? EM_DASH : `SKY ${LIGHT_PHASE_LABELS[phase]}`;
}

/** Aircraft class beside the callsign (parent spec §9). Em-dash when it is not known. */
export function formatClass(label: string | null): string {
  return label === null || label.length === 0 ? EM_DASH : label.toUpperCase();
}

/**
 * GR-004: the GEAR O'SPD gate. Pure so it is unit-testable without spinning up flightLoop —
 * trips only for a retractable class, with the gear off the fully-up stop, above vle.
 */
export function gearOverspeedFor(
  gear: "fixed" | "retractable",
  gearPositionUnit: number,
  iasMs: number,
  vleIasMs: number,
): boolean {
  return gear === "retractable" && gearPositionUnit > 0 && iasMs > vleIasMs;
}

/**
 * Warnings, most urgent first. The ground-proximity calls (SINK RATE / PULL UP / TERRAIN
 * UNVERIFIED) come from the sink-rate-aware GPWS module (gpws.ts) so desktop and mobile share
 * one source of truth; proximity is never claimed when clearance is unknown.
 */
export function warningsFor(s: HudSnapshot): string[] {
  const out: string[] = [];
  if (s.stalled) out.push("STALL");
  if (s.overspeed) out.push("OVERSPEED");
  if (s.machOverspeed) out.push("MMO");
  if (s.gearOverspeed) out.push("GEAR O'SPD");
  if (s.gLimited) out.push("G LIMIT");
  out.push(...gpwsWarningsFor(s));
  return out;
}
