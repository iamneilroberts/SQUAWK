import { describe, it, expect } from "vitest";
import ControlsHelp, { KEY_LABELS, keyLabel, groupKeymap } from "./ControlsHelp";
import { KEYMAP } from "../input/controls";

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

const rendered = () => collectText(ControlsHelp()).join(" ");

describe("keyLabel", () => {
  it("has an explicit label for EVERY key in KEYMAP — no silent fallbacks", () => {
    for (const code of Object.keys(KEYMAP)) {
      expect(KEY_LABELS[code], `missing label for ${code}`).toBeDefined();
      expect(KEY_LABELS[code].length).toBeGreaterThan(0);
    }
  });
  it("renders arrows and punctuation as a pilot would read them, not as DOM codes", () => {
    expect(keyLabel("ArrowUp")).toBe("↑");
    expect(keyLabel("Equal")).toBe("=");
    expect(keyLabel("NumpadAdd")).toBe("NUM +");
    expect(keyLabel("Slash")).toBe("?");
    expect(keyLabel("Escape")).toBe("ESC");
    expect(keyLabel("KeyW")).toBe("W");
  });
  it("falls back to a stripped code rather than throwing on a key added later", () => {
    expect(keyLabel("KeyZ")).toBe("Z");
  });
});

describe("groupKeymap", () => {
  it("accounts for every KEYMAP entry exactly once", () => {
    const keys = groupKeymap(KEYMAP).flatMap((g) => g.keys);
    expect(keys.sort()).toEqual(Object.keys(KEYMAP).sort());
  });
  it("merges the three ways to open the throttle into one row", () => {
    const row = groupKeymap(KEYMAP).find((g) => g.action === "throttle up")!;
    expect(row.keys).toEqual(["KeyW", "Equal", "NumpadAdd"]);
  });
  it("keeps the KEYMAP's own order rather than sorting alphabetically", () => {
    expect(groupKeymap(KEYMAP)[0].action).toBe(KEYMAP[Object.keys(KEYMAP)[0]]);
  });
});

describe("ControlsHelp", () => {
  it("is generated FROM KEYMAP — every documented action appears", () => {
    const text = rendered();
    for (const action of new Set(Object.values(KEYMAP))) {
      expect(text, `help panel is missing "${action}"`).toContain(action);
    }
  });
  it("therefore already documents the cockpit keys added this phase", () => {
    const text = rendered();
    // Assert the ACTIONS, not the key faces: "C" is a substring of "ESC" and would pass
    // vacuously; "?" is the only unambiguous face of the two.
    expect(text).toContain(KEYMAP.KeyC);
    expect(text).toContain(KEYMAP.Slash);
    expect(text).toContain("?");
  });
});
