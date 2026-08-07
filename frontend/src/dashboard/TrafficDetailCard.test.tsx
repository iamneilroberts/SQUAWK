import { describe, it, expect } from "vitest";
import { TrafficDetailBody, type EnrichmentState } from "./TrafficDetailCard";
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

const ok: EnrichmentState = {
  kind: "ok",
  info: { type: "172S Skyhawk", manufacturer: "Cessna", registration: "N12345", available: true },
};

const render = (contact: Contact, enrichment: EnrichmentState) =>
  collectText(TrafficDetailBody({ contact, enrichment, onClose: () => {} })).join(" ");

describe("TrafficDetailBody — feed fields", () => {
  it("shows what the feed actually sent", () => {
    const text = render(c(), ok);
    expect(text).toContain("N12345");
    expect(text).toContain("A1B2C3");
    expect(text).toContain("C172");
    expect(text).toContain("3500");
    expect(text).toContain("105");
    expect(text).toContain("270");
  });

  it("em-dashes every field the feed omitted instead of showing a zero", () => {
    const text = render(
      c({ flight: null, t: null, alt_geom: null, gs: null, track: null, baro_rate: null, seen_pos: null }),
      ok,
    );
    expect(text).toContain(EM_DASH);
    expect(text).not.toMatch(/\b0 KT\b/);
  });

  it("renders alt_baro's literal 'ground' as GROUND, not as a number", () => {
    expect(render(c({ alt_baro: "ground" }), ok)).toContain("GROUND");
  });

  it("shows the military flag only when the feed set it", () => {
    expect(render(c({ military: true }), ok)).toContain("MILITARY");
    expect(render(c({ military: false }), ok)).not.toContain("MILITARY");
  });
});

describe("TrafficDetailBody — the three adsbdb states are distinct", () => {
  it("says the lookup is in flight while it is in flight", () => {
    const text = render(c(), { kind: "loading" });
    expect(text).toContain("ADSBDB LOOKUP…");
    expect(text).not.toContain("NO ADSBDB RECORD");
    expect(text).not.toContain("ADSBDB UNREACHABLE");
  });

  it("says NO ADSBDB RECORD when adsbdb answered and has never heard of the hex", () => {
    const text = render(c(), {
      kind: "ok", info: { type: null, manufacturer: null, registration: null, available: true },
    });
    expect(text).toContain("NO ADSBDB RECORD");
    expect(text).not.toContain("ADSBDB UNREACHABLE");
  });

  it("says ADSBDB UNREACHABLE when the lookup itself failed", () => {
    const text = render(c(), { kind: "unreachable" });
    expect(text).toContain("ADSBDB UNREACHABLE");
    expect(text).not.toContain("NO ADSBDB RECORD");
  });

  it("says ADSBDB UNREACHABLE (not NO ADSBDB RECORD) when the backend answers but " +
    "reports adsbdb itself did not — an outage must not read as a confirmed no-record", () => {
    const text = render(c(), {
      kind: "ok", info: { type: null, manufacturer: null, registration: null, available: false },
    });
    expect(text).toContain("ADSBDB UNREACHABLE");
    expect(text).not.toContain("NO ADSBDB RECORD");
  });

  it("shows the enrichment when there is some", () => {
    const text = render(c(), ok);
    expect(text).toContain("Cessna");
    expect(text).toContain("172S Skyhawk");
  });

  it("em-dashes an individual missing enrichment field without claiming the whole record is absent", () => {
    const text = render(c(), {
      kind: "ok", info: { type: "172", manufacturer: null, registration: null, available: true },
    });
    expect(text).toContain("172");
    expect(text).toContain(EM_DASH);
    expect(text).not.toContain("NO ADSBDB RECORD");
  });
});
