/*
 * Session modes (spec §3, parent spec §5), as a table rather than a pile of ifs.
 *
 *   BROWSE --TAKE_CONTROLS--> COUNTDOWN --COUNTDOWN_DONE--> FLYING --IMPACT--> ENDED
 *      ^                          |  COUNTDOWN_ABORT / QUIT    | PAUSE ^ RESUME    |
 *      |                          v                            v      |           |
 *      +--------------------------+------------------------ PAUSED ---+  EXIT_END -+
 *
 * An illegal event returns the current mode unchanged instead of throwing: these events
 * come from user input and async callbacks that can race (a terrain impact resolving one
 * frame after QUIT), and a race should be a no-op, not a crash.
 */
export type Mode = "BROWSE" | "COUNTDOWN" | "FLYING" | "PAUSED" | "ENDED";

export type GameEvent =
  | "TAKE_CONTROLS"
  | "COUNTDOWN_DONE"
  | "COUNTDOWN_ABORT"
  | "PAUSE"
  | "RESUME"
  | "IMPACT"
  | "QUIT"
  | "EXIT_END";

const TABLE: Record<Mode, Partial<Record<GameEvent, Mode>>> = {
  BROWSE: { TAKE_CONTROLS: "COUNTDOWN" },
  COUNTDOWN: { COUNTDOWN_DONE: "FLYING", COUNTDOWN_ABORT: "BROWSE", QUIT: "BROWSE" },
  FLYING: { PAUSE: "PAUSED", IMPACT: "ENDED", QUIT: "BROWSE" },
  PAUSED: { RESUME: "FLYING", QUIT: "BROWSE" },
  ENDED: { EXIT_END: "BROWSE" },
};

export function canFire(from: Mode, event: GameEvent): boolean {
  return TABLE[from][event] !== undefined;
}

export function nextMode(from: Mode, event: GameEvent): Mode {
  return TABLE[from][event] ?? from;
}
