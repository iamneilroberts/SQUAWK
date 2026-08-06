/*
 * The numbers on the end card (parent spec §5). Accumulated live during the flight so the
 * card needs nothing but the final state.
 */
import type { SimState } from "../sim/types";
import type { EndKind } from "./classify";
import { msToFpm } from "../sim/units";
import { vLength, vSub } from "../sim/vec3";

export type FlightStats = {
  airtimeS: number;
  distanceM: number;
  maxIasMs: number;
  maxAltitudeM: number;
  maxG: number;
  /** Positive = descending at the moment of contact. */
  impactSinkFpm: number;
  impactIasMs: number;
  classification: EndKind;
};

export function createStatsAccumulator(start: SimState): {
  update(state: SimState): void;
  finish(state: SimState, classification: EndKind): FlightStats;
} {
  const startTimeS = start.timeS;
  let previousPosition = start.position;
  let distanceM = 0;
  let maxIasMs = start.iasMs;
  let maxAltitudeM = start.altitudeM;
  let maxG = start.loadFactor;

  function absorb(state: SimState) {
    // Path length, not displacement — a circuit that lands where it took off flew a distance.
    distanceM += vLength(vSub(state.position, previousPosition));
    previousPosition = state.position;
    if (state.iasMs > maxIasMs) maxIasMs = state.iasMs;
    if (state.altitudeM > maxAltitudeM) maxAltitudeM = state.altitudeM;
    if (state.loadFactor > maxG) maxG = state.loadFactor;
  }

  return {
    update(state) {
      absorb(state);
    },
    finish(state, classification) {
      absorb(state);
      return {
        airtimeS: state.timeS - startTimeS,
        distanceM,
        maxIasMs,
        maxAltitudeM,
        maxG,
        impactSinkFpm: -msToFpm(state.verticalSpeedMs),
        impactIasMs: state.iasMs,
        classification,
      };
    },
  };
}
