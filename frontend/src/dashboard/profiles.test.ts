import { describe, it, expect } from "vitest";
import { profileForClass, DASHBOARD_PROFILE_IDS, type PrimaryKind } from "./profiles";
import { loadClassById } from "../sim/params";
import { resolveClass } from "../takeover/eligibility";
import type { Contact } from "../data/types";

const contact = (t: string | null): Contact => ({
  hex: "a1b2c3", flight: "N1", t, lat: 0, lon: 0, alt_geom: 3000, alt_baro: 3000,
  gs: 200, track: 0, baro_rate: 0, military: false, seen_pos: 2,
});

describe("class -> dashboard-profile registry (data, not branches)", () => {
  // The whole point of the registry: the SAME lookup resolves every class, with no per-class
  // conditional. Proven by iterating the table and asserting each row maps to a real profile.
  it("returns exactly the right primary layout for each known class id", () => {
    const expected: Record<string, PrimaryKind> = {
      c172s: "sixpack",
      b738: "efis",
      f5e: "hud",
    };
    for (const id of DASHBOARD_PROFILE_IDS) {
      expect(profileForClass(id).primary).toBe(expected[id]);
      expect(profileForClass(id).classId).toBe(id);
    }
  });

  it("distinguishes the three flight models — no two share a primary", () => {
    const primaries = DASHBOARD_PROFILE_IDS.map((id) => profileForClass(id).primary);
    expect(new Set(primaries).size).toBe(primaries.length);
  });

  // Broken-arm: if the resolver ever fell back to one hard-coded default (e.g. always sixpack),
  // the fighter would NOT get the HUD. This proves the lookup actually reads the class id.
  it("routes the fighter to the HUD and the airliner to EFIS, not the piston default", () => {
    expect(profileForClass("f5e").primary).toBe("hud");
    expect(profileForClass("b738").primary).toBe("efis");
    expect(profileForClass("f5e").primary).not.toBe(profileForClass("c172s").primary);
  });

  // The registry lines up with the real resolveClass -> loadClassById path DashboardStrip uses:
  // a fighter contact -> class id f5e -> HUD profile, end to end, still no branch.
  it("agrees with resolveClass + loadClassById for a real fighter contact", () => {
    const classId = resolveClass(contact("F16")).classId; // F16 is a fighter designator
    const params = loadClassById(classId);
    expect(params.id).toBe(classId);
    expect(profileForClass(classId).primary).toBe("hud");
  });

  it("falls the unmatched/GA contact to the six-pack via the c172s default class", () => {
    const classId = resolveClass(contact(null)).classId; // no type -> c172s default
    expect(classId).toBe("c172s");
    expect(profileForClass(classId).primary).toBe("sixpack");
  });

  it("throws on an unknown class id — a missing profile is a bug, not silent data", () => {
    expect(() => profileForClass("no-such-class")).toThrow(/no dashboard profile/);
  });

  it("keeps a realistic-art background seam per profile, transparent until the art pass", () => {
    for (const id of DASHBOARD_PROFILE_IDS) {
      expect(profileForClass(id).background).toBe("transparent");
    }
  });
});
