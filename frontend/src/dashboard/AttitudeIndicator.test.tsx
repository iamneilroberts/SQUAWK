import { describe, it, expect } from "vitest";
import AttitudeIndicator from "./AttitudeIndicator";
import type { HudSnapshot } from "../hud/snapshot";
import { degToRad } from "../sim/units";

/*
 * No jsdom (spec §8): a React element is a plain object, so we call the component and walk it.
 * This locks the EXTRACTION — the artificial horizon was lifted verbatim out of SixPack so the
 * six-pack dial and the mobile top bar share ONE geometry. If it were rewritten by hand the roll
 * transform would drift; asserting the exact string is the broken-arm guard against that.
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
const classNamesIn = (node: unknown) => collectAttr(node, "className").flatMap((c) => c.split(/\s+/));

const snap = (o: Partial<HudSnapshot>): HudSnapshot => ({ rollRad: 0, pitchRad: 0, ...o } as HudSnapshot);

describe("AttitudeIndicator (shared six-pack / immersive-bar geometry)", () => {
  it("rotates the horizon opposite the roll, same string the six-pack asserts", () => {
    const el = AttitudeIndicator({ snapshot: snap({ rollRad: degToRad(30) }), attitudeStyle: "line" });
    expect(collectAttr(el, "transform")).toContain("rotate(-30 60 60)");
  });

  it("draws no attitude transform at all when there is no snapshot (no invented level horizon)", () => {
    const el = AttitudeIndicator({ snapshot: null, attitudeStyle: "line" });
    expect(collectAttr(el, "transform").filter((t) => t.startsWith("rotate("))).toHaveLength(0);
  });

  it("draws the line horizon for a line class and the filled ball for a ball class", () => {
    const line = AttitudeIndicator({ snapshot: snap({}), attitudeStyle: "line" });
    const ball = AttitudeIndicator({ snapshot: snap({}), attitudeStyle: "ball" });
    expect(classNamesIn(line)).toContain("gauge-horizon");
    expect(classNamesIn(line)).not.toContain("gauge-adi-sky");
    expect(classNamesIn(ball)).toContain("gauge-adi-sky");
    expect(classNamesIn(ball)).toContain("gauge-adi-ground");
  });

  it("gives the clip path the id it is handed, so two instances never collide", () => {
    const el = AttitudeIndicator({ snapshot: snap({}), attitudeStyle: "ball", clipId: "immAdiClip" });
    expect(collectAttr(el, "id")).toContain("immAdiClip");
    expect(collectAttr(el, "clipPath")).toContain("url(#immAdiClip)");
  });
});
