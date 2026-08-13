import { describe, expect, it, vi } from "vitest";
import QuickStartNotice from "./QuickStartNotice";

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

function render() {
  return collectText(QuickStartNotice({
    onDismiss: vi.fn(),
    onFlyNow: vi.fn(),
    onSelectPlane: vi.fn(),
    onStartTraining: vi.fn(),
  })).join(" ");
}

describe("QuickStartNotice", () => {
  it("leads with FLY NOW — take a real aircraft, no account, fly-first", () => {
    const text = render();
    expect(text).toContain("Take the controls");
    expect(text).toMatch(/Fly a real aircraft/i);
    expect(text).toMatch(/Fly now/i);
    // The fly-first promise: no account, and FLY NOW takes the nearest flyable.
    expect(text).toMatch(/No account/i);
    expect(text).toMatch(/nearest flyable/i);
  });

  it("keeps pick-a-plane and guided training as secondary actions, plus dismiss", () => {
    const text = render();
    expect(text).toMatch(/Pick a plane/i);
    expect(text).toMatch(/Training/i);
    expect(text).toContain("×");
  });

  it("no longer tells anonymous visitors to sign in before flying", () => {
    const text = render();
    expect(text).not.toMatch(/sign in only when you are ready/i);
    expect(text).not.toMatch(/Train before you sign in/i);
  });
});
