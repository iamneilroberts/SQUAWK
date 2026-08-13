import { describe, it, expect } from "vitest";
import { IdentifiedContactBody } from "./IdentifiedContactCallout";
import type { Contact } from "../data/types";
import { EM_DASH } from "../hud/format";

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

const c = (o: Partial<Contact> = {}): Contact => ({
  hex: "a1b2c3", flight: "N12345", t: "C172", lat: 30.05, lon: -88.0,
  alt_geom: 3500, alt_baro: 3400, gs: 105, track: 270, baro_rate: -320,
  military: false, seen_pos: 2, ...o,
});

const render = (contact: Contact, own: { latDeg: number; lonDeg: number } | null) =>
  collectText(IdentifiedContactBody({ contact, own, onClose: () => {} })).join(" ");

describe("IdentifiedContactBody (#86)", () => {
  it("shows callsign, hex, type, altitude and ground speed", () => {
    const t = render(c(), { latDeg: 30.0, lonDeg: -88.0 });
    expect(t).toContain("N12345");
    expect(t).toContain("A1B2C3");
    expect(t).toContain("C172");
    expect(t).toContain("3500");
    expect(t).toContain("105");
  });
  it("shows range and bearing from own ship when own position is known", () => {
    const t = render(c({ lat: 30.05, lon: -88.0 }), { latDeg: 30.0, lonDeg: -88.0 });
    expect(t).toMatch(/NM/);
    expect(t).toMatch(/°/);
  });
  it("range and bearing are em-dash when own position is unknown", () => {
    const t = render(c(), null);
    expect(t).toContain(EM_DASH);
    // known feed fields still render
    expect(t).toContain("N12345");
  });
  it("unknown feed fields render as em-dash; hex always shows", () => {
    const t = render(c({ flight: null, t: null, gs: null, alt_geom: null }), null);
    expect(t).toContain(EM_DASH);
    expect(t).toContain("A1B2C3");
  });
});
