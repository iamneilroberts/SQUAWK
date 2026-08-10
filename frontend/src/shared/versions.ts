export const API_CONTRACT_VERSION = "v1" as const;

export const DATA_VERSIONS = {
  airport: "v1",
  aircraftProfile: "v1",
  assignment: "v1",
  scoring: "v1",
  assistDefinition: "v1",
  tutorial: "v1",
} as const;

export type DataVersionKey = keyof typeof DATA_VERSIONS;
