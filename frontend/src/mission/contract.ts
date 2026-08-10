import type { Contact, TrafficCacheStatus } from "../data/types";
import type { SpawnResult } from "../takeover/spawn";
import type { ClassParams } from "../sim/types";
import { MISSION_MAX_ELIGIBLE_CHOICES } from "../shared/limits";
import { DATA_VERSIONS } from "../shared/versions";
import type {
  AircraftClassId,
  MissionAssignmentResult,
  MissionProfile,
  RunwayAssignment,
} from "./types";

export type MissionAssistLevel = "none" | "low" | "medium" | "high";

export type MissionVersionSet = {
  airportDataset: string;
  aircraftProfile: string;
  missionProfile: string;
  assignment: string;
  scoring: string;
  physics: string;
  assistDefinition: string;
};

export type MissionPreviewIdentity = {
  aircraftHex: string;
  aircraftType: string | null;
  classId: AircraftClassId;
  selectedChoiceKey: string;
  eligibleChoiceKeys: string[];
  versions: MissionVersionSet;
};

export type PrepareMissionRequest = {
  aircraftHex: string;
  position: { lat: number; lon: number };
  preview: MissionPreviewIdentity;
};

export type MissionPreparationView = {
  schemaVersion: 1;
  preparationToken: string;
  preparationId: string;
  issuedAt: number;
  expiresAt: number;
  contact: Contact;
  traffic: MissionTrafficProvenance;
  classId: AircraftClassId;
  selected: RunwayAssignment;
  eligibleChoices: RunwayAssignment[];
  versions: MissionVersionSet;
  fingerprint: string;
};

export type MissionPreparationData = {
  preparation: MissionPreparationView;
};

export type LockMissionRequest = {
  preparationToken: string;
  choiceKey: string;
  assist: MissionAssistLevel;
};

export type MissionReconstruction = {
  disclosure: string;
  terrainHeightM: null;
  altitudeSource: SpawnResult["altitudeSource"];
  verticalRateSource: "barometric" | "reconstructed-zero";
  state: SpawnResult["state"];
  controls: SpawnResult["controls"];
  adjustments: SpawnResult["adjustments"];
};

export type MissionTrafficProvenance = {
  source: string | null;
  sourceTime: number | null;
  fetchedAt: number | null;
  cacheAgeSeconds: number | null;
  cacheStatus: TrafficCacheStatus;
  regionKey: string;
  radiusNm: number;
};

export type LockedMissionDocument = {
  schemaVersion: 2;
  preparationId: string;
  idempotencyKey: string;
  lockRequestDigest: string;
  contact: Contact;
  traffic: MissionTrafficProvenance;
  classId: AircraftClassId;
  aircraftProfile: ClassParams;
  missionProfile: MissionProfile;
  assignment: RunwayAssignment;
  versions: MissionVersionSet;
  assist: MissionAssistLevel;
  reconstruction: MissionReconstruction;
  preparedAt: number;
  lockedAt: number;
};

export type MissionReceiptPayload = {
  schemaVersion: 1;
  purpose: "mission-receipt";
  missionId: string;
  aircraftHex: string;
  choiceKey: string;
  lockedAt: number;
  expiresAt: number;
  versions: MissionVersionSet;
};

export type LockedMissionView = {
  schemaVersion: 1;
  missionId: string;
  status: "locked";
  lockedAt: number;
  leaseExpiresAt: number;
  receipt: string;
  contact: Contact;
  traffic: MissionTrafficProvenance;
  classId: AircraftClassId;
  assignment: RunwayAssignment;
  versions: MissionVersionSet;
  assist: MissionAssistLevel;
  reconstruction: MissionReconstruction;
};

export type MissionPreparationPayload = Omit<
  MissionPreparationView,
  "preparationToken"
> & {
  purpose: "mission-preparation";
  userId: string;
};

export function missionChoiceKey(assignment: RunwayAssignment): string {
  return `${assignment.airportIdent}:${assignment.runwayId}:${assignment.runwayEndIdent}`;
}

export function boundedMissionChoices(
  assignment: Extract<MissionAssignmentResult, { assigned: true }>,
): RunwayAssignment[] {
  return [assignment.best, ...assignment.alternatives].slice(
    0,
    MISSION_MAX_ELIGIBLE_CHOICES,
  );
}

export function missionVersions(options: {
  datasetVersion: string;
  profileVersion: string;
  assignmentVersion: string;
  scoringVersion: string;
}): MissionVersionSet {
  return {
    airportDataset: options.datasetVersion,
    aircraftProfile: DATA_VERSIONS.aircraftProfile,
    missionProfile: options.profileVersion,
    assignment: options.assignmentVersion,
    scoring: options.scoringVersion,
    physics: DATA_VERSIONS.physics,
    assistDefinition: DATA_VERSIONS.assistDefinition,
  };
}

export function missionPreviewIdentity(options: {
  contact: Pick<Contact, "hex" | "t">;
  classId: AircraftClassId;
  assignment: Extract<MissionAssignmentResult, { assigned: true }>;
  selected: RunwayAssignment;
}): MissionPreviewIdentity {
  return {
    aircraftHex: options.contact.hex.toLowerCase(),
    aircraftType: options.contact.t,
    classId: options.classId,
    selectedChoiceKey: missionChoiceKey(options.selected),
    eligibleChoiceKeys: boundedMissionChoices(options.assignment).map(missionChoiceKey),
    versions: missionVersions({
      datasetVersion: options.assignment.datasetVersion,
      profileVersion: options.assignment.profileVersion,
      assignmentVersion: options.assignment.assignmentVersion,
      scoringVersion: options.assignment.scoringVersion,
    }),
  };
}

export function missionPreviewFingerprint(preview: MissionPreviewIdentity): string {
  return JSON.stringify([
    preview.aircraftHex,
    preview.aircraftType,
    preview.classId,
    preview.selectedChoiceKey,
    preview.eligibleChoiceKeys,
    preview.versions,
  ]);
}
