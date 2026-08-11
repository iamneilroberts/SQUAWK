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
  it("funnels a first-time visitor through account-free training before live flight", () => {
    const text = collectText(QuickStartNotice({
      onDismiss: vi.fn(),
      onStartTraining: vi.fn(),
      onSelectPlane: vi.fn(),
    })).join(" ");
    expect(text).toContain("Train before you sign in");
    for (const step of QUICK_START_STEPS) expect(text).toContain(step);
    expect(text).toContain("Start landing training");
    expect(text).toContain("No account");
  });

  it("keeps browse and dismiss available without making either the primary action", () => {
    const text = collectText(QuickStartNotice({
      onDismiss: vi.fn(),
      onStartTraining: vi.fn(),
      onSelectPlane: vi.fn(),
    })).join(" ");
    expect(text).toContain("Browse live planes");
    expect(text).toContain("×");
  });
});
