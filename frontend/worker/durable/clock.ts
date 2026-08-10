export type Clock = {
  nowMs: () => number;
};

export const systemClock: Clock = {
  nowMs: () => Date.now(),
};

export class FakeClock implements Clock {
  #nowMs: number;

  constructor(nowMs: number) {
    assertTime(nowMs);
    this.#nowMs = nowMs;
  }

  nowMs(): number {
    return this.#nowMs;
  }

  set(nowMs: number): void {
    assertTime(nowMs);
    this.#nowMs = nowMs;
  }

  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new TypeError("Clock advance must be a non-negative finite number");
    }
    this.set(this.#nowMs + milliseconds);
  }
}

function assertTime(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError("Clock time must be a non-negative safe integer");
  }
}
