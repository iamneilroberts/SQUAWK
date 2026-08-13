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
      biz: "efis",
      tprop: "sixpack",
    };
    for (const id of DASHBOARD_PROFILE_IDS) {
      expect(profileForClass(id).primary).toBe(expected[id]);
      expect(profileForClass(id).classId).toBe(id);
    }
  });

  it("keeps the original three flight models on distinct primaries, and gives the bizjet the airliner's EFIS family", () => {
    const original = ["c172s", "b738", "f5e"].map((id) => profileForClass(id).primary);
    expect(new Set(original).size).toBe(original.length);
    expect(profileForClass("biz").primary).toBe(profileForClass("b738").primary);
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
    const resolution = resolveClass(contact("F16")); // F16 is a fighter designator
    expect(resolution.supported).toBe(true);
    if (!resolution.supported) throw new Error("fixture must be supported");
    const params = loadClassById(resolution.classId);
    expect(params.id).toBe(resolution.classId);
    expect(profileForClass(resolution.classId).primary).toBe("hud");
  });

  it("does not route a missing type into any dashboard profile", () => {
    expect(resolveClass(contact(null))).toMatchObject({ supported: false, classId: null });
  });

  it("throws on an unknown class id — a missing profile is a bug, not silent data", () => {
    expect(() => profileForClass("no-such-class")).toThrow(/no dashboard profile/);
  });

  it("keeps a realistic-art background seam per profile, transparent until the art pass", () => {
    for (const id of DASHBOARD_PROFILE_IDS) {
      expect(profileForClass(id).background).toBe("transparent");
    }
  });

  it("gives the bizjet an EFIS dashboard profile", () => {
    expect(profileForClass("biz")).toEqual({ classId: "biz", primary: "efis", background: "transparent" });
  });

  it("gives the turboprop a six-pack dashboard profile (steam gauges, like the GA single)", () => {
    expect(profileForClass("tprop")).toEqual({ classId: "tprop", primary: "sixpack", background: "transparent" });
  });
});
