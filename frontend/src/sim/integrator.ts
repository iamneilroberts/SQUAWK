/*
 * Fixed 60 Hz physics decoupled from render (parent spec §3). The clamp is the important
 * part: a backgrounded tab or a long stall in the main thread hands us a huge elapsed time,
 * and simulating all of it would either freeze the frame or teleport the aircraft through
 * terrain. We cap at 0.25 s (15 steps) and DROP the excess — the sim honestly falls behind
 * wall time, and game/simRate.ts surfaces that as "SIM RATE 0.7x" instead of hiding it.
 */
export const FIXED_DT = 1 / 60;
export const MAX_FRAME_S = 0.25;
export const MAX_STEPS_PER_FRAME = Math.round(MAX_FRAME_S / FIXED_DT); // 15

export type Accumulator = { carryS: number };

export function createAccumulator(): Accumulator {
  return { carryS: 0 };
}

export function runFixedSteps(
  acc: Accumulator,
  elapsedS: number,
  step: () => void,
): { steps: number; clamped: boolean } {
  if (!Number.isFinite(elapsedS) || elapsedS <= 0) return { steps: 0, clamped: false };
  const clamped = elapsedS > MAX_FRAME_S;
  acc.carryS += clamped ? MAX_FRAME_S : elapsedS;

  let steps = 0;
  while (acc.carryS >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    acc.carryS -= FIXED_DT;
    step();
    steps++;
  }
  // Anything still in the accumulator after the cap is time we are never going to
  // simulate. Throwing it away is what keeps the next frame from spiralling.
  if (steps === MAX_STEPS_PER_FRAME) acc.carryS = 0;
  return { steps, clamped };
}
