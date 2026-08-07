/*
 * The ~10 Hz bridge between the 60 Hz sim and React. Sim state lives in a mutable ref
 * inside the flight loop; pushing it through zustand at 60 Hz would re-render the tree 60
 * times a second (spec §3). This is a plain observable snapshot instead, shaped for
 * useSyncExternalStore: `get()` returns a stable reference until `set()` replaces it.
 */
export type HudSnapshot = {
  iasMs: number;
  tasMs: number;
  altitudeM: number;
  verticalSpeedMs: number;
  headingRad: number;
  /** Nose above the local horizontal, radians. Positive = nose up. Attitude indicator. */
  pitchRad: number;
  /** Right wing down, radians. Positive = right wing down. Attitude indicator. */
  rollRad: number;
  /**
   * Rate of heading change about the LOCAL VERTICAL, rad/s. Positive = turning right.
   * Not `rates.z`: body yaw rate is only the rate of turn when the wings are level.
   * Turn coordinator.
   */
  turnRateRadS: number;
  /**
   * Sideslip angle, radians. Drives the slip ball — in this model the only lateral specific
   * force is q*S*cyBeta*beta, so beta IS the ball (decisions.md CD-002). Not an accelerometer.
   */
  sideslipRad: number;
  /** Own geodetic position — the radar scope and the windscreen tags measure range from it. */
  latDeg: number;
  lonDeg: number;
  aoaRad: number;
  loadFactor: number;
  throttle: number;
  /** Elevator trim, [-1, 1], positive = nose-up. Drives the cockpit control-state readout. */
  trim: number;
  flapLabel: string;
  gear: "fixed" | "retractable";
  stalled: boolean;
  overspeed: boolean;
  gLimited: boolean;
  /** Height above the sampled ground, or null when the ground has never been sampled. */
  terrainClearanceM: number | null;
  terrainUnverified: boolean;
  /** Sim seconds per wall second; below ~0.95 the HUD says so out loud. */
  simRate: number;
  airtimeS: number;
  /** Aircraft class shown beside the callsign (parent spec §9), e.g. "C172S". */
  classLabel: string;
  callsign: string;
  modelNote: string;
};

export function createSnapshotStore() {
  let current: HudSnapshot | null = null;
  const listeners = new Set<() => void>();
  return {
    set(s: HudSnapshot | null) {
      current = s;
      for (const fn of listeners) fn();
    },
    get(): HudSnapshot | null {
      return current;
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export const hudSnapshot = createSnapshotStore();
