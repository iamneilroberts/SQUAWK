import type { TrustBoundary } from "../../src/shared/api";
import type { SystemMode } from "../../src/shared/mode";

export type RequestActor =
  | { kind: "anonymous"; samplingKey: string }
  | {
      kind: "authenticated" | "admin";
      userId: string;
      samplingKey: string;
      sessionId?: string;
      csrfDigest?: string | null;
    };

export type RequestContext = {
  requestId: string;
  serverTime: string;
  startedAtMs: number;
  mode: SystemMode;
  routeFamily: string;
  boundary?: TrustBoundary;
  actor: RequestActor;
};

export type RequestContextDependencies = {
  uuid: () => string;
  wallClock: () => Date;
  monotonicNow: () => number;
  digest: (value: string) => Promise<string>;
};

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const parsed = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  return parsed.every((part) => part >= 0 && part <= 255) ? parsed : null;
}

function expandIpv6(value: string): number[] | null {
  const withoutZone = value.split("%", 1)[0] ?? value;
  if (!/^[0-9a-fA-F:.]+$/.test(withoutZone)) return null;

  let normalized = withoutZone;
  const lastColon = normalized.lastIndexOf(":");
  const ipv4Tail = normalized.slice(lastColon + 1);
  const parsedIpv4 = parseIpv4(ipv4Tail);
  if (parsedIpv4 !== null) {
    const high = ((parsedIpv4[0] ?? 0) << 8) | (parsedIpv4[1] ?? 0);
    const low = ((parsedIpv4[2] ?? 0) << 8) | (parsedIpv4[3] ?? 0);
    normalized = `${normalized.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }

  if ((normalized.match(/::/g) ?? []).length > 1) return null;
  const [leftRaw, rightRaw] = normalized.split("::");
  const left = leftRaw === "" ? [] : (leftRaw ?? "").split(":");
  const right = rightRaw === undefined || rightRaw === "" ? [] : rightRaw.split(":");
  const hasCompression = normalized.includes("::");
  const missing = 8 - left.length - right.length;
  if ((!hasCompression && missing !== 0) || (hasCompression && missing < 1)) return null;

  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group))) {
    return null;
  }
  return groups.map((group) => Number.parseInt(group, 16));
}

export function coarseIpNetwork(ip: string | null): string {
  if (ip !== null) {
    const ipv4 = parseIpv4(ip);
    if (ipv4 !== null) {
      return `${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.0/24`;
    }

    const ipv6 = expandIpv6(ip);
    if (ipv6 !== null) {
      return `${ipv6.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
    }
  }
  return "unknown";
}

export async function sha256Digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

const DEFAULT_DEPENDENCIES: RequestContextDependencies = {
  uuid: () => crypto.randomUUID(),
  wallClock: () => new Date(),
  monotonicNow: () => performance.now(),
  digest: sha256Digest,
};

export async function createRequestContext(
  request: Request,
  route: {
    routeFamily: string;
    mode: SystemMode;
    boundary?: TrustBoundary;
    authenticatedUserId?: string;
    admin?: boolean;
  },
  dependencies: RequestContextDependencies = DEFAULT_DEPENDENCIES,
): Promise<RequestContext> {
  const requestId = dependencies.uuid();
  const serverTime = dependencies.wallClock().toISOString();
  const startedAtMs = dependencies.monotonicNow();
  const actor: RequestActor =
    route.authenticatedUserId === undefined
      ? {
          kind: "anonymous",
          samplingKey: `anon:${await dependencies.digest(
            `ip-network:${coarseIpNetwork(request.headers.get("cf-connecting-ip"))}`,
          )}`,
        }
      : {
          kind: route.admin === true ? "admin" : "authenticated",
          userId: route.authenticatedUserId,
          samplingKey: `user:${route.authenticatedUserId}`,
        };

  return {
    requestId,
    serverTime,
    startedAtMs,
    mode: route.mode,
    routeFamily: route.routeFamily,
    ...(route.boundary === undefined ? {} : { boundary: route.boundary }),
    actor,
  };
}
