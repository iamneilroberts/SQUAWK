import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCountdownTimer } from "./countdownTimer";

describe("createCountdownTimer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ticks down once per interval, then calls onDone instead of ticking to zero", () => {
    const ticks: number[] = [];
    let done = 0;
    createCountdownTimer(
      3,
      (r) => ticks.push(r),
      () => {
        done += 1;
      },
    );
    vi.advanceTimersByTime(3000);
    expect(ticks).toEqual([2, 1]);
    expect(done).toBe(1);
  });

  it("cancel stops further ticks — the leak the FlightSession re-entry bug hinged on", () => {
    const ticks: number[] = [];
    let done = 0;
    const timer = createCountdownTimer(
      3,
      (r) => ticks.push(r),
      () => {
        done += 1;
      },
    );
    vi.advanceTimersByTime(1000);
    timer.cancel();
    vi.advanceTimersByTime(5000);
    expect(ticks).toEqual([2]);
    expect(done).toBe(0);
  });

  it("cancel after completion is a harmless no-op", () => {
    let done = 0;
    const timer = createCountdownTimer(1, () => {}, () => {
      done += 1;
    });
    vi.advanceTimersByTime(1000);
    expect(done).toBe(1);
    expect(() => timer.cancel()).not.toThrow();
  });
});
