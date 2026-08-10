import { greatCircleDistanceNm, headingDeltaDeg, initialBearingDeg, normalizeHeading } from "./geo";
import type {
  MissionAirport,
  MissionAssignmentResult,
  MissionProfile,
  MissionStartSnapshot,
  Runway,
  RunwayAssignment,
  RunwayEnd,
} from "./types";

const BOUNDARY_EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function runwayIdent(runway: Runway): string {
  const ends = [runway.lowEnd?.ident, runway.highEnd?.ident].filter((value): value is string => value !== null && value !== undefined);
  return ends.length > 0 ? ends.join("/") : runway.id;
}

function completeEnd(end: RunwayEnd | null): end is RunwayEnd & { ident: string; latDeg: number; lonDeg: number; headingDeg: number } {
  return end !== null && end.ident !== null && end.latDeg !== null && end.lonDeg !== null && end.headingDeg !== null;
}

function suitableRunway(runway: Runway, airport: MissionAirport, profile: MissionProfile): boolean {
  const gate = profile.runway;
  if (runway.closed || runway.lengthFt === null || runway.widthFt === null) return false;
  if (runway.lengthFt < gate.minLengthFt || runway.widthFt < gate.minWidthFt) return false;
  if (!gate.surfaces.includes(runway.surface)) return false;
  if (gate.requireLighted && !runway.lighted) return false;
  if ((airport.elevationFt ?? 0) > gate.maxAirportElevationFt) return false;
  if (gate.requireBothEnds && (!completeEnd(runway.lowEnd) || !completeEnd(runway.highEnd))) return false;
  return true;
}

function chooseRunwayEnd(runway: Runway, inboundBearingDeg: number, profile: MissionProfile): (RunwayEnd & { ident: string; latDeg: number; lonDeg: number; headingDeg: number }) | null {
  const ends = [runway.lowEnd, runway.highEnd]
    .filter(completeEnd)
    .map((end) => ({ end, delta: headingDeltaDeg(inboundBearingDeg, end.headingDeg) }))
    .filter(({ delta }) => delta <= profile.runway.maxInitialHeadingDeltaDeg + BOUNDARY_EPSILON)
    .sort((a, b) => a.delta - b.delta || a.end.ident.localeCompare(b.end.ident));
  return ends[0]?.end ?? null;
}

function suitability(runway: Runway & { lengthFt: number; widthFt: number }, estimatedMinutes: number, profile: MissionProfile): number {
  const lengthMargin = clamp((runway.lengthFt - profile.runway.minLengthFt) / profile.runway.minLengthFt, 0, 2);
  const widthMargin = clamp((runway.widthFt - profile.runway.minWidthFt) / profile.runway.minWidthFt, 0, 2);
  const score = lengthMargin * profile.ranking.lengthMarginWeight +
    widthMargin * profile.ranking.widthMarginWeight +
    (runway.lighted ? profile.ranking.lightedBonus : 0) +
    (runway.surface === "HARD" ? profile.ranking.hardSurfaceBonus : 0) -
    estimatedMinutes * profile.ranking.minutePenalty;
  return round(score, 6);
}

function compareAssignments(a: RunwayAssignment, b: RunwayAssignment): number {
  return b.suitability - a.suitability ||
    a.estimatedMinutes - b.estimatedMinutes ||
    a.distanceNm - b.distanceNm ||
    a.airportIdent.localeCompare(b.airportIdent) ||
    a.runwayId.localeCompare(b.runwayId) ||
    a.runwayEndIdent.localeCompare(b.runwayEndIdent);
}

function bestForAirport(airport: MissionAirport, snapshot: MissionStartSnapshot, estimatedMinutes: number, distanceNm: number, profile: MissionProfile): RunwayAssignment | null {
  const inboundBearing = initialBearingDeg(snapshot.latDeg, snapshot.lonDeg, airport.latDeg, airport.lonDeg);
  const candidates: RunwayAssignment[] = [];
  for (const runway of airport.runways) {
    if (!suitableRunway(runway, airport, profile) || runway.lengthFt === null || runway.widthFt === null) continue;
    const end = chooseRunwayEnd(runway, inboundBearing, profile);
    if (end === null) continue;
    candidates.push({
      airportIdent: airport.ident,
      airportName: airport.name,
      airportLatDeg: airport.latDeg,
      airportLonDeg: airport.lonDeg,
      airportElevationFt: airport.elevationFt,
      runwayId: runway.id,
      runwayIdent: runwayIdent(runway),
      runwayEndIdent: end.ident,
      runwayHeadingDeg: normalizeHeading(end.headingDeg),
      runwayLengthFt: runway.lengthFt,
      runwayWidthFt: runway.widthFt,
      runwaySurface: runway.surface,
      runwayLighted: runway.lighted,
      assignedEnd: { ...end, headingDeg: normalizeHeading(end.headingDeg) },
      distanceNm: round(distanceNm, 6),
      estimatedMinutes: round(estimatedMinutes, 6),
      suitability: suitability(runway as Runway & { lengthFt: number; widthFt: number }, estimatedMinutes, profile),
    });
  }
  candidates.sort(compareAssignments);
  return candidates[0] ?? null;
}

export function assignMission(options: {
  snapshot: MissionStartSnapshot;
  profile: MissionProfile;
  datasetVersion: string;
  airports: readonly MissionAirport[];
}): MissionAssignmentResult {
  const { snapshot, profile, datasetVersion } = options;
  const speed = Number.isFinite(snapshot.groundSpeedKt) && snapshot.groundSpeedKt > 0
    ? snapshot.groundSpeedKt
    : profile.reachability.defaultPlanningSpeedKt;
  const planningSpeedKt = clamp(speed, profile.reachability.minPlanningSpeedKt, profile.reachability.maxPlanningSpeedKt);
  const maxDistanceNm = planningSpeedKt * profile.reachability.maxMinutes / 60;
  const candidates: RunwayAssignment[] = [];

  for (const airport of options.airports) {
    if (!profile.runway.airportSizes.includes(airport.size)) continue;
    const distanceNm = greatCircleDistanceNm(snapshot.latDeg, snapshot.lonDeg, airport.latDeg, airport.lonDeg);
    if (distanceNm + BOUNDARY_EPSILON < profile.reachability.minDestinationNm || distanceNm > maxDistanceNm + BOUNDARY_EPSILON) continue;
    const estimatedMinutes = distanceNm / planningSpeedKt * 60;
    const best = bestForAirport(airport, snapshot, estimatedMinutes, distanceNm, profile);
    if (best !== null) candidates.push(best);
  }
  candidates.sort(compareAssignments);

  const common = {
    datasetVersion,
    profileVersion: profile.profileVersion,
    assignmentVersion: profile.assignmentVersion,
    planningSpeedKt: round(planningSpeedKt, 6),
    maxDistanceNm: round(maxDistanceNm, 6),
  };
  if (candidates.length === 0) return { assigned: false, reason: "NO_SUITABLE_RUNWAY", ...common };
  return {
    assigned: true,
    ...common,
    scoringVersion: profile.scoringVersion,
    best: candidates[0],
    alternatives: candidates.slice(1),
  };
}
