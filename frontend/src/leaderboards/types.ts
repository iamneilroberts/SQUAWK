import type { AircraftClassId } from "../mission/types";

export const LEADERBOARD_CACHE_TTL_SECONDS = 60;
export const LEADERBOARD_MINIMUM_POLL_SECONDS = 15;
export const LEADERBOARD_DEFAULT_LIMIT = 20;
export const LEADERBOARD_MAX_LIMIT = 50;

export type LeaderboardAssist = "none" | "low" | "medium" | "high";

export type LeaderboardPartition = {
  classId: AircraftClassId;
  highestAssist: LeaderboardAssist;
  scoringVersion: string;
};

export type LeaderboardEntry = {
  resultId: string;
  rank: number;
  userId: string;
  handle: string;
  score: number;
  completedAt: number;
};

export type LeaderboardPage = {
  schemaVersion: 1;
  partition: LeaderboardPartition;
  entries: LeaderboardEntry[];
  nextCursor: string | null;
  cacheTtlSeconds: 60;
  minimumPollSeconds: 15;
};

export type LeaderboardRequest = LeaderboardPartition & {
  cursor?: string;
  limit?: number;
};
