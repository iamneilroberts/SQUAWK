import { describe, it, expect } from "vitest";
import EdgeTurnCue from "./EdgeTurnCue";
import { degToRad } from "../sim/units";

/*
 * No jsdom (spec §8): call the component and walk the plain-object element tree, matching the
 * other hud/*.test.tsx suites. These lock the three presentational decisions: correct edge,
 * the turn magnitude, and the neutral on-course state — everything else is CSS.
 */
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
function propOf(node: unknown, key: string): unknown {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  const props = (node as { props?: Record<string, unknown> }).props;
  return props ? props[key] : undefined;
}

const cue = (bearingDeg: number) => ({ destination: "KGPT", bearingDeg, distanceNm: 12.3 });

describe("EdgeTurnCue", () => {
  it("renders nothing when there is no assigned destination", () => {
    expect(EdgeTurnCue({ headingRad: degToRad(90), navCue: null })).toBeNull();
  });

  it("anchors to the LEFT edge with the turn magnitude when a left turn is required", () => {
    // heading 090, bearing 000 → 90° left
    const el = EdgeTurnCue({ headingRad: degToRad(90), navCue: cue(0) });
    expect(propOf(el, "data-side")).toBe("left");
    expect(collectText(el).join("")).toContain("90°");
  });

  it("anchors to the RIGHT edge when a right turn is required", () => {
    // heading 270, bearing 000 → 90° right
    const el = EdgeTurnCue({ headingRad: degToRad(270), navCue: cue(0) });
    expect(propOf(el, "data-side")).toBe("right");
    expect(collectText(el).join("")).toContain("90°");
  });

  it("shows a neutral centered on-course mark within the dead-band (no left/right flip)", () => {
    const el = EdgeTurnCue({ headingRad: degToRad(90), navCue: cue(90) });
    expect(propOf(el, "data-side")).toBe("oncourse");
    expect(collectText(el).join(" ")).toContain("ON COURSE");
  });

  it("carries an accessible label describing the required turn", () => {
    const el = EdgeTurnCue({ headingRad: degToRad(270), navCue: cue(0) });
    expect(propOf(el, "aria-label")).toBe("Turn right 90 degrees to destination");
  });
});
