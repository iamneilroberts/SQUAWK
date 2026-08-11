import type { Env } from "../env";
import { applySecurityHeaders } from "../http/security";
import type { RequestActor } from "../telemetry/requestContext";
import { authorizeAdminRequest } from "./authorize";

export type AdminShellAuthorizer = (
  request: Request,
  environment: Env,
) => Promise<RequestActor>;

function privateAccessResponse(response: Response, env: Env): Response {
  const secured = applySecurityHeaders(response, env.APP_ENV);
  secured.headers.set("cache-control", "private, no-store");
  const vary = secured.headers.get("vary");
  const values = new Set(
    (vary === null ? [] : vary.split(","))
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
  values.add("Cf-Access-Jwt-Assertion");
  secured.headers.set("vary", [...values].join(", "));
  return secured;
}

export async function serveAdminShell(
  request: Request,
  env: Env,
  authorize: AdminShellAuthorizer = authorizeAdminRequest,
): Promise<Response> {
  try {
    const actor = await authorize(request, env);
    if (actor.kind !== "admin") throw new Error("Admin actor required");
  } catch {
    return privateAccessResponse(
      new Response("Administrator access is required", { status: 403 }),
      env,
    );
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return privateAccessResponse(
      new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      }),
      env,
    );
  }

  return privateAccessResponse(await env.ASSETS.fetch(request), env);
}
