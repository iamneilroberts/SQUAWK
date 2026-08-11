import { describe, expect, it, vi } from "vitest";
import type { Contact } from "../data/types";
import type { MissionAirport } from "../mission/types";
import { assignContactMission, type ProvisionalBriefingState } from "./briefingState";
import MissionTray from "./MissionTray";

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const child of node) collectText(child, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") return collectText((type as (value: unknown) => unknown)(props), out);
  const children = props as { children?: unknown } | undefined;
  if (children && "children" in children) collectText(children.children, out);
  return out;
}

const contact: Contact = {
  hex: "a0b1c2", flight: "N123", t: "C172", lat: 30, lon: -88,
  alt_geom: 3_500, alt_baro: 3_400, gs: 110, track: 90, baro_rate: 0,
  military: false, seen_pos: 2,
};

const airport: MissionAirport = {
  ident: "KTST", iata: null, name: "TEST FIELD", size: "small",
  latDeg: 30, lonDeg: -87.8, elevationFt: 100,
  runways: [{
    id: "09-27", lengthFt: 5_000, widthFt: 100, surface: "HARD", surfaceRaw: "ASP",
    lighted: true, closed: false,
    lowEnd: { ident: "09", latDeg: 30, lonDeg: -87.8, elevationFt: 100, headingDeg: 90, displacedThresholdFt: 0 },
    highEnd: { ident: "27", latDeg: 30, lonDeg: -87.79, elevationFt: 100, headingDeg: 270, displacedThresholdFt: 0 },
  }],
};

function render(state: ProvisionalBriefingState): string {
  return collectText(MissionTray({
    state,
    profile: null,
    onClose: vi.fn(),
    onSelectAssignment: vi.fn(),
    onTakeControls: vi.fn(),
    commitState: { status: "idle" },
    onConfirmMission: vi.fn(),
    onSelectReconfirmed: vi.fn(),
  })).join(" ");
}

describe("MissionTray", () => {
  it("shows the selected class cockpit before the deferred auth gate", () => {
    const ready = assignContactMission({ contact, classId: "c172s", airports: [airport], datasetVersion: "fixture-v1" });
    const text = render(ready);
    expect(text).toContain("N123");
    expect(text).toContain("A0B1C2");
    expect(text).toContain("KTST");
    expect(text).toContain("Runway");
    expect(text).toContain("5000");
    expect(text).toContain("0–100 AFTER SAFETY GATES");
    expect(text).toContain("REAL ADS-B POSITION → SIMULATED AIRCRAFT");
    expect(text).toContain("SIMULATED COCKPIT PREVIEW");
    expect(text).toContain("ASI KT");
    expect(text).toContain("SIGN-IN COMES NEXT");
    expect(text).toContain("Take controls");
    expect(text).toContain("SIGN-IN REQUIRED AFTER COCKPIT PREVIEW");
  });

  it.each([
    ["unsupported", "UNSUPPORTED AIRCRAFT TYPE"],
    ["stale", "TRAFFIC SNAPSHOT IS STALE"],
    ["provider-down", "LIVE PROVIDER UNAVAILABLE"],
    ["no-runway", "NO ELIGIBLE RUNWAY WITHIN 30 MINUTES"],
    ["data-error", "AIRPORT DATA UNAVAILABLE"],
  ] as const)("renders the %s refusal without a TAKE CONTROLS action", (kind, reason) => {
    const state: ProvisionalBriefingState = {
      status: "unavailable", contact, kind, reason, classId: kind === "unsupported" ? null : "c172s",
    };
    const text = render(state);
    expect(text).toContain(reason);
    expect(text).not.toContain("Take controls");
  });

  it("renders the bounded loading state", () => {
    expect(render({ status: "loading", contact, classId: "c172s" }))
      .toContain("ASSIGNING ELIGIBLE RUNWAY…");
  });
});
