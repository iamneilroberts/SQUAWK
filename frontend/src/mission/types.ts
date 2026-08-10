export type AircraftClassId = "c172s" | "b738" | "f5e";
export type AirportSize = "small" | "medium" | "large";
export type RunwaySurface = "HARD" | "GRAVEL" | "GRASS" | "DIRT" | "SAND" | "WATER" | "SNOW_ICE" | "OTHER";

export type RunwayEnd = {
  ident: string | null;
  latDeg: number | null;
  lonDeg: number | null;
  elevationFt: number | null;
  headingDeg: number | null;
  displacedThresholdFt: number | null;
};

export type Runway = {
  id: string;
  lengthFt: number | null;
  widthFt: number | null;
  surface: RunwaySurface;
  surfaceRaw: string;
  lighted: boolean;
  closed: boolean;
  lowEnd: RunwayEnd | null;
  highEnd: RunwayEnd | null;
};

export type MissionAirport = {
  ident: string;
  iata: string | null;
  name: string;
  size: AirportSize;
  latDeg: number;
  lonDeg: number;
  elevationFt: number | null;
  runways: Runway[];
};

export type AirportShardManifestEntry = {
  path: string;
  sha256: string;
  bytes: number;
  airportCount: number;
  runwayCount: number;
  bounds: { south: number; west: number; north: number; east: number };
};

export type AirportDatasetManifest = {
  schemaVersion: 1;
  recordEncoding: "airport-runway-tuples-v1";
  datasetVersion: string;
  shardDegrees: number;
  source: {
    date: string;
    airportsUrl: string;
    runwaysUrl: string;
    airportsSha256: string;
    runwaysSha256: string;
  };
  attribution: string;
  bounds: { south: number; west: number; north: number; east: number };
  counts: { airports: number; runways: number; shards: number; bytes: number };
  shards: Record<string, AirportShardManifestEntry>;
};

export type ScoreCurvePoint = { value: number; score: number };

export type MissionProfile = {
  classId: AircraftClassId;
  profileVersion: string;
  assignmentVersion: string;
  scoringVersion: string;
  reachability: {
    maxMinutes: number;
    minDestinationNm: number;
    defaultPlanningSpeedKt: number;
    minPlanningSpeedKt: number;
    maxPlanningSpeedKt: number;
  };
  runway: {
    airportSizes: AirportSize[];
    surfaces: RunwaySurface[];
    minLengthFt: number;
    minWidthFt: number;
    requireLighted: boolean;
    requireBothEnds: boolean;
    maxAirportElevationFt: number;
    maxInitialHeadingDeltaDeg: number;
  };
  ranking: {
    lengthMarginWeight: number;
    widthMarginWeight: number;
    lightedBonus: number;
    hardSurfaceBonus: number;
    minutePenalty: number;
  };
  guidance: {
    approachLengthNm: number;
    corridorWidthFt: number;
    gateSpacingNm: number;
    glideSlopeDeg: number;
    flareHeightFt: number;
  };
  landing: {
    requireGearDown: boolean;
    maxSinkRateFpm: number;
    maxAbsBankDeg: number;
    minPitchDeg: number;
    maxPitchDeg: number;
    minTouchdownSpeedKt: number;
    maxTouchdownSpeedKt: number;
    maxLoadFactor: number;
    maxRolloutCrossTrackFt: number;
  };
  scoreCurves: {
    verticalSpeedFpm: ScoreCurvePoint[];
    centerlineErrorFt: ScoreCurvePoint[];
    touchdownZoneFt: ScoreCurvePoint[];
    headingErrorDeg: ScoreCurvePoint[];
    speedErrorKt: ScoreCurvePoint[];
    bankDeg: ScoreCurvePoint[];
    rolloutCrossTrackFt: ScoreCurvePoint[];
  };
};

export type MissionStartSnapshot = {
  latDeg: number;
  lonDeg: number;
  altitudeFt: number;
  groundSpeedKt: number;
  trackDeg: number;
};

export type RunwayAssignment = {
  airportIdent: string;
  airportName: string;
  airportLatDeg: number;
  airportLonDeg: number;
  airportElevationFt: number | null;
  runwayId: string;
  runwayIdent: string;
  runwayEndIdent: string;
  runwayHeadingDeg: number;
  runwayLengthFt: number;
  runwayWidthFt: number;
  runwaySurface: RunwaySurface;
  runwayLighted: boolean;
  assignedEnd: RunwayEnd & { ident: string; latDeg: number; lonDeg: number; headingDeg: number };
  distanceNm: number;
  estimatedMinutes: number;
  suitability: number;
};

export type MissionAssignmentResult =
  | {
      assigned: true;
      datasetVersion: string;
      profileVersion: string;
      assignmentVersion: string;
      scoringVersion: string;
      planningSpeedKt: number;
      maxDistanceNm: number;
      best: RunwayAssignment;
      alternatives: RunwayAssignment[];
    }
  | {
      assigned: false;
      reason: "NO_SUITABLE_RUNWAY";
      datasetVersion: string;
      profileVersion: string;
      assignmentVersion: string;
      planningSpeedKt: number;
      maxDistanceNm: number;
    };
