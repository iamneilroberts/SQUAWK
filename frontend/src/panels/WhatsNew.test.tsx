import { describe, it, expect, vi } from "vitest";
import { WhatsNewBody } from "./WhatsNew";
import type { WhatsNewRelease } from "../data/whatsNew";

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

const releases: WhatsNewRelease[] = [
  { date: "2026-08-18", items: ["Weather radar overlay — live precipitation draped on the globe"] },
  { date: "2026-08-05", label: "Launch", items: ["Live ADS-B browse globe — pick a real aircraft and take the controls"] },
];

const render = (rs: WhatsNewRelease[], onClose = () => {}) =>
  collectText(WhatsNewBody({ releases: rs, onClose })).join(" ");

describe("WhatsNewBody", () => {
  it("renders the heading, CLOSE, and a known feature string", () => {
    const t = render(releases);
    expect(t).toContain("WHAT'S NEW");
    expect(t).toContain("CLOSE");
    expect(t).toContain("Weather radar overlay — live precipitation draped on the globe");
  });

  it("renders each release's formatted date and its items", () => {
    const t = render(releases);
    expect(t).toContain("18 AUG 2026");
    expect(t).toContain("05 AUG 2026");
    expect(t).toContain("Live ADS-B browse globe — pick a real aircraft and take the controls");
  });

  it("renders a release's label when present", () => {
    const t = render(releases);
    expect(t).toContain("LAUNCH");
  });

  it("renders nothing (no crash) for an empty release list", () => {
    expect(render([])).not.toContain("undefined");
  });
});
