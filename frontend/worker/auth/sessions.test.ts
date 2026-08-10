import { describe, expect, it } from "vitest";

import {
  clearSessionCookie,
  encodeOpaqueToken,
  readSessionCookie,
  sessionCookie,
} from "./sessions";

const TOKEN = encodeOpaqueToken(new Uint8Array(32).fill(7));

describe("opaque browser sessions", () => {
  it("encodes 256 random bits without padding", () => {
    expect(TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(TOKEN).not.toContain("=");
  });

  it("issues and clears the exact hardened host cookie", () => {
    const issued = sessionCookie(TOKEN, 2_592_000);
    expect(issued).toContain(`__Host-adsb_session=${TOKEN}`);
    expect(issued).toContain("Secure");
    expect(issued).toContain("HttpOnly");
    expect(issued).toContain("SameSite=Lax");
    expect(issued).toContain("Path=/");
    expect(issued).toContain("Max-Age=2592000");

    expect(clearSessionCookie()).toBe(
      "__Host-adsb_session=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    );
  });

  it("reads one exact cookie and rejects duplicates or malformed values", () => {
    expect(readSessionCookie(`a=1; __Host-adsb_session=${TOKEN}; b=2`)).toBe(TOKEN);
    expect(
      readSessionCookie(
        `__Host-adsb_session=${TOKEN}; __Host-adsb_session=${TOKEN}`,
      ),
    ).toBeNull();
    expect(readSessionCookie("__Host-adsb_session=short")).toBeNull();
    expect(readSessionCookie(null)).toBeNull();
  });
});
