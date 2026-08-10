import type { Env } from "./env";

type SystemMode = "NORMAL" | "READ_ONLY" | "KILL_SWITCH";

interface ApiEnvelope<T, Code extends string> {
  ok: boolean;
  code: Code;
  requestId: string;
  serverTime: string;
  mode: SystemMode;
  data?: T;
  error?: { message: string };
}

function envelope<T, Code extends string>(
  body: Omit<ApiEnvelope<T, Code>, "requestId" | "serverTime" | "mode">,
): ApiEnvelope<T, Code> {
  return {
    ...body,
    requestId: crypto.randomUUID(),
    serverTime: new Date().toISOString(),
    mode: "NORMAL",
  };
}

function json<T, Code extends string>(
  body: ApiEnvelope<T, Code>,
  status: number,
  headers?: HeadersInit,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
  });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/status") {
      if (request.method !== "GET") {
        return json(
          envelope({
            ok: false,
            code: "METHOD_NOT_ALLOWED",
            error: { message: "Method not allowed" },
          }),
          405,
          { allow: "GET" },
        );
      }

      return json(
        envelope({
          ok: true,
          code: "OK",
          data: { status: "ok" },
        }),
        200,
      );
    }

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return json(
        envelope({
          ok: false,
          code: "NOT_FOUND",
          error: { message: "API route not found" },
        }),
        404,
      );
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export default worker;
