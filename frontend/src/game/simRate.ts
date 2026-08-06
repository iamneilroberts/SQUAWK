/*
 * How much sim time we managed per second of wall time, over a rolling window. When the
 * accumulator clamps (a slow machine, a backgrounded tab), this is what turns the shortfall
 * into an honest "SIM RATE 0.7x" on the HUD instead of a silent slow-motion flight.
 */
export function createRateMeter(windowS = 2): {
  record(simSecondsAdvanced: number, wallSeconds: number): void;
  rate(): number;
} {
  const samples: Array<{ sim: number; wall: number }> = [];
  let simSum = 0;
  let wallSum = 0;

  return {
    record(simSecondsAdvanced, wallSeconds) {
      if (!Number.isFinite(wallSeconds) || wallSeconds <= 0) return;
      samples.push({ sim: simSecondsAdvanced, wall: wallSeconds });
      simSum += simSecondsAdvanced;
      wallSum += wallSeconds;
      while (wallSum > windowS && samples.length > 1) {
        const oldest = samples.shift()!;
        simSum -= oldest.sim;
        wallSum -= oldest.wall;
      }
    },
    rate() {
      if (wallSum <= 0) return 1; // nothing measured yet is not a slowdown
      return simSum / wallSum;
    },
  };
}
