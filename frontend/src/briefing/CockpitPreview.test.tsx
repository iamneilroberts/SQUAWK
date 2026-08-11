import { describe, expect, it } from "vitest";

import CockpitPreview from "./CockpitPreview";

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  if (typeof type === "function") {
    return collectText((type as (value: unknown) => unknown)(props), out);
  }
  const children = props as { children?: unknown } | undefined;
  if (children && "children" in children) collectText(children.children, out);
  return out;
}

describe("CockpitPreview", () => {
  it.each([
    ["c172s", "ASI KT"],
    ["b738", "MACH"],
    ["f5e", "AOA"],
  ] as const)("uses the real %s cockpit renderer before auth", (classId, marker) => {
    const text = collectText(CockpitPreview({ classId })).join(" ");
    expect(text).toContain("SIMULATED COCKPIT PREVIEW");
    expect(text).toContain(marker);
    expect(text).toContain("SIGN-IN COMES NEXT");
  });
});
