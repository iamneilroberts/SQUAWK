import type { ApiEnvelope } from "../../src/shared/api";
import type { ApiErrorCode } from "../../src/shared/codes";
import type { RequestContext } from "../telemetry/requestContext";

export class ApiHttpError<Code extends ApiErrorCode = ApiErrorCode> extends Error {
  readonly status: number;
  readonly code: Code;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: Code,
    message: string,
    options: { retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiHttpError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function jsonEnvelope<T, Code extends string>(
  context: RequestContext,
  init: {
    ok: boolean;
    code: Code;
    status: number;
    data?: T;
    error?: { message: string; retryAfterSeconds?: number };
    headers?: HeadersInit;
  },
): Response {
  const body: ApiEnvelope<T, Code> = {
    ok: init.ok,
    code: init.code,
    requestId: context.requestId,
    serverTime: context.serverTime,
    mode: context.mode,
    ...(init.data === undefined ? {} : { data: init.data }),
    ...(init.error === undefined ? {} : { error: init.error }),
  };

  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body), {
    status: init.status,
    headers,
  });
}
