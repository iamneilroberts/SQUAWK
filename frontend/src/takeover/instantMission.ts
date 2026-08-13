import type { Contact } from "../data/types";
import type { Airport } from "../data/airports";
import { bearingDeg, rangeNm } from "../dashboard/geoRange";
import { missionVersions, type LockedMissionView } from "../mission/contract";
import { missionProfileForClass } from "../mission/profiles";
import type { RunwayAssignment } from "../mission/types";
import { DATA_VERSIONS } from "../shared/versions";
import { loadClassById } from "../sim/params";
import { resolveClass } from "./eligibility";
import { buildLockedMissionSpawn } from "./spawn";

/**
 * B2 — instant anonymous flight (fly-first / sign-in-later). Takes over a REAL live contact with
 * NO server lock, auth, or fetch, and hands back a SIM, unranked LockedMissionView. It is the
 * anonymous sibling of `buildFreeFlightMission`: same local, zero-fetch assembly, but the aircraft
 * identity and start state are the genuine contact's (we synthesize only the player's spawn copy,
 * per the honesty rules) and the destination is the nearest bundled airport instead of an inert
 * marker. Class is inferred from the real type designator; the caller must have already passed the
 * takeover eligibility gate.
 */

export type InstantMissionOptions = {
  /** Caller-supplied mission id (crypto.randomUUID in the browser); defaults to a stable id. */
  missionId?: string;
};

/** Stable default id so a pure test needs no random source. */
const DEFAULT_INSTANT_MISSION_ID = "00000000-0000-4000-8000-000000000301";

/** Nearest airport to a point from the bundled world index. */
function nearestAirport(latDeg: number, lonDeg: number, airports: Airport[]): Airport | null {
  let best: Airport | null = null;
  let bestRangeNm = Infinity;
  for (const airport of airports) {
    const r = rangeNm(latDeg, lonDeg, airport.latDeg, airport.lonDeg);
    if (r < bestRangeNm) {
      bestRangeNm = r;
      best = airport;
    }
  }
  return best;
}

/**
 * A destination pointing at the real nearest airport. The bundled world index is runway-free, so
 * this is a nav TARGET, not a scored approach: the heading is the inbound bearing (contact ->
 * airport) so the HUD director and route line point sanely, elevation is unknown (0), and it is
 * never scored (instant flights are unranked).
 */
function airportAssignment(contact: Contact, airport: Airport): RunwayAssignment {
  const distanceNm = rangeNm(contact.lat, contact.lon, airport.latDeg, airport.lonDeg);
  const inboundBearingDeg = bearingDeg(contact.lat, contact.lon, airport.latDeg, airport.lonDeg);
  return {
    airportIdent: airport.ident,
    airportName: airport.name,
    airportLatDeg: airport.latDeg,
    airportLonDeg: airport.lonDeg,
    airportElevationFt: null,
    runwayId: airport.ident,
    runwayIdent: "--",
    runwayEndIdent: "--",
    runwayHeadingDeg: inboundBearingDeg,
    runwayLengthFt: 0,
    runwayWidthFt: 0,
    runwaySurface: "HARD",
    runwayLighted: false,
    assignedEnd: {
      ident: "--",
      latDeg: airport.latDeg,
      lonDeg: airport.lonDeg,
      elevationFt: 0,
      headingDeg: inboundBearingDeg,
      displacedThresholdFt: 0,
    },
    distanceNm,
    estimatedMinutes: 0,
    suitability: 0,
  };
}

export function buildInstantMission(
  contact: Contact,
  airports: Airport[],
  opts: InstantMissionOptions = {},
  lockedAt = Date.now(),
): LockedMissionView {
  const resolution = resolveClass(contact);
  if (!resolution.supported) {
    throw new Error(`instant flight: unsupported contact (${resolution.reason})`);
  }
  const classId = resolution.classId;
  const airport = nearestAirport(contact.lat, contact.lon, airports);
  if (!airport) throw new Error("instant flight: no airports available for a destination");

  const profile = missionProfileForClass(classId);
  const params = loadClassById(classId);
  const assignment = airportAssignment(contact, airport);
  const versions = missionVersions({
    datasetVersion: DATA_VERSIONS.airport,
    profileVersion: profile.profileVersion,
    assignmentVersion: profile.assignmentVersion,
    scoringVersion: profile.scoringVersion,
  });
  // Spawn the player's SIM aircraft from the real contact (no terrain sample in this pure path;
  // the spawn builder trusts alt_geom as the ellipsoidal datum, same as free flight).
  const spawn = buildLockedMissionSpawn(contact, classId, params, { terrainHeightM: null });

  return {
    schemaVersion: 1,
    missionId: opts.missionId ?? DEFAULT_INSTANT_MISSION_ID,
    status: "locked",
    lockedAt,
    leaseExpiresAt: lockedAt + 24 * 60 * 60 * 1_000,
    receipt: `instant:${classId}:${profile.profileVersion}`,
    contact,
    traffic: {
      source: null,
      sourceTime: null,
      fetchedAt: null,
      cacheAgeSeconds: null,
      cacheStatus: "MISS",
      regionKey: `instant:${classId}`,
      radiusNm: 0,
    },
    classId,
    aircraftProfile: params,
    missionProfile: profile,
    assignment,
    versions,
    assist: "none",
    reconstruction: {
      disclosure: "INSTANT FLIGHT — LOCAL AND UNRANKED",
      terrainHeightM: null,
      altitudeSource: spawn.altitudeSource,
      verticalRateSource: "barometric",
      state: spawn.state,
      controls: spawn.controls,
      adjustments: spawn.adjustments,
    },
  };
}
