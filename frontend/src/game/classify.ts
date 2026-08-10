/*
 * Terrain contact always ends the session (parent spec §5); this decides whether it reads
 * LANDED or CRASHED. The spec fixes two of the four gates — sink under 600 fpm and speed
 * under 1.3 Vs — and says "near-level attitude" for the rest. This file makes that concrete
 * (see decisions.md B-010) and the boundaries are pinned by tests so nobody can drift them.
 */
import type { ClassParams, SimState } from "../sim/types";
import { stallSpeedIasMs } from "../sim/forces";
import { hprFromQuat } from "../sim/quat";
import { msToFpm, radToDeg } from "../sim/units";

export type EndKind = "LANDED" | "CRASHED";

export function classificationFromMissionOutcome(
  outcome: "landed" | "crashed" | "invalid",
): EndKind {
  return outcome === "landed" ? "LANDED" : "CRASHED";
}

export type ImpactReading = {
  /** Positive = descending. */
  sinkRateFpm: number;
  pitchDeg: number;
  bankDeg: number;
  iasMs: number;
  /** Stall speed for the flap setting that was actually selected. */
  stallIasMs: number;
};

export const MAX_LANDING_SINK_FPM = 600;
export const MAX_LANDING_BANK_DEG = 10;
/** Asymmetric on purpose: a nose-up flare is a landing, a nose-down arrival is not. */
export const LANDING_PITCH_RANGE_DEG: readonly [number, number] = [-5, 15];
export const LANDING_SPEED_FACTOR = 1.3;

export function classifyEnd(r: ImpactReading): EndKind {
  const [pitchLo, pitchHi] = LANDING_PITCH_RANGE_DEG;
  const gentle = r.sinkRateFpm < MAX_LANDING_SINK_FPM;
  const level = Math.abs(r.bankDeg) <= MAX_LANDING_BANK_DEG &&
    r.pitchDeg >= pitchLo && r.pitchDeg <= pitchHi;
  const slow = r.iasMs < LANDING_SPEED_FACTOR * r.stallIasMs;
  return gentle && level && slow ? "LANDED" : "CRASHED";
}

export function readImpact(
  state: SimState,
  params: ClassParams,
  flapIndex: number,
): ImpactReading {
  const hpr = hprFromQuat(state.attitude, state.position);
  return {
    sinkRateFpm: -msToFpm(state.verticalSpeedMs),
    pitchDeg: radToDeg(hpr.pitchRad),
    bankDeg: radToDeg(hpr.rollRad),
    iasMs: state.iasMs,
    stallIasMs: stallSpeedIasMs(params, flapIndex),
  };
}
