import { describe, expect, it, vi } from "vitest";

import type { AccessIdentity } from "./accessJwt";
import { authorizeAdminRequest } from "./authorize";

const IDENTITY: AccessIdentity = {
  actorId: "access:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  csrfSessionId: "11111111-1111-4111-8111-111111111111",
  subject: "owner-subject",
};

const environment = {
  ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
  ACCESS_AUD: "a".repeat(64),
  ADMIN_EMAIL: "admin@your-domain.example",
};

describe("admin request authorization", () => {
  it("rejects an ordinary game cookie without an Access assertion", async () => {
    const verify = vi.fn();
    await expect(
      authorizeAdminRequest(
        new Request("https://squawk.example/api/admin/status", {
          headers: { cookie: "__Host-adsb_session=ordinary-game-session" },
        }),
        environment,
        verify,
      ),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("maps only a verified Access identity to an admin actor", async () => {
    const verify = vi.fn(async () => IDENTITY);
    const actor = await authorizeAdminRequest(
      new Request("https://squawk.example/api/admin/status", {
        headers: { "cf-access-jwt-assertion": "signed-access-token" },
      }),
      environment,
      verify,
    );

    expect(actor).toEqual({
      kind: "admin",
      userId: IDENTITY.actorId,
      sessionId: IDENTITY.csrfSessionId,
      samplingKey: `admin:${IDENTITY.actorId}`,
    });
    expect(verify).toHaveBeenCalledWith("signed-access-token", {
      teamDomain: environment.ACCESS_TEAM_DOMAIN,
      audience: environment.ACCESS_AUD,
      adminEmail: environment.ADMIN_EMAIL,
    });
  });

  it("collapses verifier failures to one non-enumerating denial", async () => {
    const verify = vi.fn(async () => {
      throw new Error("unknown kid from private verifier detail");
    });
    await expect(
      authorizeAdminRequest(
        new Request("https://squawk.example/api/admin/status", {
          headers: { "cf-access-jwt-assertion": "forged" },
        }),
        environment,
        verify,
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "Administrator access is required",
    });
  });
});
