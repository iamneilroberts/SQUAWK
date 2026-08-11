import type { RequestActor } from "../telemetry/requestContext";
import { ApiHttpError } from "../http/response";
import {
  verifyAccessJwt,
  type AccessIdentity,
  type AccessJwtConfiguration,
} from "./accessJwt";

export type AdminAccessEnvironment = {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
};

export type AccessVerifier = (
  token: string,
  configuration: AccessJwtConfiguration,
) => Promise<AccessIdentity>;

function denied(cause?: unknown): ApiHttpError {
  return new ApiHttpError(
    403,
    "FORBIDDEN",
    "Administrator access is required",
    cause === undefined ? {} : { cause },
  );
}

export async function authorizeAdminRequest(
  request: Request,
  environment: AdminAccessEnvironment,
  verifier: AccessVerifier = verifyAccessJwt,
): Promise<RequestActor> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (
    token === null ||
    typeof environment.ACCESS_TEAM_DOMAIN !== "string" ||
    typeof environment.ACCESS_AUD !== "string"
  ) {
    throw denied();
  }

  let identity: AccessIdentity;
  try {
    identity = await verifier(token, {
      teamDomain: environment.ACCESS_TEAM_DOMAIN,
      audience: environment.ACCESS_AUD,
    });
  } catch (error) {
    throw denied(error);
  }
  return {
    kind: "admin",
    userId: identity.actorId,
    sessionId: identity.csrfSessionId,
    samplingKey: `admin:${identity.actorId}`,
  };
}
