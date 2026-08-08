import { describe, it, expect } from "vitest";
import RotateCard from "./RotateCard";

// No jsdom (spec §8): a React element is a plain object, so we walk what the component returns.
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

function collectClasses(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) collectClasses(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props as
    | { className?: unknown; children?: unknown } | undefined;
  if (typeof type === "function") return collectClasses((type as (p: unknown) => unknown)(props), out);
  if (props) {
    if (typeof props.className === "string") out.push(props.className);
    if ("children" in props) collectClasses(props.children, out);
  }
  return out;
}

describe("RotateCard", () => {
  it("tells the player to rotate to landscape", () => {
    expect(collectText(RotateCard()).join(" ")).toContain("ROTATE TO LANDSCAPE");
  });
  it("uses the LORAN panel chrome (bracket corners), not app-store chrome", () => {
    expect(collectClasses(RotateCard())).toContain("panel rotate-card");
  });
});
