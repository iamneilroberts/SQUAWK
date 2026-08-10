import type { TrafficData } from "../../src/data/types";
import { loadAirportRegion, type AirportAssetSource } from "../../src/mission/airportData";
import { assignMission } from "../../src/mission/assignment";
import {
  boundedMissionChoices,
  missionChoiceKey,
  missionPreviewFingerprint,
  missionPreviewIdentity,
  missionVersions,
  type MissionPreparationPayload,
  type MissionPreparationView,
  type PrepareMissionRequest,
} from "../../src/mission/contract";
import { missionProfileForClass } from "../../src/mission/profiles";
import {
  missionSearchRadiusNm,
  missionSnapshotFromContact,
} from "../../src/mission/planning";
import type { AircraftClassId } from "../../src/mission/types";
import {
  checkEligibility,
  MAX_SEEN_POS_S,
  resolveClass,
} from "../../src/takeover/eligibility";
import { MISSION_PREPARATION_TTL_MS } from "../../src/shared/limits";
import { ApiHttpError } from "../http/response";
import { signMissionPreparation } from "./authorization";

const MISSION_AIRPORT_IDENT = /^[A-Z0-9]{3,4}$/;

export type PreparedMission = {
  preparation: MissionPreparationView;
  reconfirmationRequired: boolean;
};

export type PrepareMissionDependencies = {
  now: number;
  uuid: () => string;
  userId: string;
  signingSecret: string;
  traffic: TrafficData;
  request: PrepareMissionRequest;
  airportSource: AirportAssetSource;
};

function eligibleClass(contact: TrafficData["contacts"][number]): AircraftClassId {
  const eligibility = checkEligibility(contact);
  if (!eligibility.eligible) {
    if (contact.seen_pos === null || contact.seen_pos > MAX_SEEN_POS_S) {
      throw new ApiHttpError(
        409,
        "MISSION_AIRCRAFT_STALE",
        "The selected aircraft position is stale",
      );
    }
    throw new ApiHttpError(
      409,
      "MISSION_AIRCRAFT_UNAVAILABLE",
      eligibility.reason,
    );
  }
  const resolved = resolveClass(contact);
  if (!resolved.supported) {
    throw new ApiHttpError(
      409,
      "MISSION_AIRCRAFT_UNAVAILABLE",
      resolved.reason,
    );
  }
  return resolved.classId;
}

export async function prepareAuthoritativeMission(
  options: PrepareMissionDependencies,
): Promise<PreparedMission> {
  if (!options.traffic.providerAvailable || options.traffic.freshness !== "FRESH") {
    throw new ApiHttpError(
      409,
      "MISSION_AIRCRAFT_STALE",
      "A fresh provider snapshot is required to prepare a mission",
    );
  }

  const aircraftHex = options.request.aircraftHex.toLowerCase();
  const sourceContact = options.traffic.contacts.find(
    (candidate) => candidate.hex.toLowerCase() === aircraftHex,
  );
  if (sourceContact === undefined) {
    throw new ApiHttpError(
      409,
      "MISSION_AIRCRAFT_UNAVAILABLE",
      "The selected aircraft is no longer in the fresh traffic snapshot",
    );
  }
  const contact = {
    ...sourceContact,
    seen_pos: sourceContact.seen_pos === null
      ? null
      : sourceContact.seen_pos + (options.traffic.cacheAgeSeconds ?? 0),
  };

  const classId = eligibleClass(contact);
  const profile = missionProfileForClass(classId);
  const snapshot = missionSnapshotFromContact(contact);
  const region = await loadAirportRegion({
    source: options.airportSource,
    latDeg: snapshot.latDeg,
    lonDeg: snapshot.lonDeg,
    radiusNm: missionSearchRadiusNm(snapshot, profile),
  });
  const assignment = assignMission({
    snapshot,
    profile,
    datasetVersion: region.manifest.datasetVersion,
    airports: region.airports.filter((airport) => MISSION_AIRPORT_IDENT.test(airport.ident)),
  });
  if (!assignment.assigned) {
    throw new ApiHttpError(
      409,
      "MISSION_DESTINATION_INVALID",
      "No eligible runway remains for the fresh aircraft snapshot",
    );
  }

  const choices = boundedMissionChoices(assignment);
  const requestedKey = options.request.preview.selectedChoiceKey;
  const selected = choices.find((choice) => missionChoiceKey(choice) === requestedKey) ?? choices[0];
  if (selected === undefined) {
    throw new ApiHttpError(
      409,
      "MISSION_DESTINATION_INVALID",
      "No eligible runway remains for the fresh aircraft snapshot",
    );
  }

  const authoritativeIdentity = missionPreviewIdentity({
    contact,
    classId,
    assignment,
    selected,
  });
  const fingerprint = missionPreviewFingerprint(authoritativeIdentity);
  const issuedAt = options.now;
  const payload: MissionPreparationPayload = {
    schemaVersion: 1,
    purpose: "mission-preparation",
    preparationId: options.uuid(),
    userId: options.userId,
    issuedAt,
    expiresAt: issuedAt + MISSION_PREPARATION_TTL_MS,
    contact,
    traffic: {
      source: options.traffic.source,
      sourceTime: options.traffic.sourceTime,
      fetchedAt: options.traffic.fetchedAt,
      cacheAgeSeconds: options.traffic.cacheAgeSeconds,
      cacheStatus: options.traffic.cacheStatus,
      regionKey: options.traffic.regionKey,
      radiusNm: options.traffic.radiusNm,
    },
    classId,
    selected,
    eligibleChoices: choices,
    versions: missionVersions({
      datasetVersion: assignment.datasetVersion,
      profileVersion: assignment.profileVersion,
      assignmentVersion: assignment.assignmentVersion,
      scoringVersion: assignment.scoringVersion,
    }),
    fingerprint,
  };
  const preparationToken = await signMissionPreparation(payload, options.signingSecret);
  const { purpose: _purpose, userId: _userId, ...view } = payload;
  return {
    preparation: { ...view, preparationToken },
    reconfirmationRequired:
      missionPreviewFingerprint(options.request.preview) !== fingerprint,
  };
}
