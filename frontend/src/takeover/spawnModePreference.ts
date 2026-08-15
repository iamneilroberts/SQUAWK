export const SPAWN_MODE_STORAGE_KEY = "adsb.spawn-mode.v1";
const LEGACY_KEY = "adsb.handoff-heading-to-faf.v1";
export type SpawnMode = "real" | "faceApproach" | "base" | "final";
const MODES: SpawnMode[] = ["real", "faceApproach", "base", "final"];

export function isRepositionMode(mode: SpawnMode): boolean {
  return mode === "base" || mode === "final";
}
export function readSpawnMode(storage: Pick<Storage, "getItem"> | null): SpawnMode {
  if (storage === null) return "faceApproach";
  try {
    const v = storage.getItem(SPAWN_MODE_STORAGE_KEY);
    if (v && (MODES as string[]).includes(v)) return v as SpawnMode;
    const legacy = storage.getItem(LEGACY_KEY);       // migrate #90's boolean
    if (legacy === "off") return "real";
    return "faceApproach";
  } catch { return "faceApproach"; }
}
export function writeSpawnMode(storage: Pick<Storage, "setItem">, mode: SpawnMode): void {
  storage.setItem(SPAWN_MODE_STORAGE_KEY, mode);
}
