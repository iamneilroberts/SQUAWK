import { useCallback, useEffect, useRef, useState } from "react";
import type { Contact, FeedStatus } from "../data/types";
import { loadAirportRegion, type AirportAssetSource } from "../mission/airportData";
import { assignMission } from "../mission/assignment";
import {
  boundedMissionChoices,
  missionChoiceKey,
  missionPreviewIdentity,
  type LockedMissionView,
  type MissionPreparationView,
  type PrepareMissionRequest,
} from "../mission/contract";
import {
  missionSearchRadiusNm,
  missionSnapshotFromContact,
} from "../mission/planning";
import { missionProfileForClass } from "../mission/profiles";
import type {
  AircraftClassId,
  MissionAirport,
  MissionAssignmentResult,
  MissionProfile,
  RunwayAssignment,
} from "../mission/types";
import { checkEligibility, resolveClass } from "../takeover/eligibility";

export type BriefingUnavailableKind =
  | "unsupported"
  | "stale"
  | "provider-down"
  | "no-runway"
  | "data-error";

export type ProvisionalBriefingState =
  | { status: "idle" }
  | { status: "loading"; contact: Contact; classId: AircraftClassId }
  | {
      status: "unavailable";
      contact: Contact;
      kind: BriefingUnavailableKind;
      reason: string;
      classId: AircraftClassId | null;
    }
  | {
      status: "ready";
      contact: Contact;
      classId: AircraftClassId;
      profile: MissionProfile;
      assignment: Extract<MissionAssignmentResult, { assigned: true }>;
      selected: RunwayAssignment;
    };

export type MissionCommitState =
  | { status: "idle" }
  | { status: "preparing" }
  | {
      status: "locking";
      preparation: MissionPreparationView;
      idempotencyKey: string;
    }
  | { status: "locked"; mission: LockedMissionView }
  | {
      status: "error";
      message: string;
      retry?: {
        preparation: MissionPreparationView;
        idempotencyKey: string;
      };
    };

const browserAirportSource: AirportAssetSource = {
  fetch(path) {
    return fetch(path, { cache: "force-cache" });
  },
};

export { missionSearchRadiusNm, missionSnapshotFromContact } from "../mission/planning";

export function briefingPrelude(
  contact: Contact | null,
  feedStatus: FeedStatus,
  providerAvailable: boolean,
): ProvisionalBriefingState {
  if (contact === null) return { status: "idle" };

  const resolved = resolveClass(contact);
  if (!resolved.supported) {
    return {
      status: "unavailable",
      contact,
      kind: "unsupported",
      reason: resolved.reason,
      classId: null,
    };
  }
  if (feedStatus === "offline" || !providerAvailable) {
    return {
      status: "unavailable",
      contact,
      kind: "provider-down",
      reason: "LIVE PROVIDER UNAVAILABLE",
      classId: resolved.classId,
    };
  }
  if (feedStatus === "stale") {
    return {
      status: "unavailable",
      contact,
      kind: "stale",
      reason: "TRAFFIC SNAPSHOT IS STALE",
      classId: resolved.classId,
    };
  }

  const eligibility = checkEligibility(contact);
  if (!eligibility.eligible) {
    return {
      status: "unavailable",
      contact,
      kind: eligibility.reason.startsWith("POSITION STALE") ? "stale" : "unsupported",
      reason: eligibility.reason,
      classId: resolved.classId,
    };
  }
  return { status: "loading", contact, classId: resolved.classId };
}

export function assignContactMission(options: {
  contact: Contact;
  classId: AircraftClassId;
  airports: readonly MissionAirport[];
  datasetVersion: string;
}): ProvisionalBriefingState {
  const profile = missionProfileForClass(options.classId);
  const assignment = assignMission({
    snapshot: missionSnapshotFromContact(options.contact),
    profile,
    datasetVersion: options.datasetVersion,
    airports: options.airports.filter((airport) => /^[A-Z0-9]{3,4}$/.test(airport.ident)),
  });
  if (!assignment.assigned) {
    return {
      status: "unavailable",
      contact: options.contact,
      kind: "no-runway",
      reason: "NO ELIGIBLE RUNWAY WITHIN 30 MINUTES",
      classId: options.classId,
    };
  }
  const choices = boundedMissionChoices(assignment);
  const boundedAssignment = {
    ...assignment,
    best: choices[0] ?? assignment.best,
    alternatives: choices.slice(1),
  };
  return {
    status: "ready",
    contact: options.contact,
    classId: options.classId,
    profile,
    assignment: boundedAssignment,
    selected: boundedAssignment.best,
  };
}

async function loadBriefing(
  contact: Contact,
  classId: AircraftClassId,
  source: AirportAssetSource,
): Promise<ProvisionalBriefingState> {
  const profile = missionProfileForClass(classId);
  const snapshot = missionSnapshotFromContact(contact);
  const region = await loadAirportRegion({
    source,
    latDeg: snapshot.latDeg,
    lonDeg: snapshot.lonDeg,
    radiusNm: missionSearchRadiusNm(snapshot, profile),
  });
  return assignContactMission({
    contact,
    classId,
    airports: region.airports,
    datasetVersion: region.manifest.datasetVersion,
  });
}

export function assignmentKey(assignment: RunwayAssignment): string {
  return missionChoiceKey(assignment);
}

export function prepareRequestForBriefing(
  state: Extract<ProvisionalBriefingState, { status: "ready" }>,
): PrepareMissionRequest {
  return {
    aircraftHex: state.contact.hex,
    position: { lat: state.contact.lat, lon: state.contact.lon },
    preview: missionPreviewIdentity({
      contact: state.contact,
      classId: state.classId,
      assignment: state.assignment,
      selected: state.selected,
    }),
  };
}

export function selectBriefingAssignment(
  state: ProvisionalBriefingState,
  key: string,
): ProvisionalBriefingState {
  if (state.status !== "ready") return state;
  const choice = [state.assignment.best, ...state.assignment.alternatives]
    .find((candidate) => assignmentKey(candidate) === key);
  return choice === undefined ? state : { ...state, selected: choice };
}

export function useProvisionalBriefing(options: {
  contact: Contact | null;
  feedStatus: FeedStatus;
  providerAvailable: boolean;
  source?: AirportAssetSource;
}): {
  state: ProvisionalBriefingState;
  selectAssignment(key: string): void;
} {
  const { contact, feedStatus, providerAvailable } = options;
  const [state, setState] = useState<ProvisionalBriefingState>({ status: "idle" });
  const snapshotRef = useRef<{ key: string | null; contact: Contact | null }>({ key: null, contact: null });
  const snapshotKey = contact === null ? null : `${contact.hex}:${feedStatus}:${providerAvailable ? "up" : "down"}`;
  if (snapshotRef.current.key !== snapshotKey) {
    snapshotRef.current = { key: snapshotKey, contact };
  }
  const frozenContact = snapshotRef.current.contact;

  useEffect(() => {
    const prelude = briefingPrelude(frozenContact, feedStatus, providerAvailable);
    setState(prelude);
    if (prelude.status !== "loading") return;

    let current = true;
    void loadBriefing(prelude.contact, prelude.classId, options.source ?? browserAirportSource)
      .then((next) => {
        if (current) setState(next);
      })
      .catch(() => {
        if (!current) return;
        setState({
          status: "unavailable",
          contact: prelude.contact,
          kind: "data-error",
          reason: "AIRPORT DATA UNAVAILABLE",
          classId: prelude.classId,
        });
      });
    return () => {
      current = false;
    };
  }, [frozenContact, feedStatus, providerAvailable, options.source]);

  const selectAssignment = useCallback((key: string) => {
    setState((current) => selectBriefingAssignment(current, key));
  }, []);

  return { state, selectAssignment };
}
