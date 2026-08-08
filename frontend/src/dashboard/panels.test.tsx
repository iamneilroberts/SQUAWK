import { describe, it, expect } from "vitest";
import WeatherPanel, { NO_FEED } from "./WeatherPanel";
import PanelFrame from "./PanelFrame";

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

const weather = () => collectText(WeatherPanel()).join(" ");

describe("the weather panel is chrome only", () => {
  it("states the empty condition literally", () => {
    expect(weather()).toContain(NO_FEED);
    expect(NO_FEED).toBe("NO FEED · FUTURE INTEGRATION");
  });
  it("names the feed that is planned, so the blank is explained rather than mysterious", () => {
    expect(weather()).toMatch(/PLANNED/);
    expect(weather()).toMatch(/WEATHER RADAR/);
  });
  it("contains no digits AT ALL — a placeholder number is a fake reading", () => {
    expect(weather()).not.toMatch(/\d/);
  });
});

describe("PanelFrame", () => {
  it("shows the title and the contents when open", () => {
    const text = collectText(
      PanelFrame({ title: "WEATHER", collapsed: false, onToggle: () => {}, children: "BODY" }),
    ).join(" ");
    expect(text).toContain("WEATHER");
    expect(text).toContain("BODY");
    expect(text).toContain("[-]");
  });
  it("keeps the title but drops the contents when collapsed", () => {
    const text = collectText(
      PanelFrame({ title: "WEATHER", collapsed: true, onToggle: () => {}, children: "BODY" }),
    ).join(" ");
    expect(text).toContain("WEATHER");
    expect(text).not.toContain("BODY");
    expect(text).toContain("[+]");
  });
});
