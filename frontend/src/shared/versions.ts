export const API_CONTRACT_VERSION = "v1" as const;

export const DATA_VERSIONS = {
  airport: "oa-2026-08-10-v1",
  aircraftProfile: "v1",
  missionProfile: "2026-08-10-v1",
  assignment: "assignment-2026-08-10-v1",
  scoring: "scoring-2026-08-10-v1",
  physics: "physics-2026-08-10-v1",
  assistDefinition: "v1",
  tutorial: "v1",
} as const;

export type DataVersionKey = keyof typeof DATA_VERSIONS;
