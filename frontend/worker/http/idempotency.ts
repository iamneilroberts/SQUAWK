import { ApiHttpError } from "./response";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function readIdempotencyKey(headers: Headers): string {
  const value = headers.get("idempotency-key");
  if (value === null || value === "") {
    throw new ApiHttpError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "An Idempotency-Key header is required",
    );
  }
  if (value !== value.trim() || !IDEMPOTENCY_KEY.test(value)) {
    throw new ApiHttpError(
      400,
      "IDEMPOTENCY_KEY_INVALID",
      "The Idempotency-Key header is invalid",
    );
  }
  return value;
}
