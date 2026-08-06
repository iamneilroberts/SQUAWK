import { describe, it, expect } from "vitest";
import EndCard from "./EndCard";
import type { FlightStats } from "../game/stats";
import { ktToMs, ftToM } from "../sim/units";

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  // Local function components (Row) must be invoked or their text is invisible here.
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

const stats = (o: Partial<FlightStats> = {}): FlightStats => ({
  airtimeS: 185,
  distanceM: 12_500,
  maxIasMs: ktToMs(141),
  maxAltitudeM: ftToM(5200),
  maxG: 2.4,
  impactSinkFpm: 940,
  impactIasMs: ktToMs(72),
  classification: "CRASHED",
  ...o,
});

const render = (s: FlightStats) => collectText(EndCard({ stats: s, onExit: () => {} })).join(" ");

describe("EndCard", () => {
  it("leads with the classification", () => {
    expect(render(stats({ classification: "CRASHED" }))).toContain("CRASHED");
    expect(render(stats({ classification: "LANDED" }))).toContain("LANDED");
  });
  it("shows every stat the spec asks for", () => {
    const text = render(stats());
    expect(text).toContain("03:05"); // airtime
    expect(text).toContain("141"); // max IAS
    expect(text).toContain("5200"); // max altitude
    expect(text).toContain("+2.4"); // max g
    expect(text).toContain("940"); // impact sink
    expect(text).toContain("72"); // impact speed
  });
  it("shows distance flown in nautical miles", () => {
    const text = render(stats({ distanceM: 18_520 })); // exactly 10 nm
    expect(text).toContain("10.0");
    expect(text).toContain("NM");
  });
  it("offers the way back to BROWSE", () => {
    expect(render(stats())).toContain("EXIT TO BROWSE");
  });
  it("tells the player the site can be orbited", () => {
    expect(render(stats())).toMatch(/ORBIT|DRAG/i);
  });
  it("handles a zero-length flight without NaN", () => {
    const text = render(stats({ airtimeS: 0, distanceM: 0, maxG: 1, impactSinkFpm: 0 }));
    expect(text).not.toContain("NaN");
    expect(text).toContain("00:00");
  });
});
