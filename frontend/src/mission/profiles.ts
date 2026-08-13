import c172sRaw from "./profiles/c172s.json";
import b738Raw from "./profiles/b738.json";
import f5eRaw from "./profiles/f5e.json";
import bizRaw from "./profiles/biz.json";
import type { AircraftClassId, MissionProfile } from "./types";

function assertFinitePositive(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
}

function assertFiniteNonNegative(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function validateMissionProfile(value: unknown): MissionProfile {
  if (typeof value !== "object" || value === null) throw new Error("mission profile must be an object");
  const profile = value as MissionProfile;
  if (!(["c172s", "b738", "f5e", "biz", "tprop"] as const).includes(profile.classId)) throw new Error("invalid mission class");
  for (const [label, version] of [
    ["profileVersion", profile.profileVersion],
    ["assignmentVersion", profile.assignmentVersion],
    ["scoringVersion", profile.scoringVersion],
  ] as const) {
    if (typeof version !== "string" || version.length < 3 || version.length > 48) throw new Error(`${label} is invalid`);
  }
  assertFinitePositive(profile.reachability?.maxMinutes, "reachability.maxMinutes");
  assertFiniteNonNegative(profile.reachability?.minDestinationNm, "reachability.minDestinationNm");
  assertFinitePositive(profile.reachability?.defaultPlanningSpeedKt, "reachability.defaultPlanningSpeedKt");
  assertFinitePositive(profile.reachability?.minPlanningSpeedKt, "reachability.minPlanningSpeedKt");
  assertFinitePositive(profile.reachability?.maxPlanningSpeedKt, "reachability.maxPlanningSpeedKt");
  if (profile.reachability.maxMinutes > 30) throw new Error("reachability.maxMinutes exceeds the product cap");
  if (profile.reachability.minPlanningSpeedKt > profile.reachability.defaultPlanningSpeedKt ||
      profile.reachability.defaultPlanningSpeedKt > profile.reachability.maxPlanningSpeedKt) {
    throw new Error("planning speed bounds are inconsistent");
  }
  assertFinitePositive(profile.runway?.minLengthFt, "runway.minLengthFt");
  assertFinitePositive(profile.runway?.minWidthFt, "runway.minWidthFt");
  assertFinitePositive(profile.runway?.maxAirportElevationFt, "runway.maxAirportElevationFt");
  assertFinitePositive(profile.runway?.maxInitialHeadingDeltaDeg, "runway.maxInitialHeadingDeltaDeg");
  if (profile.runway.maxInitialHeadingDeltaDeg > 180) throw new Error("runway.maxInitialHeadingDeltaDeg exceeds 180");
  const airportSizes = new Set(["small", "medium", "large"]);
  const surfaces = new Set(["HARD", "GRAVEL", "GRASS", "DIRT", "SAND", "WATER", "SNOW_ICE", "OTHER"]);
  if (!Array.isArray(profile.runway.airportSizes) || profile.runway.airportSizes.length === 0 ||
      profile.runway.airportSizes.some((value) => !airportSizes.has(value))) throw new Error("runway.airportSizes is invalid");
  if (!Array.isArray(profile.runway.surfaces) || profile.runway.surfaces.length === 0 ||
      profile.runway.surfaces.some((value) => !surfaces.has(value))) throw new Error("runway.surfaces is invalid");
  const rankingNames = ["lengthMarginWeight", "widthMarginWeight", "lightedBonus", "hardSurfaceBonus", "minutePenalty"] as const;
  if (Object.keys(profile.ranking ?? {}).sort().join(",") !== [...rankingNames].sort().join(",")) throw new Error("ranking fields are invalid");
  for (const label of rankingNames) assertFiniteNonNegative(profile.ranking[label], `ranking.${label}`);
  const guidanceNames = [
    "approachLengthNm", "corridorWidthFt", "gateSpacingNm", "glideSlopeDeg", "flareHeightFt",
  ] as const;
  if (Object.keys(profile.guidance ?? {}).sort().join(",") !== [...guidanceNames].sort().join(",")) {
    throw new Error("guidance fields are invalid");
  }
  for (const label of guidanceNames) assertFinitePositive(profile.guidance[label], `guidance.${label}`);
  if (profile.guidance.gateSpacingNm > profile.guidance.approachLengthNm) {
    throw new Error("guidance gate spacing exceeds approach length");
  }
  if (profile.guidance.glideSlopeDeg >= 15) throw new Error("guidance glide slope is invalid");
  const landingNames = [
    "requireGearDown", "maxSinkRateFpm", "maxAbsBankDeg", "minPitchDeg", "maxPitchDeg",
    "minTouchdownSpeedKt", "maxTouchdownSpeedKt", "maxLoadFactor", "maxRolloutCrossTrackFt",
  ] as const;
  if (Object.keys(profile.landing ?? {}).sort().join(",") !== [...landingNames].sort().join(",")) throw new Error("landing fields are invalid");
  if (typeof profile.landing.requireGearDown !== "boolean") throw new Error("landing.requireGearDown is invalid");
  for (const label of landingNames.filter((name) => name !== "requireGearDown" && name !== "minPitchDeg")) {
    assertFiniteNonNegative(profile.landing[label], `landing.${label}`);
  }
  if (typeof profile.landing.minPitchDeg !== "number" || !Number.isFinite(profile.landing.minPitchDeg)) {
    throw new Error("landing.minPitchDeg is invalid");
  }
  if (profile.landing.minPitchDeg >= profile.landing.maxPitchDeg ||
      profile.landing.minTouchdownSpeedKt >= profile.landing.maxTouchdownSpeedKt) {
    throw new Error("landing bounds are inconsistent");
  }
  const curveNames = [
    "verticalSpeedFpm", "centerlineErrorFt", "touchdownZoneFt", "headingErrorDeg",
    "speedErrorKt", "bankDeg", "rolloutCrossTrackFt",
  ] as const;
  if (Object.keys(profile.scoreCurves ?? {}).sort().join(",") !== [...curveNames].sort().join(",")) {
    throw new Error("score curve set is invalid");
  }
  for (const curve of curveNames.map((name) => profile.scoreCurves[name])) {
    if (!Array.isArray(curve) || curve.length < 2) throw new Error("each score curve needs at least two points");
    for (let index = 0; index < curve.length; index += 1) {
      const point = curve[index];
      if (!Number.isFinite(point.value) || !Number.isFinite(point.score) || point.score < 0 || point.score > 1) {
        throw new Error("score curve point is invalid");
      }
      if (index > 0 && point.value <= curve[index - 1].value) throw new Error("score curve values must increase");
      if (index > 0 && point.score > curve[index - 1].score) throw new Error("score curve scores must not increase");
    }
  }
  return profile;
}

const profiles: Record<AircraftClassId, MissionProfile> = {
  c172s: deepFreeze(validateMissionProfile(c172sRaw)),
  b738: deepFreeze(validateMissionProfile(b738Raw)),
  f5e: deepFreeze(validateMissionProfile(f5eRaw)),
  biz: deepFreeze(validateMissionProfile(bizRaw)),
};

export function missionProfileForClass(classId: AircraftClassId): MissionProfile {
  return profiles[classId];
}

export function allMissionProfiles(): MissionProfile[] {
  return [profiles.c172s, profiles.b738, profiles.f5e, profiles.biz];
}
