import { describe, it, expect } from "vitest";
import TrafficTags from "./TrafficTags";
import type { TrafficTag } from "./trafficProjection";

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

function findByProp(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) findByProp(c, key, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof type === "function") return findByProp((type as (p: unknown) => unknown)(props), key, out);
  if (props && key in props) out.push(props[key]);
  if (props && "children" in props) findByProp(props.children, key, out);
  return out;
}

const tag = (o: Partial<TrafficTag> = {}): TrafficTag => ({
  hex: "a1b2c3", x: 420, y: 300, rangeNm: 12.4, label: "N12345", typeLine: "C172",
  altLine: "3500 FT", military: false, ghost: false, ...o,
});

describe("TrafficTags", () => {
  it("renders nothing when there is nothing to render", () => {
    expect(collectText(TrafficTags({ tags: [], onSelect: () => {} }))).toEqual([]);
  });

  it("shows the callsign, type and altitude on each tag", () => {
    const text = collectText(TrafficTags({ tags: [tag()], onSelect: () => {} })).join(" ");
    expect(text).toContain("N12345");
    expect(text).toContain("C172");
    expect(text).toContain("3500 FT");
  });

  it("anchors each tag at the screen position the projection gave it", () => {
    const styles = findByProp(TrafficTags({ tags: [tag()], onSelect: () => {} }), "style");
    expect(styles).toContainEqual(expect.objectContaining({ left: 420, top: 300 }));
  });

  it("calls back with the hex when a tag is clicked", () => {
    const seen: string[] = [];
    const handlers = findByProp(
      TrafficTags({ tags: [tag()], onSelect: (h) => seen.push(h) }), "onClick",
    ) as (() => void)[];
    handlers.filter((h) => typeof h === "function").forEach((h) => h());
    expect(seen).toEqual(["a1b2c3"]);
  });

  it("distinguishes the ghost and military tags by class, not by inventing a field", () => {
    const classes = findByProp(
      TrafficTags({ tags: [tag({ ghost: true }), tag({ hex: "b", military: true })], onSelect: () => {} }),
      "className",
    ).join(" ");
    expect(classes).toContain("traffic-tag-ghost");
    expect(classes).toContain("traffic-tag-mil");
  });
});
