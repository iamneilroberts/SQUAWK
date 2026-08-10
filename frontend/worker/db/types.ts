export type UserStatus = "active" | "disabled" | "banned";
export type AssistLevel = "none" | "low" | "medium" | "high";
export type TutorialState = "new" | "started" | "complete" | "dismissed";
export type MissionStatus = "draft" | "locked" | "finalized" | "abandoned";
export type FlightOutcome = "landed" | "crashed" | "aborted" | "invalid";
export type EvidenceStatus = "verified" | "partial" | "rejected";
export type BanScope = "temporary" | "permanent";
export type SystemEventLevel = "warning" | "error" | "transition";

export type VersionedDocument = Readonly<Record<string, unknown>> & {
  schemaVersion: number;
};

export type User = {
  id: string;
  emailKey: string;
  handle: string;
  status: UserStatus;
  createdAt: number;
  updatedAt: number;
};

export type CreateUserInput = Omit<User, "status"> & { status?: UserStatus };

export type UserPreferences = {
  userId: string;
  centerLat: number;
  centerLon: number;
  regionKey: string;
  defaultAssist: AssistLevel;
  tutorialState: TutorialState;
  coachingEnabled: boolean;
  updatedAt: number;
};

export type MagicLink = {
  id: string;
  tokenDigest: string;
  emailKey: string;
  expiresAt: number;
  consumedAt: number | null;
  requestId: string;
  requestedAt: number;
};

export type CreateMagicLinkInput = Omit<MagicLink, "consumedAt">;

export type Session = {
  id: string;
  userId: string;
  sessionDigest: string;
  expiresAt: number;
  revokedAt: number | null;
  lastSeenAt: number;
  deviceLabel: string | null;
  rotatedFromId: string | null;
  createdAt: number;
};

export type CreateSessionInput = Omit<Session, "revokedAt">;
export type RotateSessionInput = Omit<CreateSessionInput, "rotatedFromId">;

export type Mission = {
  id: string;
  userId: string;
  aircraftHex: string;
  aircraftClass: string;
  adsbSnapshotJson: string;
  airportIcao: string;
  runwayIdent: string;
  scoringVersion: string;
  physicsVersion: string;
  assistsJson: string;
  status: MissionStatus;
  tracePointer: string | null;
  traceExpiresAt: number | null;
  createdAt: number;
  lockedAt: number | null;
  finalizedAt: number | null;
};

export type CreateMissionInput = {
  id: string;
  userId: string;
  aircraftHex: string;
  aircraftClass: string;
  adsbSnapshot: VersionedDocument;
  airportIcao: string;
  runwayIdent: string;
  scoringVersion: string;
  physicsVersion: string;
  assists: VersionedDocument;
  tracePointer?: string | null;
  traceExpiresAt?: number | null;
  createdAt: number;
};

export type LockMissionInput = {
  missionId: string;
  lockedAt: number;
  adsbSnapshot: VersionedDocument;
  assists: VersionedDocument;
};

export type FlightResult = {
  id: string;
  missionId: string;
  outcome: FlightOutcome;
  measurementsJson: string;
  score: number;
  highestAssist: AssistLevel;
  evidenceStatus: EvidenceStatus;
  evidenceSummaryJson: string;
  createdAt: number;
};

export type FinalizeResultInput = {
  id: string;
  missionId: string;
  outcome: FlightOutcome;
  measurements: VersionedDocument;
  score: number;
  highestAssist: AssistLevel;
  evidenceStatus: EvidenceStatus;
  evidenceSummary: VersionedDocument;
  createdAt: number;
};

export type UserBan = {
  id: string;
  userId: string | null;
  emailKey: string | null;
  scope: BanScope;
  reason: string;
  actor: string;
  expiresAt: number | null;
  revokedAt: number | null;
  revokedBy: string | null;
  createdAt: number;
};

export type CreateBanInput = Omit<UserBan, "revokedAt" | "revokedBy">;

export type SystemEvent = {
  id: string;
  level: SystemEventLevel;
  category: string;
  eventKey: string;
  requestId: string | null;
  contextJson: string;
  tracePointer: string | null;
  traceExpiresAt: number | null;
  createdAt: number;
};

export type CreateSystemEventInput = Omit<SystemEvent, "contextJson"> & {
  context: VersionedDocument;
};

export type AdminAudit = {
  id: string;
  action: string;
  actor: string;
  targetType: string;
  targetId: string;
  oldStateJson: string | null;
  newStateJson: string | null;
  reason: string;
  requestId: string;
  createdAt: number;
};

export type CreateAdminAuditInput = Omit<
  AdminAudit,
  "oldStateJson" | "newStateJson"
> & {
  oldState: VersionedDocument | null;
  newState: VersionedDocument | null;
};
