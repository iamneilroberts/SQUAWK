import type {
  MissionPreparationPayload,
  MissionReceiptPayload,
} from "../../src/mission/contract";
import { MISSION_MAX_ELIGIBLE_CHOICES } from "../../src/shared/limits";

const TOKEN_VERSION = "v1";
const TOKEN_MAX_LENGTH = 32_768;
const SECRET_MIN_LENGTH = 32;
const SECRET_MAX_LENGTH = 4_096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{6}$/;
const CHOICE_KEY = /^[A-Z0-9]{3,4}:[A-Za-z0-9_-]{1,32}:[A-Z0-9]{1,8}$/;

export class MissionAuthorizationError extends Error {
  override readonly name = "MissionAuthorizationError";
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new MissionAuthorizationError("Mission authorization is invalid");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new MissionAuthorizationError("Mission authorization is invalid");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  if (
    typeof secret !== "string" ||
    secret.length < SECRET_MIN_LENGTH ||
    secret.length > SECRET_MAX_LENGTH
  ) {
    throw new MissionAuthorizationError("Mission signing secret is invalid");
  }
  return crypto.subtle.importKey(
    "raw",
    bytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signPayload(payload: unknown, secret: string): Promise<string> {
  const encoded = base64Url(bytes(JSON.stringify(payload)));
  const signingInput = `${TOKEN_VERSION}.${encoded}`;
  const signature = await crypto.subtle.sign("HMAC", await key(secret), bytes(signingInput));
  const token = `${signingInput}.${base64Url(new Uint8Array(signature))}`;
  if (token.length > TOKEN_MAX_LENGTH) throw new MissionAuthorizationError("Mission authorization is too large");
  return token;
}

async function verifyPayload(token: string, secret: string): Promise<unknown> {
  if (typeof token !== "string" || token.length < 32 || token.length > TOKEN_MAX_LENGTH) {
    throw new MissionAuthorizationError("Mission authorization is invalid");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    throw new MissionAuthorizationError("Mission authorization is invalid");
  }
  const encoded = parts[1] ?? "";
  const valid = await crypto.subtle.verify(
    "HMAC",
    await key(secret),
    decodeBase64Url(parts[2] ?? ""),
    bytes(`${TOKEN_VERSION}.${encoded}`),
  );
  if (!valid) throw new MissionAuthorizationError("Mission authorization is invalid");
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded)));
  } catch {
    throw new MissionAuthorizationError("Mission authorization is invalid");
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function versionSet(value: unknown): boolean {
  if (!record(value)) return false;
  const keys = [
    "airportDataset",
    "aircraftProfile",
    "missionProfile",
    "assignment",
    "scoring",
    "physics",
    "assistDefinition",
  ];
  return Object.keys(value).length === keys.length &&
    keys.every((name) => typeof value[name] === "string" && String(value[name]).length <= 48);
}

function preparation(value: unknown): value is MissionPreparationPayload {
  if (!record(value)) return false;
  const choices = value.eligibleChoices;
  return (
    value.schemaVersion === 1 &&
    value.purpose === "mission-preparation" &&
    typeof value.preparationId === "string" && UUID.test(value.preparationId) &&
    typeof value.userId === "string" && UUID.test(value.userId) &&
    timestamp(value.issuedAt) && timestamp(value.expiresAt) && Number(value.expiresAt) > Number(value.issuedAt) &&
    record(value.contact) && typeof value.contact.hex === "string" && HEX.test(value.contact.hex) &&
    record(value.traffic) &&
    (value.classId === "c172s" || value.classId === "b738" || value.classId === "f5e") &&
    record(value.selected) &&
    Array.isArray(choices) && choices.length > 0 && choices.length <= MISSION_MAX_ELIGIBLE_CHOICES &&
    choices.every(record) &&
    versionSet(value.versions) &&
    typeof value.fingerprint === "string" && value.fingerprint.length <= 4_096
  );
}

function receipt(value: unknown): value is MissionReceiptPayload {
  return record(value) &&
    value.schemaVersion === 1 &&
    value.purpose === "mission-receipt" &&
    typeof value.missionId === "string" && UUID.test(value.missionId) &&
    typeof value.aircraftHex === "string" && HEX.test(value.aircraftHex) &&
    typeof value.choiceKey === "string" && CHOICE_KEY.test(value.choiceKey) &&
    timestamp(value.lockedAt) && timestamp(value.expiresAt) && Number(value.expiresAt) > Number(value.lockedAt) &&
    versionSet(value.versions);
}

export function signMissionPreparation(
  payload: MissionPreparationPayload,
  secret: string,
): Promise<string> {
  if (!preparation(payload)) throw new MissionAuthorizationError("Mission preparation is invalid");
  return signPayload(payload, secret);
}

export async function verifyMissionPreparation(options: {
  token: string;
  secret: string;
  userId: string;
  now: number;
}): Promise<MissionPreparationPayload> {
  const payload = await verifyPayload(options.token, options.secret);
  if (!preparation(payload) || payload.userId !== options.userId) {
    throw new MissionAuthorizationError("Mission preparation is invalid");
  }
  if (payload.expiresAt <= options.now) {
    throw new MissionAuthorizationError("Mission preparation has expired");
  }
  return payload;
}

export function signMissionReceipt(
  payload: MissionReceiptPayload,
  secret: string,
): Promise<string> {
  if (!receipt(payload)) throw new MissionAuthorizationError("Mission receipt is invalid");
  return signPayload(payload, secret);
}

export async function verifyMissionReceipt(options: {
  token: string;
  secret: string;
  now: number;
}): Promise<MissionReceiptPayload> {
  const payload = await verifyPayload(options.token, options.secret);
  if (!receipt(payload) || payload.expiresAt <= options.now) {
    throw new MissionAuthorizationError("Mission receipt is invalid");
  }
  return payload;
}
