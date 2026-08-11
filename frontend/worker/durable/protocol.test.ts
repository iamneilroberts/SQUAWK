import { describe, expect, it } from "vitest";

import { parseBrokerCommand, parseBrokerResponse } from "./protocol";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const MISSION_ID = "22222222-2222-4222-8222-222222222222";

describe("broker protocol", () => {
  it("accepts only exact typed internal commands", () => {
    expect(
      parseBrokerCommand({
        type: "admit",
        kind: "active-flight",
        forceMode: "NORMAL",
        userId: USER_ID,
        missionId: MISSION_ID,
      }),
    ).toMatchObject({ type: "admit", kind: "active-flight" });
    expect(
      parseBrokerCommand({
        type: "traffic",
        forceMode: "NORMAL",
        request: {
          latitude: 30,
          longitude: -88,
          radiusNm: 80,
          audience: { kind: "anonymous" },
        },
      }),
    ).toMatchObject({ type: "traffic", request: { audience: { kind: "anonymous" } } });
    expect(
      parseBrokerCommand({
        type: "settings-set",
        registrationEnabled: false,
        providerCacheOnly: true,
        forceMode: "NORMAL",
      }),
    ).toMatchObject({ type: "settings-set", providerCacheOnly: true });
    expect(
      parseBrokerCommand({
        type: "cache-clear-region",
        regionKey: "r1:30.5:-88:100",
        forceMode: "NORMAL",
      }),
    ).toMatchObject({ type: "cache-clear-region", regionKey: "r1:30.5:-88:100" });

    for (const invalid of [
      null,
      { type: "admit", kind: "active-flight", forceMode: "NORMAL" },
      { type: "admit", kind: "public-read", forceMode: "NORMAL", objectName: "chosen" },
      { type: "status", forceMode: "WEAK_MODE" },
      { type: "lease-release-user", userId: "raw-email@example.com" },
      {
        type: "settings-set",
        registrationEnabled: "false",
        providerCacheOnly: true,
        forceMode: "NORMAL",
      },
      { type: "cache-clear-region", regionKey: "../../all", forceMode: "NORMAL" },
      {
        type: "traffic",
        forceMode: "NORMAL",
        request: {
          latitude: 30,
          longitude: -88,
          radiusNm: 80,
          audience: { kind: "anonymous", callerUrl: "https://attacker.test" },
        },
      },
    ]) {
      expect(() => parseBrokerCommand(invalid)).toThrow("Invalid broker command");
    }
  });

  it("fails closed on malformed broker responses", () => {
    expect(() =>
      parseBrokerResponse({
        ok: true,
        result: {
          type: "admission",
          allowed: true,
          status: { effectiveMode: "NORMAL" },
        },
      }),
    ).toThrow("Invalid broker response");
    expect(() =>
      parseBrokerResponse({ ok: false, error: { message: "raw detail" } }),
    ).toThrow("Invalid broker response");
  });
});
