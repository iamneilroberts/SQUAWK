import type { SystemMode } from "./mode";

export type ApiError = {
  message: string;
  retryAfterSeconds?: number;
};

export type ApiEnvelope<T, Code extends string = "OK"> = {
  ok: boolean;
  code: Code;
  requestId: string;
  serverTime: string;
  mode: SystemMode;
  data?: T;
  error?: ApiError;
};

export type TrustBoundary = "public" | "authenticated" | "admin";
