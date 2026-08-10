import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthClientError, postAuthenticatedJson } from "../auth/session";
import type { MissionPreparationView } from "./contract";
import { lockMission, prepareMission, releaseMissionLease, submitMissionResult } from "./api";

vi.mock("../auth/session", () => ({
  AuthClientError: class AuthClientError extends Error {
    constructor(
      readonly status: number,
      readonly code: string | null,
      readonly data?: unknown,
    ) {
      super("Authentication request failed");
    }
  },
  postAuthenticatedJson: vi.fn(),
}));

const preparation = {
  schemaVersion: 1,
  preparationToken: "v1.fixture.signature",
  preparationId: "22222222-2222-4222-8222-222222222222",
  issuedAt: 1,
  expiresAt: 2,
  contact: { hex: "a0b1c2" },
  traffic: {},
  classId: "c172s",
  selected: { airportIdent: "KTST" },
  eligibleChoices: [{ airportIdent: "KTST" }],
  versions: {},
  fingerprint: "fixture",
} as unknown as MissionPreparationView;

const request = {
  aircraftHex: "a0b1c2",
  position: { lat: 30, lon: -88 },
  preview: {
    aircraftHex: "a0b1c2",
    aircraftType: "C172",
    classId: "c172s" as const,
    selectedChoiceKey: "KTST:09-27:09",
    eligibleChoiceKeys: ["KTST:09-27:09"],
    versions: {
      airportDataset: "v1",
      aircraftProfile: "v1",
      missionProfile: "v1",
      assignment: "v1",
      scoring: "v1",
      physics: "v1",
      assistDefinition: "v1",
    },
  },
};

beforeEach(() => {
  vi.mocked(postAuthenticatedJson).mockReset();
});

describe("mission API client", () => {
  it("surfaces a structured reconfirmation instead of treating 409 as a generic failure", async () => {
    vi.mocked(postAuthenticatedJson).mockRejectedValue(
      new AuthClientError(409, "MISSION_RECONFIRM_REQUIRED", { preparation }),
    );
    await expect(prepareMission(request)).resolves.toEqual({
      kind: "reconfirm",
      preparation,
    });
  });

  it("keeps the supplied idempotency key on the commit request", async () => {
    const mission = { missionId: preparation.preparationId };
    vi.mocked(postAuthenticatedJson).mockResolvedValue({ mission });
    await expect(lockMission({
      preparationToken: preparation.preparationToken,
      choiceKey: "KTST:09-27:09",
      assist: "high",
    }, "stable-retry-key")).resolves.toBe(mission);
    expect(postAuthenticatedJson).toHaveBeenCalledWith(
      "/api/missions",
      expect.any(Object),
      "stable-retry-key",
    );
  });

  it("reuses the supplied release key for explicit quit and pagehide retries", async () => {
    vi.mocked(postAuthenticatedJson).mockResolvedValue({ released: true });
    await releaseMissionLease(preparation.preparationId, "stable-release-key");
    expect(postAuthenticatedJson).toHaveBeenCalledWith(
      `/api/missions/${preparation.preparationId}/release`,
      {},
      "stable-release-key",
    );
  });

  it("keeps the supplied result key on authoritative scoring retries", async () => {
    const result = { missionId: preparation.preparationId, outcome: "landed" };
    const body = { missionId: preparation.preparationId } as never;
    vi.mocked(postAuthenticatedJson).mockResolvedValue({ result });
    await expect(submitMissionResult(body, "stable-result-key")).resolves.toBe(result);
    expect(postAuthenticatedJson).toHaveBeenCalledWith(
      `/api/missions/${preparation.preparationId}/result`,
      body,
      "stable-result-key",
    );
  });
});
