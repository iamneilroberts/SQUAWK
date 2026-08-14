export const HEADING_TO_FAF_STORAGE_KEY = "adsb.handoff-heading-to-faf.v1";

export type StorageReader = Pick<Storage, "getItem">;
export type StorageWriter = Pick<Storage, "setItem">;

/** Default ON: only an explicit "off" disables it. */
export function shouldFaceApproach(storage: StorageReader | null): boolean {
  if (storage === null) return true;
  try {
    return storage.getItem(HEADING_TO_FAF_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setFaceApproach(storage: StorageWriter, enabled: boolean): void {
  storage.setItem(HEADING_TO_FAF_STORAGE_KEY, enabled ? "on" : "off");
}
