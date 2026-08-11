import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

export const ADMIN_EMAIL = "dneilroberts@gmail.com";

const ACCESS_AUDIENCE = /^[0-9a-f]{64}$/;
const ACCESS_KID = /^[A-Za-z0-9_-]{1,128}$/;

export type AccessJwtConfiguration = {
  teamDomain: string;
  audience: string;
};

export type AccessIdentity = {
  actorId: string;
  csrfSessionId: string;
  subject: string;
};

export type AccessJwtVerificationOptions = {
  jwks?: JWTVerifyGetKey;
  now?: Date;
};

export class AccessJwtError extends Error {
  constructor(message = "Access token validation failed", options?: ErrorOptions) {
    super(message, options);
    this.name = "AccessJwtError";
  }
}

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function validatedConfiguration(configuration: AccessJwtConfiguration): {
  issuer: string;
  audience: string;
} {
  if (
    typeof configuration.teamDomain !== "string" ||
    typeof configuration.audience !== "string" ||
    !ACCESS_AUDIENCE.test(configuration.audience)
  ) {
    throw new AccessJwtError("Access JWT configuration is invalid");
  }

  let url: URL;
  try {
    url = new URL(configuration.teamDomain);
  } catch (error) {
    throw new AccessJwtError("Access JWT configuration is invalid", { cause: error });
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".cloudflareaccess.com") ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new AccessJwtError("Access JWT configuration is invalid");
  }
  return { issuer: url.origin, audience: configuration.audience };
}

function remoteKeySet(issuer: string): JWTVerifyGetKey {
  const cached = remoteKeySets.get(issuer);
  if (cached !== undefined) return cached;
  const created = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
  remoteKeySets.set(issuer, created);
  return created;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function csrfUuid(digest: string): string {
  const characters = [...digest.slice(0, 32)];
  characters[12] = "4";
  characters[16] = ["8", "9", "a", "b"][Number.parseInt(characters[16] ?? "0", 16) % 4];
  const value = characters.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function verifyAccessJwt(
  token: string,
  configuration: AccessJwtConfiguration,
  options: AccessJwtVerificationOptions = {},
): Promise<AccessIdentity> {
  const { issuer, audience } = validatedConfiguration(configuration);
  if (typeof token !== "string" || token.length < 32 || token.length > 16_384) {
    throw new AccessJwtError();
  }

  try {
    const protectedHeader = decodeProtectedHeader(token);
    if (
      protectedHeader.alg !== "RS256" ||
      protectedHeader.typ !== "JWT" ||
      typeof protectedHeader.kid !== "string" ||
      !ACCESS_KID.test(protectedHeader.kid)
    ) {
      throw new AccessJwtError();
    }

    const { payload } = await jwtVerify(
      token,
      options.jwks ?? remoteKeySet(issuer),
      {
        algorithms: ["RS256"],
        issuer,
        audience,
        currentDate: options.now,
        requiredClaims: ["iss", "aud", "sub", "iat", "nbf", "exp", "email", "type"],
      },
    );
    if (
      payload.email !== ADMIN_EMAIL ||
      payload.type !== "app" ||
      typeof payload.sub !== "string" ||
      payload.sub.length < 1 ||
      payload.sub.length > 256
    ) {
      throw new AccessJwtError();
    }

    const identityDigest = await sha256(`${issuer}\n${payload.sub}`);
    return {
      actorId: `access:${identityDigest.slice(0, 32)}`,
      csrfSessionId: csrfUuid(identityDigest),
      subject: payload.sub,
    };
  } catch (error) {
    if (error instanceof AccessJwtError) throw error;
    throw new AccessJwtError(undefined, { cause: error });
  }
}

export function resetAccessJwksForTest(): void {
  remoteKeySets.clear();
}
