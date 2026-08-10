import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureAuthReturnFragment,
  consumeAuthToken,
  loadProvisionalBriefing,
  resetAuthClientForTest,
  saveProvisionalBriefing,
  type ProvisionalBriefingReference,
} from "./session";

const TOKEN = "A".repeat(43);

afterEach(() => {
  vi.unstubAllGlobals();
  resetAuthClientForTest();
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("browser auth return state", () => {
  it("removes a valid fragment before returning its one in-memory token", () => {
    const replaceState = vi.fn();
    const token = captureAuthReturnFragment(
      { hash: `#auth_token=${TOKEN}`, pathname: "/briefing", search: "?aircraft=abc123" },
      { replaceState },
    );

    expect(token).toBe(TOKEN);
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/briefing?aircraft=abc123",
    );
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain(TOKEN);
  });

  it.each([
    "#auth_token=short",
    `#auth_token=${TOKEN}&extra=1`,
    `#token=${TOKEN}`,
    "#",
  ])("clears but refuses malformed or ambiguous fragments: %s", (hash) => {
    const replaceState = vi.fn();
    expect(
      captureAuthReturnFragment(
        { hash, pathname: "/", search: "" },
        { replaceState },
      ),
    ).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/");
  });

  it("stores only a bounded provisional briefing reference and consumes it once", () => {
    const storage = memoryStorage();
    const reference: ProvisionalBriefingReference = {
      aircraftHex: "abc123",
      airportIcao: "KMOB",
      runwayIdent: "15",
    };

    saveProvisionalBriefing(storage, reference);
    expect(loadProvisionalBriefing(storage)).toEqual(reference);
    expect(loadProvisionalBriefing(storage)).toBeNull();
    expect(JSON.stringify(storage)).not.toContain("token");
  });

  it("drops corrupt, oversized, and authority-bearing briefing state", () => {
    const storage = memoryStorage();
    storage.setItem(
      "adsb.provisional-briefing.v1",
      JSON.stringify({ aircraftHex: "abc123", userId: "authority" }),
    );
    expect(loadProvisionalBriefing(storage)).toBeNull();

    expect(() =>
      saveProvisionalBriefing(storage, {
        aircraftHex: "abc123",
        airportIcao: "X".repeat(10),
      }),
    ).toThrow();
  });

  it("deduplicates the StrictMode consume effect and never puts its token in a URL", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await pending;
      expect(String(input)).toBe("/api/auth/consume");
      expect(String(input)).not.toContain(TOKEN);
      expect(JSON.parse(String(init?.body))).toEqual({ token: TOKEN });
      return Response.json({ ok: true, data: { csrfToken: "B".repeat(43) } });
    });
    vi.stubGlobal("fetch", fetcher);

    const first = consumeAuthToken(TOKEN);
    const second = consumeAuthToken(TOKEN);
    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledOnce();
    release?.();
    await expect(first).resolves.toBeUndefined();
  });
});
