import type { AircraftClassId } from "../mission/types";
import { DATA_VERSIONS } from "../shared/versions";

const KEY = "adsb.tutorial-progress.v1";
const CLASSES: readonly AircraftClassId[] = ["c172s", "b738", "f5e"];

export type TutorialProgress = {
  version: typeof DATA_VERSIONS.tutorial;
  started: boolean;
  completedClasses: AircraftClassId[];
};

export const EMPTY_TUTORIAL_PROGRESS: TutorialProgress = {
  version: DATA_VERSIONS.tutorial,
  started: false,
  completedClasses: [],
};

export function loadTutorialProgress(storage: Pick<Storage, "getItem">): TutorialProgress {
  const serialized = storage.getItem(KEY);
  if (serialized === null || serialized.length > 1_024) return EMPTY_TUTORIAL_PROGRESS;
  try {
    const parsed = JSON.parse(serialized) as Partial<TutorialProgress>;
    if (parsed.version !== DATA_VERSIONS.tutorial || typeof parsed.started !== "boolean" ||
      !Array.isArray(parsed.completedClasses)) return EMPTY_TUTORIAL_PROGRESS;
    const completedClasses = parsed.completedClasses.filter(
      (value, index): value is AircraftClassId =>
        CLASSES.includes(value as AircraftClassId) && parsed.completedClasses?.indexOf(value) === index,
    );
    return { version: DATA_VERSIONS.tutorial, started: parsed.started, completedClasses };
  } catch {
    return EMPTY_TUTORIAL_PROGRESS;
  }
}

function save(storage: Pick<Storage, "setItem">, progress: TutorialProgress): TutorialProgress {
  storage.setItem(KEY, JSON.stringify(progress));
  return progress;
}

export function markTutorialStarted(
  storage: Pick<Storage, "getItem" | "setItem">,
): TutorialProgress {
  return save(storage, { ...loadTutorialProgress(storage), started: true });
}

export function markTutorialCompleted(
  storage: Pick<Storage, "getItem" | "setItem">,
  classId: AircraftClassId,
): TutorialProgress {
  const current = loadTutorialProgress(storage);
  return save(storage, {
    version: DATA_VERSIONS.tutorial,
    started: true,
    completedClasses: current.completedClasses.includes(classId)
      ? current.completedClasses
      : [...current.completedClasses, classId],
  });
}
