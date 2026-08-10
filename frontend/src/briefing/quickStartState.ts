export const QUICK_START_VERSION = 1;
export const QUICK_START_STORAGE_KEY = "adsb.quick-start.version";

export type StorageReader = Pick<Storage, "getItem">;
export type StorageWriter = Pick<Storage, "setItem">;

export function isQuickStartDismissed(storage: StorageReader): boolean {
  return storage.getItem(QUICK_START_STORAGE_KEY) === String(QUICK_START_VERSION);
}

export function dismissQuickStart(storage: StorageWriter): void {
  storage.setItem(QUICK_START_STORAGE_KEY, String(QUICK_START_VERSION));
}

export function shouldShowQuickStart(storage: StorageReader | null): boolean {
  if (storage === null) return true;
  try {
    return !isQuickStartDismissed(storage);
  } catch {
    return true;
  }
}
