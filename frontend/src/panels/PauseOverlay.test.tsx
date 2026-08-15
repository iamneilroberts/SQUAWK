import { describe, it, expect } from "vitest";
import PauseOverlay from "./PauseOverlay";
import { AssistControlBody } from "../mission/AssistControl";

/** Find the first element of the given component type (collectHandlers doesn't invoke nested
 *  function components, so a nested control's own onClick isn't reachable that way — this reads
 *  its props directly off the element instead). */
function findByType(node: unknown, type: unknown): { props: Record<string, unknown> } | null {
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const c of node) {
      const found = findByType(c, type);
      if (found !== null) return found;
    }
    return null;
  }
  const element = node as { type?: unknown; props?: { children?: unknown } };
  if (element.type === type) return element as { props: Record<string, unknown> };
  if (element.props && "children" in element.props) return findByType(element.props.children, type);
  return null;
}

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

/** Walk the tree collecting every onClick handler, in render order. */
function collectHandlers(node: unknown, out: Array<() => void> = []): Array<() => void> {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const c of node) collectHandlers(c, out); return out; }
  const props = (node as { props?: { onClick?: () => void; children?: unknown } }).props;
  if (props?.onClick) out.push(props.onClick);
  if (props && "children" in props) collectHandlers(props.children, out);
  return out;
}

describe("PauseOverlay", () => {
  it("offers RESUME and QUIT while paused", () => {
    const text = collectText(PauseOverlay({ armed: false, onArmResume: () => {}, onQuit: () => {} }));
    expect(text).toContain("PAUSED");
    expect(text).toContain("RESUME");
    expect(text).toContain("QUIT TO BROWSE");
  });
  it("RESUME only ARMS the resume — it does not fly again on its own", () => {
    let armCalls = 0;
    const tree = PauseOverlay({ armed: false, onArmResume: () => { armCalls++; }, onQuit: () => {} });
    collectHandlers(tree)[0]();
    expect(armCalls).toBe(1);
  });
  it("once armed it asks for the canvas click, per spec §6", () => {
    const text = collectText(PauseOverlay({ armed: true, onArmResume: () => {}, onQuit: () => {} })).join(" ");
    expect(text).toContain("CLICK THE GLOBE TO RESUME");
    expect(text).not.toContain("PAUSED");
  });
  it("QUIT is still reachable from the armed state (never a dead end)", () => {
    const text = collectText(PauseOverlay({ armed: true, onArmResume: () => {}, onQuit: () => {} }));
    expect(text).toContain("QUIT TO BROWSE");
  });
  it("omits ASSIST when no assist state is given (e.g. no locked mission)", () => {
    const text = collectText(PauseOverlay({ armed: false, onArmResume: () => {}, onQuit: () => {} }));
    expect(text).not.toContain("ASSIST");
  });
  it("offers the ASSIST cycle control in the menu once paused with a mission (#2 follow-up: it "
    + "was an always-on HUD chip gated !narrow, so mobile portrait flight never saw it at all)", () => {
    const text = collectText(PauseOverlay({
      armed: false,
      onArmResume: () => {},
      onQuit: () => {},
      assist: { current: "NAV", highestUsed: "FULL" },
      onCycleAssist: () => {},
    }));
    const joined = text.join("");
    expect(joined).toContain("ASSIST");
    expect(joined).toContain("NAV");
    expect(joined).toContain("MAX FULL");
  });
  it("ASSIST cycles on tap, same as the old HUD chip", () => {
    let cycles = 0;
    const tree = PauseOverlay({
      armed: false,
      onArmResume: () => {},
      onQuit: () => {},
      assist: { current: "NAV", highestUsed: "FULL" },
      onCycleAssist: () => { cycles++; },
    });
    const assistNode = findByType(tree, AssistControlBody);
    expect(assistNode).not.toBeNull();
    (assistNode!.props.onCycle as () => void)();
    expect(cycles).toBe(1);
  });
  it("hides ASSIST once armed — that prompt is a transient confirmation, not a menu", () => {
    const text = collectText(PauseOverlay({
      armed: true,
      onArmResume: () => {},
      onQuit: () => {},
      assist: { current: "NAV", highestUsed: "FULL" },
      onCycleAssist: () => {},
    }));
    expect(text).not.toContain("ASSIST");
  });
});
