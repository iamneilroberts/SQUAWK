import type { Contact } from "../../src/data/types";

export type NormalizedAdsbContact = Omit<Contact, "hex"> & {
  // The Python normalizer preserves a missing identifier as null. The public traffic
  // boundary removes those unusable rows before they reach the browser.
  hex: string | null;
};

export type NormalizedAdsbPayload = {
  contacts: NormalizedAdsbContact[];
  sourceTime: number | null;
};

function numeric(value: unknown): number | null {
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function integer(value: unknown): number | null {
  const parsed = numeric(value);
  return parsed === null || !Number.isFinite(parsed) ? null : Math.trunc(parsed);
}

function databaseFlags(value: unknown): number {
  if (value === null || value === undefined || value === "" || value === false) return 0;
  if (value === true) return 1;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }
  return 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function adsbRows(payload: unknown): unknown[] | null {
  if (!record(payload)) return null;
  const rows = payload.ac ?? payload.aircraft;
  return Array.isArray(rows) ? rows : null;
}

export function normalizeSourceTime(payload: unknown): number | null {
  if (!record(payload)) return null;
  const raw = numeric(payload.now);
  if (raw === null || !Number.isFinite(raw) || raw < 0) return null;
  // readsb-family feeds use both epoch milliseconds and epoch seconds.
  return raw >= 100_000_000_000 ? raw / 1_000 : raw;
}

/** Port of backend/app/feeds/adsb.py::normalize, before public-boundary filtering. */
export function normalizeAdsbContacts(payload: unknown): NormalizedAdsbContact[] {
  const rows = adsbRows(payload);
  if (rows === null) return [];

  const contacts: NormalizedAdsbContact[] = [];
  for (const raw of rows) {
    if (!record(raw)) continue;
    const lat = numeric(raw.lat);
    const lon = numeric(raw.lon);
    if (lat === null || lon === null) continue;

    const altBaroRaw = raw.alt_baro;
    const altBaro = altBaroRaw === "ground" ? "ground" : integer(altBaroRaw);
    const flags = databaseFlags(raw.dbFlags);

    contacts.push({
      hex: text(raw.hex),
      flight: text(raw.flight),
      t: text(raw.t),
      lat,
      lon,
      alt_geom: integer(raw.alt_geom),
      alt_baro: altBaro,
      gs: numeric(raw.gs),
      track: numeric(raw.track),
      baro_rate: integer(raw.baro_rate),
      military: Boolean(flags & 1),
      seen_pos: numeric(raw.seen_pos),
    });
  }
  return contacts;
}

export function normalizeAdsbPayload(payload: unknown): NormalizedAdsbPayload {
  return {
    contacts: normalizeAdsbContacts(payload),
    sourceTime: normalizeSourceTime(payload),
  };
}

export function usableTrafficContacts(
  contacts: readonly NormalizedAdsbContact[],
): Contact[] {
  return contacts.filter((contact): contact is Contact => contact.hex !== null);
}
