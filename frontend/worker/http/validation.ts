import { ApiHttpError } from "./response";

export const DEFAULT_MAX_JSON_BODY_BYTES = 128 * 1024;
export const MIN_RADIUS_NM = 10;
export const MAX_RADIUS_NM = 250;

export class ValidationError extends ApiHttpError<
  "INVALID_REQUEST" | "REQUEST_TOO_LARGE"
> {}

function finiteNumber(value: unknown, label: string): number {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    throw new ValidationError(400, "INVALID_REQUEST", `${label} must be a number`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(400, "INVALID_REQUEST", `${label} must be finite`);
  }
  return parsed;
}

export function validateCoordinates(
  latitude: unknown,
  longitude: unknown,
): { latitude: number; longitude: number } {
  const parsedLatitude = finiteNumber(latitude, "latitude");
  const parsedLongitude = finiteNumber(longitude, "longitude");
  if (parsedLatitude < -90 || parsedLatitude > 90) {
    throw new ValidationError(400, "INVALID_REQUEST", "latitude is out of range");
  }
  if (parsedLongitude < -180 || parsedLongitude > 180) {
    throw new ValidationError(400, "INVALID_REQUEST", "longitude is out of range");
  }
  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

export function validateRadiusNm(value: unknown): number {
  const radius = finiteNumber(value, "radiusNm");
  if (radius < MIN_RADIUS_NM || radius > MAX_RADIUS_NM) {
    throw new ValidationError(400, "INVALID_REQUEST", "radiusNm is out of range");
  }
  return radius;
}

export function clampRadiusNm(value: unknown): number {
  const radius = finiteNumber(value, "radiusNm");
  return Math.min(MAX_RADIUS_NM, Math.max(MIN_RADIUS_NM, radius));
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mime = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mime === "application/json" || mime.endsWith("+json");
}

async function readBoundedBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new ValidationError(413, "REQUEST_TOO_LARGE", "Request body is too large");
    }
  }

  if (request.body === null) {
    throw new ValidationError(400, "INVALID_REQUEST", "A JSON body is required");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request body limit exceeded");
        throw new ValidationError(413, "REQUEST_TOO_LARGE", "Request body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBoundedJsonBody(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw new ValidationError(400, "INVALID_REQUEST", "Content-Type must be application/json");
  }

  const bytes = await readBoundedBytes(request, maxBytes);
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ValidationError(400, "INVALID_REQUEST", "Request body is not valid JSON", {
      cause: error,
    });
  }
}
