import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { encodeOpaqueToken, authorizeSession } from "../../auth/sessions";
import { hashSessionToken } from "../../crypto";
import { createLockedMission, getMissionById } from "../../db/missions";
import { getResultByMissionId } from "../../db/results";
import { createSession } from "../../db/sessions";
import { createUser } from "../../db/users";
import type { Env } from "../../env";
import { signMissionReceipt } from "../../missions/authorization";
import { allowEndpointLimiter, createRouter, type RouterDependencies } from "../router";
import { createMissionRoutes, type MissionRouteDependencies } from "./missions";
import type { LockedMissionDocument, MissionReceiptPayload } from "../../../src/mission/contract";
import { missionChoiceKey, missionVersions } from "../../../src/mission/contract";
import { destinationPoint } from "../../../src/mission/geo";
import type { LandingEvidence } from "../../../src/mission/landingEvidence";
import { evaluateLandingEvidence, type MissionResultRequest } from "../../../src/mission/resultPackage";
import { missionProfileForClass } from "../../../src/mission/profiles";
import type { RunwayAssignment } from "../../../src/mission/types";
import { loadClassById } from "../../../src/sim/params";
import { buildSpawnState } from "../../../src/takeover/spawn";
import type { Contact } from "../../../src/data/types";

const NOW = 1_700_000_000_000;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "99999999-9999-4999-8999-999999999999";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_SESSION_ID = "88888888-8888-4888-8888-888888888888";
const MISSION_ID = "33333333-3333-4333-8333-333333333333";
const RESULT_ID = "44444444-4444-4444-8444-444444444444";
const SECRET = "mission-result-test-secret-at-least-32-characters";
const SESSION_TOKEN = encodeOpaqueToken(new Uint8Array(32).fill(9));
const OTHER_SESSION_TOKEN = encodeOpaqueToken(new Uint8Array(32).fill(8));

type TestEnvironment = Cloudflare.Env & { TEST_DB: D1Database; TEST_MIGRATIONS: D1Migration[] };

const contact: Contact = {
  hex: "abc123", flight: "N123", t: "C172", lat: 30, lon: -88,
  alt_geom: 1_000, alt_baro: 1_000, gs: 70, track: 90, baro_rate: -100,
  military: false, seen_pos: 0,
};

const assignment: RunwayAssignment = {
  airportIdent: "KMOB", airportName: "Mobile", airportLatDeg: 30, airportLonDeg: -88,
  airportElevationFt: 100, runwayId: "1", runwayIdent: "09/27", runwayEndIdent: "09",
  runwayHeadingDeg: 90, runwayLengthFt: 8_000, runwayWidthFt: 200, runwaySurface: "HARD",
  runwayLighted: true,
  assignedEnd: { ident: "09", latDeg: 30, lonDeg: -88, elevationFt: 100, headingDeg: 90, displacedThresholdFt: 0 },
  distanceNm: 10, estimatedMinutes: 5, suitability: 1,
};

const profile = missionProfileForClass("c172s");
const versions = missionVersions({
  datasetVersion: "oa-test-v1",
  profileVersion: profile.profileVersion,
  assignmentVersion: profile.assignmentVersion,
  scoringVersion: profile.scoringVersion,
});

function evidence(overrides: Record<string, unknown> = {}): LandingEvidence {
  const first = destinationPoint(30, -88, 90, 500 / 6076.11549);
  const last = destinationPoint(30, -88, 90, 510 / 6076.11549);
  const base = {
    altitudeFt: 100, iasKt: 61, sinkRateFpm: 100, headingDeg: 90, pitchDeg: 3,
    bankDeg: 0, loadFactor: 1, gearPosition: 1,
  };
  return {
    schemaVersion: 1,
    sampleIntervalMs: 100,
    samples: [
      { timeMs: 0, latDeg: first.latDeg, lonDeg: first.lonDeg, surfaceContact: false, ...base },
      { timeMs: 100, latDeg: last.latDeg, lonDeg: last.lonDeg, surfaceContact: true, ...base, ...overrides },
    ],
  };
}

async function requestBody(overrides: Partial<MissionResultRequest> = {}): Promise<MissionResultRequest> {
  const receiptPayload: MissionReceiptPayload = {
    schemaVersion: 1,
    purpose: "mission-receipt",
    missionId: MISSION_ID,
    aircraftHex: contact.hex,
    choiceKey: missionChoiceKey(assignment),
    lockedAt: NOW - 500,
    expiresAt: NOW + 60_000,
    versions,
  };
  return {
    schemaVersion: 1,
    missionId: MISSION_ID,
    receipt: await signMissionReceipt(receiptPayload, SECRET),
    choiceKey: missionChoiceKey(assignment),
    versions,
    highestAssist: "FULL",
    evidence: evidence(),
    ...overrides,
  };
}

function runtime(bucket?: R2Bucket): Env {
  return {
    APP_ENV: "local",
    DB: (env as TestEnvironment).TEST_DB,
    MISSION_SIGNING_SECRET: SECRET,
    RESULT_TRACES: bucket,
  } as Env;
}

function dependencies(): RouterDependencies<Env> {
  return {
    uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    wallClock: () => new Date(NOW),
    monotonicNow: () => 1,
    digest: async () => "network-digest",
    authorize: (_boundary, request, context, runtimeEnv) =>
      authorizeSession(request, runtimeEnv.DB, NOW, context.actor),
    verifyCsrf: async () => true,
    resolveLimiter: () => allowEndpointLimiter,
    admitRequest: async ({ forceMode }) => ({ allowed: true, mode: forceMode }),
    observe: vi.fn(),
  };
}

async function postResult(options: {
  body?: unknown;
  key?: string;
  token?: string;
  bucket?: R2Bucket;
  broker?: MissionRouteDependencies["broker"];
} = {}) {
  const broker = options.broker ?? vi.fn(async () => ({
    type: "lease" as const, allowed: false, reason: "not-found" as const,
  } as never));
  const router = createRouter(
    createMissionRoutes({ uuid: () => RESULT_ID, broker }),
    dependencies(),
  );
  const response = await router.fetch(new Request(
    `https://fly.voygent.app/api/missions/${MISSION_ID}/result`,
    {
      method: "POST",
      headers: {
        cookie: `__Host-adsb_session=${options.token ?? SESSION_TOKEN}`,
        origin: "https://fly.voygent.app",
        "content-type": "application/json",
        "x-csrf-token": "fixture",
        "idempotency-key": options.key ?? "stable-result-key",
      },
      body: JSON.stringify(options.body ?? await requestBody()),
    },
  ), runtime(options.bucket));
  return { response };
}

beforeEach(async () => {
  const testEnv = env as TestEnvironment;
  await reset();
  await applyD1Migrations(testEnv.TEST_DB, testEnv.TEST_MIGRATIONS);
  await createUser(testEnv.TEST_DB, {
    id: USER_ID, emailKey: "c".repeat(64), handle: "ResultPilot", createdAt: NOW - 10, updatedAt: NOW - 10,
  });
  await createUser(testEnv.TEST_DB, {
    id: OTHER_USER_ID, emailKey: "e".repeat(64), handle: "OtherPilot", createdAt: NOW - 10, updatedAt: NOW - 10,
  });
  await createSession(testEnv.TEST_DB, {
    id: SESSION_ID, userId: USER_ID, sessionDigest: await hashSessionToken(SESSION_TOKEN),
    csrfDigest: "d".repeat(64), expiresAt: NOW + 60_000, lastSeenAt: NOW - 5,
    deviceLabel: null, rotatedFromId: null, createdAt: NOW - 10,
  });
  await createSession(testEnv.TEST_DB, {
    id: OTHER_SESSION_ID, userId: OTHER_USER_ID, sessionDigest: await hashSessionToken(OTHER_SESSION_TOKEN),
    csrfDigest: "f".repeat(64), expiresAt: NOW + 60_000, lastSeenAt: NOW - 5,
    deviceLabel: null, rotatedFromId: null, createdAt: NOW - 10,
  });
  const aircraftProfile = loadClassById("c172s");
  const spawn = buildSpawnState(contact, aircraftProfile, { terrainHeightM: null });
  const document: LockedMissionDocument = {
    schemaVersion: 2,
    preparationId: MISSION_ID,
    idempotencyKey: "mission-lock-key",
    lockRequestDigest: "a".repeat(64),
    contact,
    traffic: {
      source: "fixture", sourceTime: NOW - 1_000, fetchedAt: NOW - 500,
      cacheAgeSeconds: 0, cacheStatus: "MISS", regionKey: "test", radiusNm: 25,
    },
    classId: "c172s",
    aircraftProfile,
    missionProfile: profile,
    assignment,
    versions,
    assist: "high",
    reconstruction: {
      disclosure: "fixture", terrainHeightM: null, altitudeSource: spawn.altitudeSource,
      verticalRateSource: "barometric", state: spawn.state, controls: spawn.controls,
      adjustments: spawn.adjustments,
    },
    preparedAt: NOW - 1_000,
    lockedAt: NOW - 500,
  };
  await createLockedMission(testEnv.TEST_DB, {
    id: MISSION_ID, userId: USER_ID, aircraftHex: contact.hex, aircraftClass: "c172s",
    adsbSnapshot: document, airportIcao: assignment.airportIdent,
    runwayIdent: assignment.runwayEndIdent, scoringVersion: versions.scoring,
    physicsVersion: versions.physics, assists: { schemaVersion: 1, selected: "high" },
    createdAt: NOW - 1_000, lockedAt: NOW - 500,
  });
});

describe("authoritative mission result route", () => {
  it("recomputes the browser score, finalizes D1, then releases the lease", async () => {
    const body = await requestBody();
    const preview = evaluateLandingEvidence(body.evidence, assignment, profile);
    const broker = vi.fn(async () => {
      await expect(getMissionById((env as TestEnvironment).TEST_DB, MISSION_ID)).resolves.toMatchObject({
        status: "finalized",
      });
      return { type: "lease" as const, allowed: false, reason: "not-found" as const } as never;
    });
    const { response } = await postResult({ body, broker });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "RESULT_ACCEPTED",
      data: { result: {
        outcome: "landed",
        score: preview.score?.total,
        measurements: preview.measurements,
        ranked: true,
      } },
    });
    await expect(getMissionById((env as TestEnvironment).TEST_DB, MISSION_ID)).resolves.toMatchObject({
      status: "finalized",
    });
    await expect(getResultByMissionId((env as TestEnvironment).TEST_DB, MISSION_ID)).resolves.toMatchObject({
      score: Math.round((preview.score?.total ?? 0) * 1_000), evidenceStatus: "verified",
    });
    expect(broker).toHaveBeenCalledWith(undefined, {
      type: "lease-release", userId: USER_ID, missionId: MISSION_ID,
    });
  });

  it("returns the same result for the same key/body and conflicts on a different key", async () => {
    const body = await requestBody();
    const reordered: MissionResultRequest = {
      evidence: body.evidence,
      highestAssist: body.highestAssist,
      versions: body.versions,
      choiceKey: body.choiceKey,
      receipt: body.receipt,
      missionId: body.missionId,
      schemaVersion: 1,
    };
    const first = await postResult({ body, key: "stable-result-key" });
    const replay = await postResult({ body: reordered, key: "stable-result-key" });
    expect(first.response.status).toBe(200);
    expect(replay.response.status).toBe(200);
    const firstJson = await first.response.json() as { data: { result: unknown } };
    const replayJson = await replay.response.json() as { data: { result: unknown } };
    expect(firstJson.data.result).toEqual(replayJson.data.result);
    const conflict = await postResult({ body, key: "different-result-key" });
    expect(conflict.response.status).toBe(409);
    await expect(conflict.response.json()).resolves.toMatchObject({ code: "MISSION_IDEMPOTENCY_CONFLICT" });
  });

  it("rejects corrupt evidence, wrong runway/version, and another user", async () => {
    const corrupt = await requestBody();
    const corruptBody = {
      ...corrupt,
      evidence: {
        ...corrupt.evidence,
        samples: [
          { ...corrupt.evidence.samples[0], secretTelemetry: true },
          ...corrupt.evidence.samples.slice(1),
        ],
      },
    };
    expect((await postResult({ body: corruptBody })).response.status).toBe(400);

    const wrongRunway = await requestBody({ choiceKey: "KMOB:1:27" });
    expect((await postResult({ body: wrongRunway })).response.status).toBe(409);

    const wrongVersion = await requestBody({ versions: { ...versions, scoring: "scoring-other-v1" } });
    expect((await postResult({ body: wrongVersion })).response.status).toBe(409);

    const wrongUser = await postResult({ body: await requestBody(), token: OTHER_SESSION_TOKEN });
    expect(wrongUser.response.status).toBe(404);
  });

  it("stores incomplete and suspicious evidence unranked", async () => {
    const incompleteBody = await requestBody({
      evidence: { ...evidence(), samples: [evidence().samples[0]] },
    });
    const incomplete = await postResult({ body: incompleteBody });
    await expect(incomplete.response.json()).resolves.toMatchObject({
      data: { result: { outcome: "invalid", failure: "EVIDENCE_INCOMPLETE", score: null, ranked: false, evidenceStatus: "partial" } },
    });
  });

  it("marks implausible positional evidence rejected and unranked", async () => {
    const suspiciousEvidence = evidence();
    suspiciousEvidence.samples[1] = { ...suspiciousEvidence.samples[1], latDeg: 40 };
    const suspicious = await postResult({
      body: await requestBody({ evidence: suspiciousEvidence }),
    });
    await expect(suspicious.response.json()).resolves.toMatchObject({
      data: { result: { outcome: "invalid", failure: "EVIDENCE_IMPLAUSIBLE", score: null, ranked: false, evidenceStatus: "rejected" } },
    });
  });

  it("returns a precise hard-gate failure and never a quality score", async () => {
    const body = await requestBody({ evidence: evidence({ sinkRateFpm: 601 }) });
    const { response } = await postResult({ body });
    await expect(response.json()).resolves.toMatchObject({
      data: { result: { outcome: "crashed", failure: "SINK_RATE_EXCEEDED", score: null, ranked: false } },
    });
  });

  it("keeps the durable summary when optional R2 storage fails", async () => {
    const bucket = { put: vi.fn().mockRejectedValue(new Error("R2 down")) } as unknown as R2Bucket;
    const { response } = await postResult({ body: await requestBody(), bucket });
    expect(response.status).toBe(200);
    await expect(getResultByMissionId((env as TestEnvironment).TEST_DB, MISSION_ID)).resolves.not.toBeNull();
    await expect(getMissionById((env as TestEnvironment).TEST_DB, MISSION_ID)).resolves.toMatchObject({
      status: "finalized", tracePointer: null,
    });
  });

  it("stores an optional bounded trace pointer without changing the result", async () => {
    const bucket = { put: vi.fn().mockResolvedValue(undefined) } as unknown as R2Bucket;
    const { response } = await postResult({ body: await requestBody(), bucket });
    expect(response.status).toBe(200);
    expect(bucket.put).toHaveBeenCalledOnce();
    await expect(getMissionById((env as TestEnvironment).TEST_DB, MISSION_ID)).resolves.toMatchObject({
      tracePointer: `landing-traces/${MISSION_ID}/${RESULT_ID}.json`,
    });
  });
});
