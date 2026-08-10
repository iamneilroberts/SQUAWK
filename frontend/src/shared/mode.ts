export const SYSTEM_MODES = ["NORMAL", "READ_ONLY", "KILL_SWITCH"] as const;

export type SystemMode = (typeof SYSTEM_MODES)[number];

const MODE_RANK: Record<SystemMode, number> = {
  NORMAL: 0,
  READ_ONLY: 1,
  KILL_SWITCH: 2,
};

export function isSystemMode(value: unknown): value is SystemMode {
  return typeof value === "string" && SYSTEM_MODES.includes(value as SystemMode);
}

export function mostRestrictiveMode(
  ...modes: Array<SystemMode | undefined>
): SystemMode {
  return modes.reduce<SystemMode>(
    (current, candidate) =>
      candidate !== undefined && MODE_RANK[candidate] > MODE_RANK[current]
        ? candidate
        : current,
    "NORMAL",
  );
}
