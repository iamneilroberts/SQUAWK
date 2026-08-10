import type { AircraftClassId } from "../mission/types";

export type ProfileFlightHistoryEntry = {
  resultId: string;
  missionId: string;
  completedAt: number;
  classId: AircraftClassId;
  outcome: "landed" | "crashed" | "aborted" | "invalid";
  score: number | null;
  highestAssist: "none" | "low" | "medium" | "high";
  evidenceStatus: "verified" | "partial" | "rejected";
  ranked: boolean;
  failure: string | null;
  scoringVersion: string;
};

export type ProfileClassStatistic = {
  classId: AircraftClassId;
  completedFlights: number;
  successfulLandings: number;
  rankedFlights: number;
  bestScore: number | null;
  averageScore: number | null;
};
