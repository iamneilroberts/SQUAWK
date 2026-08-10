export const API_SUCCESS_CODES = ["OK", "RESULT_ACCEPTED"] as const;

export const API_ERROR_CODES = [
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "INVALID_REQUEST",
  "REQUEST_TOO_LARGE",
  "ORIGIN_REQUIRED",
  "ORIGIN_MISMATCH",
  "CSRF_INVALID",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_INVALID",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "RATE_LIMITED",
  "LIMITER_UNAVAILABLE",
  "ADMISSION_DENIED",
  "BROKER_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type ApiSuccessCode = (typeof API_SUCCESS_CODES)[number];
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export type ApiCode = ApiSuccessCode | ApiErrorCode;
