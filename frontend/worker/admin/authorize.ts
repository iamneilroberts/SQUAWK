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
  ADMIN_EMAIL?: string;
};

export type AccessVerifier = (
  token: string,
  configuration: AccessJwtConfiguration,
) => Promise<AccessIdentity>;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function accessDenialDiagnostic(error: unknown): Record<string, string> {
  const diagnostic: Record<string, string> = { error: errorName(error) };
  if (
    typeof error === "object" &&
    error !== null &&
    "reason" in error &&
    typeof error.reason === "string"
  ) {
    diagnostic.reason = error.reason;
  }
  if (error instanceof Error && error.cause !== undefined) {
    diagnostic.cause = errorName(error.cause);
    const causeCode = errorCode(error.cause);
    if (causeCode !== undefined) diagnostic.causeCode = causeCode;
  }
  return diagnostic;
}

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
    typeof environment.ACCESS_AUD !== "string" ||
    typeof environment.ADMIN_EMAIL !== "string"
  ) {
    throw denied();
  }

  let identity: AccessIdentity;
  try {
    identity = await verifier(token, {
      teamDomain: environment.ACCESS_TEAM_DOMAIN,
      audience: environment.ACCESS_AUD,
      adminEmail: environment.ADMIN_EMAIL,
    });
  } catch (error) {
    console.error("adsb_admin_access_denied", accessDenialDiagnostic(error));
    throw denied(error);
  }
  return {
    kind: "admin",
    userId: identity.actorId,
    sessionId: identity.csrfSessionId,
    samplingKey: `admin:${identity.actorId}`,
  };
}
