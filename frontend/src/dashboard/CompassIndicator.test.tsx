import { describe, it, expect } from "vitest";
import CompassIndicator from "./CompassIndicator";
import { degToRad } from "../sim/units";

/*
 * No jsdom (spec §8), matching AttitudeIndicator.test.tsx: a React element is a plain object, so
 * we call the component and walk it.
 */
function collectAttr(node: unknown, key: string, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) collectAttr(c, key, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof type === "function") return collectAttr((type as (p: unknown) => unknown)(props), key, out);
  if (props && key in props && typeof props[key] === "string") out.push(props[key] as string);
  if (props && "children" in props) collectAttr(props.children, key, out);
  return out;
}

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

describe("CompassIndicator (hud chrome rework)", () => {
  it("rotates the dial opposite the heading, same convention as SixPack's DG", () => {
    const el = CompassIndicator({ headingRad: degToRad(90) });
    expect(collectAttr(el, "transform")).toContain("rotate(270 60 60)");
  });

  it("draws no dial rotation when the heading is unknown (no invented card position)", () => {
    const el = CompassIndicator({ headingRad: null });
    expect(collectAttr(el, "transform").filter((t) => t.startsWith("rotate("))).toHaveLength(0);
  });

  it("shows all four cardinals", () => {
    const text = collectText(CompassIndicator({ headingRad: degToRad(207) }));
    expect(text).toContain("N");
    expect(text).toContain("E");
    expect(text).toContain("S");
    expect(text).toContain("W");
  });

  it("shows the digital heading, the same string formatHeadingDeg produces", () => {
    const text = collectText(CompassIndicator({ headingRad: degToRad(207) })).join(" ");
    expect(text).toContain("207");
  });

  it("em-dashes the digital readout rather than inventing a heading", () => {
    const text = collectText(CompassIndicator({ headingRad: null })).join(" ");
    expect(text).toContain("—");
  });
});
