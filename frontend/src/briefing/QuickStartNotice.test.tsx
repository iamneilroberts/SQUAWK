import { describe, expect, it, vi } from "vitest";
import QuickStartNotice, { QUICK_START_STEPS } from "./QuickStartNotice";

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

describe("QuickStartNotice", () => {
  it("states the complete five-step mission loop in plain language", () => {
    const text = collectText(QuickStartNotice({ onDismiss: vi.fn(), onSelectPlane: vi.fn() })).join(" ");
    expect(text).toContain("How to fly");
    for (const step of QUICK_START_STEPS) expect(text).toContain(step);
    expect(QUICK_START_STEPS).toHaveLength(5);
  });

  it("offers select-plane and dismiss controls without requiring authentication", () => {
    const text = collectText(QuickStartNotice({ onDismiss: vi.fn(), onSelectPlane: vi.fn() })).join(" ");
    expect(text).toContain("Select a plane");
    expect(text).toContain("×");
  });
});
