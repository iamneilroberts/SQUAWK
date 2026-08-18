import { describe, it, expect, vi } from "vitest";
import { IdentifiedContactBody, type TakeoverProps } from "./IdentifiedContactCallout";
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

type Btn = { label: string; disabled?: boolean; title?: string; onClick?: () => void };
function collectButtons(node: unknown, out: Btn[] = []): Btn[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) collectButtons(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = ((node as { props?: unknown }).props ?? {}) as {
    children?: unknown; disabled?: boolean; title?: string; onClick?: () => void;
  };
  if (typeof type === "function") return collectButtons((type as (p: unknown) => unknown)(props), out);
  if (type === "button") {
    out.push({
      label: collectText(props.children).join(" ").trim(),
      disabled: props.disabled, title: props.title, onClick: props.onClick,
    });
  }
  collectButtons(props.children, out);
  return out;
}
const buttons = (takeover?: TakeoverProps) =>
  collectButtons(IdentifiedContactBody({ contact: c(), own: null, onClose: () => {}, takeover }));
const baseTakeover = (o: Partial<TakeoverProps> = {}): TakeoverProps => ({
  eligible: true, reason: null, confirming: false,
  onRequest: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn(), ...o,
});

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

describe("IdentifiedContactBody TAKE CONTROLS (#6)", () => {
  it("renders only CLOSE with no takeover prop (read-only identify)", () => {
    const labels = buttons().map((b) => b.label);
    expect(labels).toEqual(["CLOSE"]);
  });
  it("an eligible contact shows an enabled TAKE CONTROLS that fires onRequest", () => {
    const t = baseTakeover();
    const take = buttons(t).find((b) => b.label === "TAKE CONTROLS");
    expect(take).toBeDefined();
    expect(take?.disabled).toBeFalsy();
    take?.onClick?.();
    expect(t.onRequest).toHaveBeenCalledOnce();
  });
  it("an ineligible contact disables TAKE CONTROLS and names the reason in the tooltip", () => {
    const take = buttons(baseTakeover({ eligible: false, reason: "ON GROUND" }))
      .find((b) => b.label === "TAKE CONTROLS");
    expect(take?.disabled).toBe(true);
    expect(take?.title).toBe("ON GROUND");
  });
  it("while confirming, shows CONFIRM + CANCEL wired to their callbacks (not TAKE CONTROLS)", () => {
    const t = baseTakeover({ confirming: true });
    const bs = buttons(t);
    const labels = bs.map((b) => b.label);
    expect(labels).toContain("CONFIRM");
    expect(labels).toContain("CANCEL");
    expect(labels).not.toContain("TAKE CONTROLS");
    bs.find((b) => b.label === "CONFIRM")?.onClick?.();
    bs.find((b) => b.label === "CANCEL")?.onClick?.();
    expect(t.onConfirm).toHaveBeenCalledOnce();
    expect(t.onCancel).toHaveBeenCalledOnce();
  });
});
