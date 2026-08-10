import { useCallback, useEffect, useRef, useState } from "react";
import type { Contact, FeedStatus } from "../data/types";
import { loadAirportRegion, type AirportAssetSource } from "../mission/airportData";
import { assignMission } from "../mission/assignment";
import { missionProfileForClass } from "../mission/profiles";
import type {
  AircraftClassId,
  MissionAirport,
  MissionAssignmentResult,
  MissionProfile,
  MissionStartSnapshot,
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

const browserAirportSource: AirportAssetSource = {
  fetch(path) {
    return fetch(path, { cache: "force-cache" });
  },
};

function numericBarometricAltitude(contact: Contact): number | null {
  return typeof contact.alt_baro === "number" ? contact.alt_baro : null;
}

export function missionSnapshotFromContact(contact: Contact): MissionStartSnapshot {
  const altitudeFt = contact.alt_geom ?? numericBarometricAltitude(contact);
  if (altitudeFt === null || contact.gs === null || contact.track === null) {
    throw new TypeError("eligible contact is missing mission snapshot fields");
  }
  return {
    latDeg: contact.lat,
    lonDeg: contact.lon,
    altitudeFt,
    groundSpeedKt: contact.gs,
    trackDeg: contact.track,
  };
}

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

export function missionSearchRadiusNm(snapshot: MissionStartSnapshot, profile: MissionProfile): number {
  const speedKt = Math.max(
    profile.reachability.minPlanningSpeedKt,
    Math.min(profile.reachability.maxPlanningSpeedKt, snapshot.groundSpeedKt),
  );
  return speedKt * profile.reachability.maxMinutes / 60;
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
    airports: options.airports,
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
  return {
    status: "ready",
    contact: options.contact,
    classId: options.classId,
    profile,
    assignment,
    selected: assignment.best,
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
  return `${assignment.airportIdent}:${assignment.runwayId}:${assignment.runwayEndIdent}`;
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
