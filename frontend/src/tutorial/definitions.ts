import type { Contact } from "../data/types";
import { missionVersions, type LockedMissionView } from "../mission/contract";
import { destinationPoint, normalizeHeading } from "../mission/geo";
import { missionProfileForClass } from "../mission/profiles";
import type { AircraftClassId, RunwayAssignment } from "../mission/types";
import { DATA_VERSIONS } from "../shared/versions";
import { loadClassById } from "../sim/params";
import { buildLockedMissionSpawn } from "../takeover/spawn";
import type { TutorialLesson } from "./lessons";

export type TutorialDefinition = {
  id: string;
  version: typeof DATA_VERSIONS.tutorial;
  classId: AircraftClassId;
  label: string;
  unranked: true;
  assignment: RunwayAssignment;
  startDistanceNm: number;
  approachSpeedKt: number;
  lessons: readonly TutorialLesson[];
};

export type TutorialRun = {
  definitionId: string;
  version: typeof DATA_VERSIONS.tutorial;
  classId: AircraftClassId;
  unranked: true;
};

export function tutorialRun(definition: TutorialDefinition): TutorialRun {
  return {
    definitionId: definition.id,
    version: definition.version,
    classId: definition.classId,
    unranked: true,
  };
}

const LESSONS: Record<AircraftClassId, readonly TutorialLesson[]> = {
  c172s: [
    { id: "hold", title: "Hold the picture", body: "Use small inputs. Keep the runway centered and the glide gates stacked.", triggerAirtimeS: 2 },
    { id: "configure", title: "Configure early", body: "Set landing flap and keep the approach near 65–70 KT. Confirm fixed gear is down.", triggerAirtimeS: 18 },
    { id: "flare", title: "Eyes down runway", body: "Near the threshold, ease the nose up and reduce power. Do not chase the ground.", triggerAirtimeS: 48 },
  ],
  b738: [
    { id: "hold", title: "Stabilize", body: "Keep runway 11 centered and hold the three-degree path with small corrections.", triggerAirtimeS: 2 },
    { id: "configure", title: "Landing configuration", body: "Extend gear and landing flap early. Target roughly 140–145 KT.", triggerAirtimeS: 24 },
    { id: "flare", title: "Flare and idle", body: "Begin a modest flare near 40 FT and smoothly close the thrust levers.", triggerAirtimeS: 80 },
  ],
  f5e: [
    { id: "hold", title: "Keesler final", body: "You are established for Keesler runway 04. Keep the velocity vector on the runway.", triggerAirtimeS: 2 },
    { id: "configure", title: "Gear and speed", body: "Confirm gear down and stabilize near 160 KT. Avoid abrupt bank close to the ground.", triggerAirtimeS: 20 },
    { id: "flare", title: "Fighter flare", body: "Ease into the flare near 30 FT, close power, and preserve centerline through rollout.", triggerAirtimeS: 58 },
  ],
  // biz has no TUTORIAL_DEFINITIONS entry below (owner 2026-08-13: no tutorial for the class) —
  // this key exists only to satisfy Record<AircraftClassId, ...> and is unreachable.
  biz: [
    { id: "hold", title: "Stabilize", body: "Fly a stabilized approach at target speed with small corrections.", triggerAirtimeS: 2 },
    { id: "configure", title: "Configure early", body: "Extend gear and flaps early; target the class approach speed.", triggerAirtimeS: 20 },
    { id: "flare", title: "Flare and idle", body: "Flare gently near the runway and smoothly close the thrust levers.", triggerAirtimeS: 60 },
  ],
};

function runway(options: {
  airportIdent: string;
  airportName: string;
  airportLatDeg: number;
  airportLonDeg: number;
  airportElevationFt: number;
  runwayId: string;
  runwayIdent: string;
  endIdent: string;
  endLatDeg: number;
  endLonDeg: number;
  endElevationFt: number;
  endHeadingDeg: number;
  displacedThresholdFt: number;
  lengthFt: number;
  widthFt: number;
}): RunwayAssignment {
  return {
    airportIdent: options.airportIdent,
    airportName: options.airportName,
    airportLatDeg: options.airportLatDeg,
    airportLonDeg: options.airportLonDeg,
    airportElevationFt: options.airportElevationFt,
    runwayId: options.runwayId,
    runwayIdent: options.runwayIdent,
    runwayEndIdent: options.endIdent,
    runwayHeadingDeg: options.endHeadingDeg,
    runwayLengthFt: options.lengthFt,
    runwayWidthFt: options.widthFt,
    runwaySurface: "HARD",
    runwayLighted: true,
    assignedEnd: {
      ident: options.endIdent,
      latDeg: options.endLatDeg,
      lonDeg: options.endLonDeg,
      elevationFt: options.endElevationFt,
      headingDeg: options.endHeadingDeg,
      displacedThresholdFt: options.displacedThresholdFt,
    },
    distanceNm: 0,
    estimatedMinutes: 0,
    suitability: 1,
  };
}

export const TUTORIAL_DEFINITIONS: readonly TutorialDefinition[] = [
  {
    id: "landing-c172s-kmob-15",
    version: DATA_VERSIONS.tutorial,
    classId: "c172s",
    label: "LIGHT AIRCRAFT — MOBILE",
    unranked: true,
    assignment: runway({
      airportIdent: "KMOB", airportName: "Mobile Regional Airport",
      airportLatDeg: 30.6912, airportLonDeg: -88.2428, airportElevationFt: 219,
      runwayId: "244782", runwayIdent: "15/33", endIdent: "15",
      endLatDeg: 30.702299, endLonDeg: -88.253998, endElevationFt: 213,
      endHeadingDeg: 144, displacedThresholdFt: 0, lengthFt: 8_502, widthFt: 150,
    }),
    startDistanceNm: 5,
    approachSpeedKt: 68,
    lessons: LESSONS.c172s,
  },
  {
    id: "landing-b738-kmsy-11",
    version: DATA_VERSIONS.tutorial,
    classId: "b738",
    label: "AIRLINER — NEW ORLEANS",
    unranked: true,
    assignment: runway({
      airportIdent: "KMSY", airportName: "Louis Armstrong New Orleans International Airport",
      airportLatDeg: 29.9934, airportLonDeg: -90.258, airportElevationFt: 4,
      runwayId: "245802", runwayIdent: "11/29", endIdent: "11",
      endLatDeg: 29.996599, endLonDeg: -90.2817, endElevationFt: 4,
      endHeadingDeg: 106, displacedThresholdFt: 0, lengthFt: 10_104, widthFt: 150,
    }),
    startDistanceNm: 7,
    approachSpeedKt: 143,
    lessons: LESSONS.b738,
  },
  {
    id: "landing-f5e-kbix-04",
    version: DATA_VERSIONS.tutorial,
    classId: "f5e",
    label: "FIGHTER — KEESLER AFB",
    unranked: true,
    assignment: runway({
      airportIdent: "KBIX", airportName: "Keesler AFB",
      airportLatDeg: 30.4104, airportLonDeg: -88.9244, airportElevationFt: 33,
      runwayId: "241583", runwayIdent: "04/22", endIdent: "04",
      endLatDeg: 30.401899, endLonDeg: -88.931396, endElevationFt: 23,
      endHeadingDeg: 35, displacedThresholdFt: 1_599, lengthFt: 7_630, widthFt: 150,
    }),
    startDistanceNm: 6,
    approachSpeedKt: 160,
    lessons: LESSONS.f5e,
  },
] as const;

const MISSION_IDS: Record<AircraftClassId, string> = {
  c172s: "00000000-0000-4000-8000-000000000101",
  b738: "00000000-0000-4000-8000-000000000102",
  f5e: "00000000-0000-4000-8000-000000000103",
  // Unreachable (see LESSONS.biz above): kept only to satisfy the Record type.
  biz: "00000000-0000-4000-8000-000000000104",
};

export function tutorialDefinitionForClass(classId: AircraftClassId): TutorialDefinition {
  const definition = TUTORIAL_DEFINITIONS.find((candidate) => candidate.classId === classId);
  if (definition === undefined) throw new TypeError(`No tutorial for aircraft class ${classId}`);
  return definition;
}

/** Builds a local-only mission. No function in this path reads traffic, auth, or an API. */
export function buildTutorialMission(
  classId: AircraftClassId,
  lockedAt = Date.now(),
): LockedMissionView {
  const definition = tutorialDefinitionForClass(classId);
  const profile = missionProfileForClass(classId);
  const params = loadClassById(classId);
  const assignment = {
    ...definition.assignment,
    distanceNm: definition.startDistanceNm,
    estimatedMinutes: definition.startDistanceNm / definition.approachSpeedKt * 60,
  };
  const start = destinationPoint(
    assignment.assignedEnd.latDeg,
    assignment.assignedEnd.lonDeg,
    normalizeHeading(assignment.runwayHeadingDeg + 180),
    definition.startDistanceNm,
  );
  const heightAboveThresholdFt = definition.startDistanceNm * 6_076.12 *
    Math.tan(profile.guidance.glideSlopeDeg * Math.PI / 180);
  const altitudeFt = (assignment.assignedEnd.elevationFt ?? assignment.airportElevationFt ?? 0) +
    heightAboveThresholdFt;
  const descentRateFpm = -definition.approachSpeedKt * 6_076.12 / 60 *
    Math.tan(profile.guidance.glideSlopeDeg * Math.PI / 180);
  const contact: Contact = {
    hex: classId === "c172s" ? "f00101" : classId === "b738" ? "f00102" : "f00103",
    flight: classId === "c172s" ? "TRAIN1" : classId === "b738" ? "TRAIN2" : "TRAIN3",
    t: classId === "c172s" ? "C172" : classId === "b738" ? "B738" : "F5",
    lat: start.latDeg,
    lon: start.lonDeg,
    alt_geom: altitudeFt,
    alt_baro: altitudeFt,
    gs: definition.approachSpeedKt,
    track: assignment.runwayHeadingDeg,
    baro_rate: descentRateFpm,
    military: classId === "f5e",
    seen_pos: 0,
  };
  const versions = missionVersions({
    datasetVersion: DATA_VERSIONS.airport,
    profileVersion: profile.profileVersion,
    assignmentVersion: profile.assignmentVersion,
    scoringVersion: profile.scoringVersion,
  });
  const spawn = buildLockedMissionSpawn(contact, classId, params, {
    terrainHeightM: null,
    initialFlapDetent: params.flaps.length - 1,
    initialGearDown: true,
  });
  return {
    schemaVersion: 1,
    missionId: MISSION_IDS[classId],
    status: "locked",
    lockedAt,
    leaseExpiresAt: lockedAt + 24 * 60 * 60 * 1_000,
    receipt: `tutorial:${definition.id}:${definition.version}`,
    contact,
    traffic: {
      source: null,
      sourceTime: null,
      fetchedAt: null,
      cacheAgeSeconds: null,
      cacheStatus: "MISS",
      regionKey: `tutorial:${definition.version}`,
      radiusNm: 0,
    },
    classId,
    aircraftProfile: params,
    missionProfile: profile,
    assignment,
    versions,
    assist: "medium",
    reconstruction: {
      disclosure: `TUTORIAL GENERATED — ${definition.version} — LOCAL AND UNRANKED`,
      terrainHeightM: null,
      altitudeSource: spawn.altitudeSource,
      verticalRateSource: "barometric",
      state: spawn.state,
      controls: spawn.controls,
      adjustments: spawn.adjustments,
    },
  };
}
