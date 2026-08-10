import type { Contact } from "../data/types";
import type { MissionProfile, MissionStartSnapshot } from "./types";

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

export function missionSearchRadiusNm(
  snapshot: MissionStartSnapshot,
  profile: MissionProfile,
): number {
  const speedKt = Math.max(
    profile.reachability.minPlanningSpeedKt,
    Math.min(profile.reachability.maxPlanningSpeedKt, snapshot.groundSpeedKt),
  );
  return speedKt * profile.reachability.maxMinutes / 60;
}
