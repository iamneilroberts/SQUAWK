import type { Contact } from "../data/types";
import { missionVersions, type LockedMissionView } from "../mission/contract";
import { normalizeHeading } from "../mission/geo";
import { missionProfileForClass } from "../mission/profiles";
import type { AircraftClassId, RunwayAssignment } from "../mission/types";
import { DATA_VERSIONS } from "../shared/versions";
import { loadClassById } from "../sim/params";
import { buildLockedMissionSpawn } from "../takeover/spawn";

/**
 * Free flight (#29): fly a chosen class with NO live ADS-B and NO server call. Like the tutorial
 * this synthesizes the only object the honesty rules allow us to invent — the player's own
 * aircraft — and hand-assembles a locked mission with ZERO fetches. It differs from the tutorial:
 * the spawn is straight-and-level cruise over the HOME location (not a scripted approach), there
 * is no real destination, and it never submits a result. Always SIM, always unranked.
 */

/** Owner default HOME (Mobile AL) — passed in so the builder stays pure and testable. */
export const FREE_FLIGHT_HOME = { latDeg: 30.6944, lonDeg: -88.0399 } as const;

type FreeFlightClassInfo = {
  hex: string;
  flight: string;
  t: string;
  /** Sane default cruise altitude, well inside the class envelope. */
  defaultAltitudeFt: number;
  minAltitudeFt: number;
  maxAltitudeFt: number;
};

/**
 * Per-class identity + altitude bounds. The cruise SPEED is not here — it is read from each
 * class's mission profile (`reachability.defaultPlanningSpeedKt`) so free flight and mission
 * planning stay on one number. Altitude bounds stay below each class's service ceiling; the
 * spawn builder clamps anything past it anyway.
 */
export const FREE_FLIGHT_CLASSES: Record<AircraftClassId, FreeFlightClassInfo> = {
  c172s: { hex: "ff0172", flight: "FREE172", t: "C172", defaultAltitudeFt: 4_500, minAltitudeFt: 1_000, maxAltitudeFt: 13_000 },
  b738: { hex: "ff0738", flight: "FREE738", t: "B738", defaultAltitudeFt: 26_000, minAltitudeFt: 2_000, maxAltitudeFt: 40_000 },
  f5e: { hex: "ff05e0", flight: "FREEF5E", t: "F5", defaultAltitudeFt: 20_000, minAltitudeFt: 2_000, maxAltitudeFt: 50_000 },
  biz: { hex: "ff0b12", flight: "FREEBIZ", t: "C680", defaultAltitudeFt: 24_000, minAltitudeFt: 2_000, maxAltitudeFt: 45_000 },
  tprop: { hex: "ff0b35", flight: "FREETRP", t: "B350", defaultAltitudeFt: 18_000, minAltitudeFt: 1_500, maxAltitudeFt: 34_000 },
  r44: { hex: "ff0044", flight: "FREEHEL", t: "R44", defaultAltitudeFt: 1_000, minAltitudeFt: 200, maxAltitudeFt: 10_000 },
};

/** Stable ids so a free flight is identifiable without a random source in pure tests. */
const MISSION_IDS: Record<AircraftClassId, string> = {
  c172s: "00000000-0000-4000-8000-000000000201",
  b738: "00000000-0000-4000-8000-000000000202",
  f5e: "00000000-0000-4000-8000-000000000203",
  biz: "00000000-0000-4000-8000-000000000204",
  tprop: "00000000-0000-4000-8000-000000000205",
  r44: "00000000-0000-4000-8000-000000000206",
};

export type FreeFlightOptions = {
  altitudeFt: number;
  headingDeg: number;
  /** HOME coordinates; default to the owner HOME so the builder is pure. */
  homeLatDeg?: number;
  homeLonDeg?: number;
  /** Caller-supplied mission id (crypto.randomUUID in the browser); defaults to a stable id. */
  missionId?: string;
};

export function cruiseSpeedKtForClass(classId: AircraftClassId): number {
  return missionProfileForClass(classId).reachability.defaultPlanningSpeedKt;
}

export function clampFreeFlightAltitudeFt(classId: AircraftClassId, altitudeFt: number): number {
  const info = FREE_FLIGHT_CLASSES[classId];
  if (!Number.isFinite(altitudeFt)) return info.defaultAltitudeFt;
  return Math.min(info.maxAltitudeFt, Math.max(info.minAltitudeFt, Math.round(altitudeFt)));
}

/** An inert runway at the spawn point: route/approach chrome has nothing meaningful to draw. */
function inertAssignment(latDeg: number, lonDeg: number, headingDeg: number): RunwayAssignment {
  return {
    airportIdent: "FREE",
    airportName: "FREE FLIGHT",
    airportLatDeg: latDeg,
    airportLonDeg: lonDeg,
    airportElevationFt: 0,
    runwayId: "FREE",
    runwayIdent: "00",
    runwayEndIdent: "00",
    runwayHeadingDeg: headingDeg,
    runwayLengthFt: 5_000,
    runwayWidthFt: 150,
    runwaySurface: "HARD",
    runwayLighted: false,
    assignedEnd: {
      ident: "00",
      latDeg,
      lonDeg,
      elevationFt: 0,
      headingDeg,
      displacedThresholdFt: 0,
    },
    distanceNm: 0,
    estimatedMinutes: 0,
    suitability: 0,
  };
}

/** Builds a local-only free-flight mission. No function in this path reads traffic, auth, or an API. */
export function buildFreeFlightMission(
  classId: AircraftClassId,
  opts: FreeFlightOptions,
  lockedAt = Date.now(),
): LockedMissionView {
  const info = FREE_FLIGHT_CLASSES[classId];
  const profile = missionProfileForClass(classId);
  const params = loadClassById(classId);
  const homeLatDeg = opts.homeLatDeg ?? FREE_FLIGHT_HOME.latDeg;
  const homeLonDeg = opts.homeLonDeg ?? FREE_FLIGHT_HOME.lonDeg;
  const headingDeg = normalizeHeading(opts.headingDeg);
  const altitudeFt = clampFreeFlightAltitudeFt(classId, opts.altitudeFt);
  const cruiseKt = cruiseSpeedKtForClass(classId);

  // Straight-and-level cruise directly over HOME: alt_geom (ellipsoidal, the terrain datum) so the
  // spawn builder trusts it as-is, gs at the class cruise, no vertical rate.
  const contact: Contact = {
    hex: info.hex,
    flight: info.flight,
    t: info.t,
    lat: homeLatDeg,
    lon: homeLonDeg,
    alt_geom: altitudeFt,
    alt_baro: altitudeFt,
    gs: cruiseKt,
    track: headingDeg,
    baro_rate: 0,
    military: classId === "f5e",
    seen_pos: 0,
  };

  const assignment = inertAssignment(homeLatDeg, homeLonDeg, headingDeg);
  const versions = missionVersions({
    datasetVersion: DATA_VERSIONS.airport,
    profileVersion: profile.profileVersion,
    assignmentVersion: profile.assignmentVersion,
    scoringVersion: profile.scoringVersion,
  });
  // No initialGearDown/flap overrides: retractable gear stays UP (honest airborne cruise); fixed
  // gear stays pinned down by the spawn builder. Clean cruise config, unlike the landing tutorial.
  const spawn = buildLockedMissionSpawn(contact, classId, params, {
    terrainHeightM: null,
  });

  return {
    schemaVersion: 1,
    missionId: opts.missionId ?? MISSION_IDS[classId],
    status: "locked",
    lockedAt,
    leaseExpiresAt: lockedAt + 24 * 60 * 60 * 1_000,
    receipt: `freeflight:${classId}:${profile.profileVersion}`,
    contact,
    traffic: {
      source: null,
      sourceTime: null,
      fetchedAt: null,
      cacheAgeSeconds: null,
      cacheStatus: "MISS",
      regionKey: `freeflight:${classId}`,
      radiusNm: 0,
    },
    classId,
    aircraftProfile: params,
    missionProfile: profile,
    assignment,
    versions,
    assist: "none",
    reconstruction: {
      disclosure: "FREE FLIGHT — LOCAL AND UNRANKED",
      terrainHeightM: null,
      altitudeSource: spawn.altitudeSource,
      verticalRateSource: "barometric",
      state: spawn.state,
      controls: spawn.controls,
      adjustments: spawn.adjustments,
    },
  };
}
