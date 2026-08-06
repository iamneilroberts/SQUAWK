/*
 * A minimal cancellable countdown, pulled out of FlightSession so the cancellation contract
 * is testable without a DOM: before this fix the COUNTDOWN effect's setInterval was only
 * ever cleared from inside the async IIFE's own (discarded) return value, so a bundle
 * replacement mid-countdown (attachTerrain resolving after TAKE CONTROLS) re-ran the effect
 * without ever cancelling the first timer or disposing the first keyboard listener.
 */
export function createCountdownTimer(
  from: number,
  onTick: (remaining: number) => void,
  onDone: () => void,
  intervalMs = 1000,
): { cancel(): void } {
  let remaining = from;
  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      onTick(remaining);
      return;
    }
    clearInterval(timer);
    onDone();
  }, intervalMs);
  return {
    cancel() {
      clearInterval(timer);
    },
  };
}
