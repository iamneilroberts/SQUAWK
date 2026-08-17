import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ADMIN_EMAIL,
  verifyAccessJwt,
  type AccessJwtConfiguration,
} from "./accessJwt";

const NOW = new Date("2026-08-10T18:00:00.000Z");
const ISSUER = "https://example.cloudflareaccess.com";
const AUDIENCE = "a".repeat(64);
const SUBJECT = "11111111-1111-4111-8111-111111111111";
const KID = "access-key-1";

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

const configuration: AccessJwtConfiguration = {
  teamDomain: ISSUER,
  audience: AUDIENCE,
};

beforeAll(async () => {
  const primary = await generateKeyPair("RS256", { extractable: true });
  const other = await generateKeyPair("RS256", { extractable: true });
  privateKey = primary.privateKey as CryptoKey;
  otherPrivateKey = other.privateKey as CryptoKey;
  const publicJwk = await exportJWK(primary.publicKey);
  jwks = createLocalJWKSet({ keys: [{ ...publicJwk, alg: "RS256", kid: KID }] as JWK[] });
});

type TokenOverrides = {
  audience?: string;
  email?: string;
  issuer?: string;
  kid?: string;
  notBefore?: number;
  expiration?: number;
  protectedType?: "JWT" | "not-jwt" | null;
  tokenType?: string;
  key?: CryptoKey;
};

async function token(overrides: TokenOverrides = {}): Promise<string> {
  const now = Math.floor(NOW.getTime() / 1_000);
  return new SignJWT({
    email: overrides.email ?? ADMIN_EMAIL,
    type: overrides.tokenType ?? "app",
  })
    .setProtectedHeader({
      alg: "RS256",
      kid: overrides.kid ?? KID,
      ...(overrides.protectedType === null
        ? {}
        : { typ: overrides.protectedType ?? "JWT" }),
    })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setSubject(SUBJECT)
    .setIssuedAt(now - 10)
    .setNotBefore(overrides.notBefore ?? now - 10)
    .setExpirationTime(overrides.expiration ?? now + 60)
    .sign(overrides.key ?? privateKey);
}

describe("Cloudflare Access application JWT validation", () => {
  it("accepts a signed application token for the exact owner email", async () => {
    await expect(
      verifyAccessJwt(await token(), configuration, { jwks, now: NOW }),
    ).resolves.toMatchObject({
      actorId: expect.stringMatching(/^access:[0-9a-f]{32}$/),
      csrfSessionId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      subject: SUBJECT,
    });
  });

  it("accepts Cloudflare application tokens without the optional typ header", async () => {
    await expect(
      verifyAccessJwt(
        await token({ protectedType: null }),
        configuration,
        { jwks, now: NOW },
      ),
    ).resolves.toMatchObject({ subject: SUBJECT });
  });

  it("rejects an explicitly incompatible typ header", async () => {
    await expect(
      verifyAccessJwt(
        await token({ protectedType: "not-jwt" }),
        configuration,
        { jwks, now: NOW },
      ),
    ).rejects.toThrow();
  });

  it.each([
    ["signature", { key: undefined }, "other-key"],
    ["kid", { kid: "missing-key" }, "primary-key"],
    ["issuer", { issuer: "https://other.cloudflareaccess.com" }, "primary-key"],
    ["audience", { audience: "b".repeat(64) }, "primary-key"],
    ["expired", { expiration: Math.floor(NOW.getTime() / 1_000) - 1 }, "primary-key"],
    ["not-before", { notBefore: Math.floor(NOW.getTime() / 1_000) + 1 }, "primary-key"],
    ["email", { email: "other@example.com" }, "primary-key"],
    ["application role", { tokenType: "org" }, "primary-key"],
  ] as const)("rejects an invalid %s claim", async (_name, overrides, keyChoice) => {
    const actual = {
      ...overrides,
      ...(keyChoice === "other-key" ? { key: otherPrivateKey } : {}),
    };
    await expect(
      verifyAccessJwt(await token(actual), configuration, { jwks, now: NOW }),
    ).rejects.toThrow();
  });

  it("fails closed for malformed deployment configuration", async () => {
    await expect(
      verifyAccessJwt(await token(), { ...configuration, audience: "not-an-aud" }, { jwks, now: NOW }),
    ).rejects.toThrow(/configuration/i);
  });
});
