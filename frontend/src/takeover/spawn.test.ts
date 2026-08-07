import { describe, it, expect } from "vitest";
import { buildSpawnState } from "./spawn";
import { loadC172, loadB738, loadF5e } from "../sim/params";
import { stallSpeedIasMs } from "../sim/forces";
import { ecefToGeodetic } from "../sim/geo";
import { hprFromQuat } from "../sim/quat";
import { ftToM, msToKt, mToFt, radToDeg } from "../sim/units";
import { tasToIas, machNumber } from "../sim/isa";
import { vLength } from "../sim/vec3";
import type { Contact } from "../data/types";

const P = loadC172();

const ga = (overrides: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.6944, lon: -88.0399,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: 0,
  military: false, seen_pos: 2,
  ...overrides,
});

describe("buildSpawnState — units and datum", () => {
  it("puts the aircraft at the contact's lat/lon", () => {
    const { state } = buildSpawnState(ga(), P, { terrainHeightM: 20 });
    const g = ecefToGeodetic(state.position);
    expect(radToDeg(g.latRad)).toBeCloseTo(30.6944, 5);
    expect(radToDeg(g.lonRad)).toBeCloseTo(-88.0399, 5);
  });
  it("prefers alt_geom (ellipsoidal — same datum as the terrain)", () => {
    const r = buildSpawnState(ga({ alt_geom: 3500, alt_baro: 3400 }), P, { terrainHeightM: 20 });
    expect(r.altitudeSource).toBe("alt_geom");
    expect(mToFt(r.state.altitudeM)).toBeCloseTo(3500, 1);
  });
  it("converts knots to m/s", () => {
    const { state } = buildSpawnState(ga({ gs: 105 }), P, { terrainHeightM: 20 });
    expect(msToKt(state.tasMs)).toBeCloseTo(105, 1);
    expect(msToKt(vLength(state.velocity))).toBeCloseTo(105, 1);
  });
  it("converts track to heading", () => {
    const { state } = buildSpawnState(ga({ track: 270 }), P, { terrainHeightM: 20 });
    const hpr = hprFromQuat(state.attitude, state.position);
    const heading = (radToDeg(hpr.headingRad) + 360) % 360;
    expect(heading).toBeCloseTo(270, 1);
  });
  it("converts baro_rate (fpm) to a vertical speed and a nose-up attitude", () => {
    const { state } = buildSpawnState(ga({ baro_rate: 500 }), P, { terrainHeightM: 20 });
    expect(state.verticalSpeedMs).toBeGreaterThan(2);
    expect(hprFromQuat(state.attitude, state.position).pitchRad).toBeGreaterThan(0);
  });
  it("treats a missing baro_rate as level, not as a dive", () => {
    const { state } = buildSpawnState(ga({ baro_rate: null }), P, { terrainHeightM: 20 });
    expect(state.verticalSpeedMs).toBeCloseTo(0, 1);
  });
  it("discloses the level-flight assumption when baro_rate is missing", () => {
    const r = buildSpawnState(ga({ baro_rate: null }), P, { terrainHeightM: 20 });
    expect(r.adjustments).toContainEqual({
      field: "VERTICAL RATE",
      from: "—",
      to: "ASSUMED LEVEL",
      reason: "No baro_rate in the feed.",
    });
  });
  it("does not disclose a vertical-rate assumption when baro_rate is present", () => {
    const r = buildSpawnState(ga({ baro_rate: 500 }), P, { terrainHeightM: 20 });
    expect(r.adjustments.some((a) => a.field === "VERTICAL RATE")).toBe(false);
  });
  it("spawns wings level with no rotation rates and zero sim time", () => {
    const { state } = buildSpawnState(ga(), P, { terrainHeightM: 20 });
    expect(radToDeg(hprFromQuat(state.attitude, state.position).rollRad)).toBeCloseTo(0, 6);
    expect(state.rates).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.timeS).toBe(0);
  });
  it("hands over a throttle that roughly holds the snapshot speed, not idle", () => {
    const { controls } = buildSpawnState(ga(), P, { terrainHeightM: 20 });
    expect(controls.throttle).toBeGreaterThan(0.2);
    expect(controls.throttle).toBeLessThanOrEqual(1);
    expect(controls.flapDetent).toBe(0);
  });
});

describe("buildSpawnState — the alt_baro fallback path", () => {
  it("uses alt_baro when alt_geom is missing and says so", () => {
    const r = buildSpawnState(ga({ alt_geom: null, alt_baro: 3400 }), P, { terrainHeightM: 20 });
    expect(r.altitudeSource).toBe("alt_baro");
    expect(r.adjustments.some((a) => /pressure altitude/i.test(a.reason))).toBe(true);
  });
  it("clamps a pressure altitude to at least terrain + 300 m and lists the adjustment", () => {
    const terrain = ftToM(3000);
    const r = buildSpawnState(ga({ alt_geom: null, alt_baro: 3100 }), P, { terrainHeightM: terrain });
    expect(r.state.altitudeM).toBeCloseTo(terrain + 300, 1);
    const adj = r.adjustments.find((a) => a.field === "ALTITUDE");
    expect(adj).toBeTruthy();
    expect(adj!.to).toContain("FT");
  });
  it("does not clamp a pressure altitude that is already clear of terrain", () => {
    const r = buildSpawnState(ga({ alt_geom: null, alt_baro: 8000 }), P, { terrainHeightM: 100 });
    expect(mToFt(r.state.altitudeM)).toBeCloseTo(8000, 1);
  });
  it("cannot clamp when terrain height is unknown, and says that too", () => {
    const r = buildSpawnState(ga({ alt_geom: null, alt_baro: 3100 }), P, { terrainHeightM: null });
    expect(mToFt(r.state.altitudeM)).toBeCloseTo(3100, 1);
    expect(r.adjustments.some((a) => /terrain height unknown/i.test(a.reason))).toBe(true);
  });
});

describe("buildSpawnState — envelope safety net", () => {
  it("raises a below-stall snapshot to 1.3 Vs and lists it", () => {
    const r = buildSpawnState(ga({ gs: 30 }), P, { terrainHeightM: 20 });
    const ias = tasToIas(r.state.tasMs, r.state.altitudeM);
    expect(ias).toBeGreaterThanOrEqual(1.3 * stallSpeedIasMs(P, 0) - 1e-6);
    const adj = r.adjustments.find((a) => a.field === "SPEED");
    expect(adj).toBeTruthy();
    expect(adj!.from).toContain("30");
    expect(adj!.reason).toMatch(/stall/i);
  });
  it("lowers an above-Vne snapshot to 0.9 Vne and lists it", () => {
    const r = buildSpawnState(ga({ gs: 260 }), P, { terrainHeightM: 20 });
    const ias = tasToIas(r.state.tasMs, r.state.altitudeM);
    expect(ias).toBeLessThanOrEqual(0.9 * P.limits.vneIasMs + 1e-6);
    expect(r.adjustments.find((a) => a.field === "SPEED")!.reason).toMatch(/vne/i);
  });
  it("clamps above-ceiling altitude and lists it", () => {
    const r = buildSpawnState(ga({ alt_geom: 20000 }), P, { terrainHeightM: 20 });
    expect(r.state.altitudeM).toBeLessThanOrEqual(P.limits.serviceCeilingM + 1e-6);
    expect(r.adjustments.find((a) => a.field === "ALTITUDE")!.reason).toMatch(/ceiling/i);
  });
  it("adjusts nothing for a snapshot already inside the envelope", () => {
    expect(buildSpawnState(ga(), P, { terrainHeightM: 20 }).adjustments).toEqual([]);
  });
  it("every adjustment carries a from, a to and a reason (the card prints them verbatim)", () => {
    const r = buildSpawnState(ga({ gs: 30, alt_geom: 20000 }), P, { terrainHeightM: 20 });
    expect(r.adjustments.length).toBeGreaterThanOrEqual(2);
    for (const a of r.adjustments) {
      expect(a.field.length).toBeGreaterThan(0);
      expect(a.from.length).toBeGreaterThan(0);
      expect(a.to.length).toBeGreaterThan(0);
      expect(a.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("buildSpawnState — per-class thrust lapse (no hidden piston assumption)", () => {
  it("trims a turbofan class using its own lapse, not the piston curve", () => {
    const b738 = loadB738();
    const c = { t: "A320", gs: 450, alt_geom: 35000, alt_baro: 35000, baro_rate: 0,
      lat: 30, lon: -88, track: 90, hex: "abc", flight: "T", military: false, seen_pos: 2 } as Contact;
    const spawn = buildSpawnState(c, b738, { terrainHeightM: null });
    // The trimmed throttle holds level flight: re-derive drag and confirm thrust ≈ drag at spawn.
    expect(spawn.controls.throttle).toBeGreaterThan(0);
    expect(spawn.controls.throttle).toBeLessThanOrEqual(1);
    expect(spawn.state.machNumber).toBeGreaterThan(0.6); // it spawned at a real cruise Mach
  });

  it("holds level with power to spare, not pinned at full throttle (the piston-lapse tell)", () => {
    // FL350 is below the turbofan corner (11582 m), so the flat-rated turbofan gives lapse 1.0
    // while the piston curve at that density gives ~0.22 — enough to leave the trimmed throttle
    // pinned at the 1.0 clamp (underpowered) if spawn.ts kept the piston assumption for a jet.
    const b738 = loadB738();
    const c = { t: "A320", gs: 450, alt_geom: 35000, alt_baro: 35000, baro_rate: 0,
      lat: 30, lon: -88, track: 90, hex: "abc", flight: "T", military: false, seen_pos: 2 } as Contact;
    const spawn = buildSpawnState(c, b738, { terrainHeightM: null });
    expect(spawn.controls.throttle).toBeLessThan(1);
  });
});

describe("buildSpawnState — envelope safety net (Mmo)", () => {
  it("clamps a spawn TAS that would exceed Mmo at altitude, even though IAS is nowhere near Vne", () => {
    // At 15000 m (49213 ft) a 631 kt ground speed is Mach ~1.1 for the F-5E (Mmo 0.95),
    // but the IAS it corresponds to at that density is only ~130 m/s — far under the
    // 0.9*Vne (324 m/s) clamp. Without an Mmo clamp this snapshot spawns already
    // over-Mmo, tripping the HUD's MMO annunciator on an aircraft the handoff calls trimmed.
    const f5e = loadF5e();
    const altFt = mToFt(15000);
    const c: Contact = {
      hex: "abc", flight: "T", t: "F5E", lat: 30, lon: -88,
      alt_geom: altFt, alt_baro: altFt, gs: 631, track: 90, baro_rate: 0,
      military: false, seen_pos: 2,
    };
    const r = buildSpawnState(c, f5e, { terrainHeightM: null });
    const mach = machNumber(r.state.tasMs, r.state.altitudeM);
    expect(mach).toBeLessThanOrEqual(f5e.limits.mmo + 1e-6);
    const adj = r.adjustments.find((a) => a.field === "SPEED");
    expect(adj).toBeTruthy();
    expect(adj!.reason).toMatch(/mmo/i);
  });

  it("does not touch a normal subsonic cruise spawn (b738) — Mmo clamp is inert below Mmo", () => {
    const b738 = loadB738();
    const c: Contact = {
      hex: "abc", flight: "T", t: "A320", lat: 30, lon: -88,
      alt_geom: 35000, alt_baro: 35000, gs: 450, track: 90, baro_rate: 0,
      military: false, seen_pos: 2,
    };
    const r = buildSpawnState(c, b738, { terrainHeightM: null });
    expect(r.adjustments).toEqual([]);
  });

  it("does not touch the C172 (its Mmo of 0.45 is unreachable) — Mmo clamp is data-driven, inert here", () => {
    const r = buildSpawnState(ga(), P, { terrainHeightM: 20 });
    expect(r.adjustments).toEqual([]);
  });
});

describe("buildSpawnState — purity", () => {
  it("does not mutate the contact it was handed", () => {
    const c = ga({ gs: 30 });
    const before = JSON.stringify(c);
    buildSpawnState(c, P, { terrainHeightM: 20 });
    expect(JSON.stringify(c)).toBe(before);
  });
  it("is deterministic", () => {
    const a = buildSpawnState(ga(), P, { terrainHeightM: 20 });
    const b = buildSpawnState(ga(), P, { terrainHeightM: 20 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
