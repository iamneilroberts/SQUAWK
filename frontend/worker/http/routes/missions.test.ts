import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../env";
import {
  allowEndpointLimiter,
  createRouter,
  type RouterDependencies,
} from "../router";
import { createMissionRoutes } from "./missions";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function dependencies(
  overrides: Partial<RouterDependencies<Env>> = {},
): RouterDependencies<Env> {
  return {
    uuid: () => "00000000-0000-4000-8000-000000000003",
    wallClock: () => new Date("2026-08-10T15:00:00.000Z"),
    monotonicNow: () => 100,
    digest: async () => "network-digest",
    verifyCsrf: async () => true,
    authorize: async () => ({
      kind: "authenticated",
      userId: USER_ID,
      sessionId: "22222222-2222-4222-8222-222222222222",
      samplingKey: `user:${USER_ID}`,
    }),
    resolveLimiter: () => allowEndpointLimiter,
    admitRequest: async ({ forceMode }) => ({ allowed: true, mode: forceMode }),
    observe: vi.fn(),
    ...overrides,
  };
}

function request(path: string): Request {
  return new Request(`https://squawk.example${path}`, {
    method: "POST",
    headers: {
      origin: "https://squawk.example",
      "content-type": "application/json",
      "x-csrf-token": "fixture",
      "idempotency-key": "mission-route-test-key",
    },
    body: "{}",
  });
}

const fakeEnv = { APP_ENV: "local" } as unknown as Env;

describe("mission route admission", () => {
  it("treats an actively banned session as unauthenticated before broker or body work", async () => {
    const broker = vi.fn();
    const router = createRouter(
      createMissionRoutes({ broker }),
      dependencies({
        authorize: async (_boundary, _request, context) => context.actor,
      }),
    );

    const response = await router.fetch(request("/api/missions/prepare"), fakeEnv);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(broker).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/missions/prepare", "READ_ONLY"],
    ["/api/missions", "KILL_SWITCH"],
  ] as const)("refuses %s when the effective mode is %s", async (path, mode) => {
    const broker = vi.fn();
    const router = createRouter(
      createMissionRoutes({ broker }),
      dependencies({
        resolveMode: () => mode === "KILL_SWITCH" ? "KILL_SWITCH" : "NORMAL",
        admitRequest: async () => ({ allowed: false, mode }),
      }),
    );

    const response = await router.fetch(request(path), fakeEnv);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "ADMISSION_DENIED",
      mode,
    });
    expect(broker).not.toHaveBeenCalled();
  });
});
