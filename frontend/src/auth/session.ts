const AUTH_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const AIRCRAFT_HEX = /^[0-9a-f]{6}$/i;
const AIRPORT_ICAO = /^[A-Z0-9]{3,4}$/;
const RUNWAY_IDENT = /^[A-Z0-9]{1,8}$/;
const PROVISIONAL_BRIEFING_KEY = "adsb.provisional-briefing.v1";
const MAX_PROVISIONAL_BRIEFING_BYTES = 256;

let csrfToken: string | null = null;
let profileRequest: Promise<SessionProfile | null> | null = null;
let consumeRequest: { token: string; promise: Promise<void> } | null = null;

type FragmentLocation = Pick<Location, "hash" | "pathname" | "search">;
type FragmentHistory = Pick<History, "replaceState">;

export type ProvisionalBriefingReference = {
  aircraftHex: string;
  airportIcao?: string;
  runwayIdent?: string;
};

export type SessionProfile = {
  userId: string;
  handle: string;
  center: { lat: number; lon: number };
  regionKey: string;
  defaultAssist: "none" | "low" | "medium" | "high";
  tutorialState: "new" | "started" | "complete" | "dismissed";
  coachingEnabled: boolean;
  csrfToken: string;
};

export type ProfilePatch = Partial<
  Pick<
    SessionProfile,
    "handle" | "center" | "defaultAssist" | "tutorialState" | "coachingEnabled"
  >
>;

export class AuthClientError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly data: unknown;

  constructor(status: number, code: string | null, data?: unknown) {
    super("Authentication request failed");
    this.name = "AuthClientError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseProvisionalBriefing(value: unknown): ProvisionalBriefingReference | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.some((key) => !["aircraftHex", "airportIcao", "runwayIdent"].includes(key)) ||
    !AIRCRAFT_HEX.test(String(value.aircraftHex ?? "")) ||
    (value.airportIcao !== undefined &&
      (typeof value.airportIcao !== "string" || !AIRPORT_ICAO.test(value.airportIcao))) ||
    (value.runwayIdent !== undefined &&
      (typeof value.runwayIdent !== "string" || !RUNWAY_IDENT.test(value.runwayIdent)))
  ) {
    return null;
  }

  return {
    aircraftHex: String(value.aircraftHex),
    ...(typeof value.airportIcao === "string" ? { airportIcao: value.airportIcao } : {}),
    ...(typeof value.runwayIdent === "string" ? { runwayIdent: value.runwayIdent } : {}),
  };
}

export function captureAuthReturnFragment(
  location: FragmentLocation,
  history: FragmentHistory,
): string | null {
  if (location.hash === "") return null;

  const fragment = location.hash.startsWith("#")
    ? location.hash.slice(1)
    : location.hash;
  history.replaceState(null, "", `${location.pathname}${location.search}`);

  const params = new URLSearchParams(fragment);
  const values = params.getAll("auth_token");
  if ([...params.keys()].length !== 1 || values.length !== 1) return null;
  return AUTH_TOKEN.test(values[0] ?? "") ? values[0] ?? null : null;
}

export function saveProvisionalBriefing(
  storage: Storage,
  reference: ProvisionalBriefingReference,
): void {
  const parsed = parseProvisionalBriefing(reference);
  if (parsed === null) throw new TypeError("Provisional briefing reference is invalid");

  const serialized = JSON.stringify(parsed);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PROVISIONAL_BRIEFING_BYTES) {
    throw new TypeError("Provisional briefing reference is too large");
  }
  storage.setItem(PROVISIONAL_BRIEFING_KEY, serialized);
}

export function loadProvisionalBriefing(
  storage: Storage,
): ProvisionalBriefingReference | null {
  const serialized = storage.getItem(PROVISIONAL_BRIEFING_KEY);
  storage.removeItem(PROVISIONAL_BRIEFING_KEY);
  if (serialized === null || serialized.length > MAX_PROVISIONAL_BRIEFING_BYTES) return null;

  try {
    return parseProvisionalBriefing(JSON.parse(serialized));
  } catch {
    return null;
  }
}

function idempotencyKey(): string {
  return crypto.randomUUID();
}

async function readData<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthClientError(response.status, null);
  }
  if (
    !isRecord(body) ||
    response.ok !== true ||
    body.ok !== true ||
    !isRecord(body.data)
  ) {
    throw new AuthClientError(
      response.status,
      isRecord(body) && typeof body.code === "string" ? body.code : null,
      isRecord(body) ? body.data : undefined,
    );
  }
  return body.data as T;
}

async function postJson<T>(
  path: string,
  body: unknown,
  includeCsrf: boolean,
): Promise<T> {
  if (includeCsrf && csrfToken === null) {
    throw new AuthClientError(403, "CSRF_INVALID");
  }
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey(),
      ...(includeCsrf ? { "x-csrf-token": csrfToken ?? "" } : {}),
    },
    body: JSON.stringify(body),
  });
  return readData<T>(response);
}

export async function postAuthenticatedJson<T>(
  path: string,
  body: unknown,
  requestIdempotencyKey: string = idempotencyKey(),
): Promise<T> {
  if (csrfToken === null) throw new AuthClientError(403, "CSRF_INVALID");
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "idempotency-key": requestIdempotencyKey,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify(body),
  });
  return readData<T>(response);
}

export async function requestMagicLink(
  email: string,
  turnstileToken: string,
): Promise<void> {
  await postJson<{ message: string }>(
    "/api/auth/request",
    { email, turnstileToken },
    false,
  );
}

export function consumeAuthToken(token: string): Promise<void> {
  if (consumeRequest?.token === token) return consumeRequest.promise;
  const promise = postJson<{ csrfToken: string }>(
    "/api/auth/consume",
    { token },
    false,
  ).then((data) => {
    csrfToken = data.csrfToken;
  });
  consumeRequest = { token, promise };
  void promise.finally(() => {
    if (consumeRequest?.promise === promise) consumeRequest = null;
  }).catch(() => undefined);
  return promise;
}

async function requestCurrentProfile(): Promise<SessionProfile | null> {
  const response = await fetch("/api/me", { credentials: "same-origin" });
  if (response.status === 401) {
    csrfToken = null;
    return null;
  }
  const profile = await readData<SessionProfile>(response);
  csrfToken = profile.csrfToken;
  return profile;
}

export function loadCurrentProfile(): Promise<SessionProfile | null> {
  if (profileRequest !== null) return profileRequest;
  const request = requestCurrentProfile();
  profileRequest = request;
  void request.finally(() => {
    if (profileRequest === request) profileRequest = null;
  }).catch(() => undefined);
  return request;
}

export async function updateCurrentProfile(
  patch: ProfilePatch,
): Promise<SessionProfile> {
  if (csrfToken === null) throw new AuthClientError(403, "CSRF_INVALID");
  const response = await fetch("/api/me", {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey(),
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify(patch),
  });
  const profile = await readData<SessionProfile>(response);
  csrfToken = profile.csrfToken;
  return profile;
}

export async function signOut(): Promise<void> {
  await postJson<{ signedOut: boolean }>("/api/auth/logout", {}, true);
  csrfToken = null;
}

export async function loadTurnstileSiteKey(): Promise<string | null> {
  const response = await fetch("/api/config");
  const data = await readData<{ turnstileSiteKey?: unknown }>(response);
  return typeof data.turnstileSiteKey === "string" && data.turnstileSiteKey.length > 0
    ? data.turnstileSiteKey
    : null;
}

export function resetAuthClientForTest(): void {
  csrfToken = null;
  profileRequest = null;
  consumeRequest = null;
}
