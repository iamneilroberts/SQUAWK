import type { AssistMode } from "../mission/assists";
import type { MissionVersionSet } from "../mission/contract";
import type {
  LandingEvaluation,
  MissionResultRequest,
  MissionResultView,
} from "../mission/resultPackage";
import type { AircraftClassId } from "../mission/types";

export type DebriefPreview = {
  classId: AircraftClassId;
  versions: MissionVersionSet;
  highestAssist: AssistMode;
  evaluation: LandingEvaluation;
};

export type DebriefSubmission =
  | { status: "submitting"; preview: DebriefPreview }
  | { status: "queued"; preview: DebriefPreview; message: string }
  | { status: "tutorial"; preview: DebriefPreview }
  /** Anonymous instant flight (B5): a locally scored, unranked debrief; never submitted. */
  | { status: "instant"; preview: DebriefPreview }
  | { status: "accepted"; result: MissionResultView }
  | {
      status: "failed";
      preview: DebriefPreview;
      message: string;
      retryable: boolean;
    }
  | { status: "unavailable"; message: string };

export type PendingMissionResult = {
  request: MissionResultRequest;
  idempotencyKey: string;
  preview: DebriefPreview;
};
