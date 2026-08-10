const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const RAW_EMAIL = /(?:^|[^\w.+-])[\w.!#$%&'*+/=?^`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:$|[^\w.-])/i;

export const JSON_BYTE_LIMITS = {
  adsbSnapshot: 24_576,
  assists: 4_096,
  evidence: 16_384,
  measurements: 16_384,
  eventContext: 4_096,
  auditState: 8_192,
} as const;

export class DatabaseValidationError extends Error {
  override readonly name = "DatabaseValidationError";
}

export class DatabaseConsistencyError extends Error {
  override readonly name = "DatabaseConsistencyError";
}

function invalid(label: string): never {
  throw new DatabaseValidationError(`${label} is invalid`);
}

function containsRawEmail(value: string): boolean {
  return RAW_EMAIL.test(` ${value} `);
}

export function requireUuid(label: string, value: string): string {
  if (!UUID.test(value)) invalid(label);
  return value.toLowerCase();
}

export function requireDigest(label: string, value: string): string {
  if (!HEX_DIGEST.test(value)) invalid(label);
  return value;
}

export function requireText(
  label: string,
  value: string,
  minimum: number,
  maximum: number,
  pattern?: RegExp,
): string {
  if (
    value !== value.trim() ||
    value.length < minimum ||
    value.length > maximum ||
    containsRawEmail(value) ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    invalid(label);
  }
  return value;
}

export function optionalText(
  label: string,
  value: string | null | undefined,
  maximum: number,
): string | null {
  if (value === null || value === undefined) return null;
  return requireText(label, value, 1, maximum);
}

export function requireTimestamp(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}

export function requireFiniteNumber(
  label: string,
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) invalid(label);
  return value;
}

export function requireInteger(
  label: string,
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value)) invalid(label);
  return requireFiniteNumber(label, value, minimum, maximum);
}

export function requireOneOf<T extends string>(
  label: string,
  value: T,
  allowed: readonly T[],
): T {
  if (!allowed.includes(value)) invalid(label);
  return value;
}

export function serializeVersionedJson(
  label: string,
  value: unknown,
  maximumBytes: number,
): string {
  const schemaVersion =
    typeof value === "object" && value !== null && "schemaVersion" in value
      ? value.schemaVersion
      : undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof schemaVersion !== "number" ||
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion < 1
  ) {
    invalid(label);
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    invalid(label);
  }
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > maximumBytes ||
    containsRawEmail(serialized)
  ) {
    invalid(label);
  }
  return serialized;
}

export function changed(result: D1Result): boolean {
  return result.meta.changes > 0;
}

export function totalChanges(results: D1Result[]): number {
  return results.reduce((total, result) => total + result.meta.changes, 0);
}

export function requireStored<T>(label: string, value: T | null): T {
  if (value === null) {
    throw new DatabaseConsistencyError(`${label} was not persisted`);
  }
  return value;
}
