import { describe, it, expect } from "vitest";
import { createKeyboard, GAME_KEY_CODES } from "./keyboard";

type Handler = (e: unknown) => void;

/** Minimal stand-in for `window`: records listeners so tests can fire events by hand. */
function fakeTarget() {
  const listeners = new Map<string, Set<Handler>>();
  return {
    addEventListener(type: string, fn: Handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Handler) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string, event: unknown) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

const keyEvent = (code: string) => {
  let prevented = false;
  return {
    code,
    preventDefault() { prevented = true; },
    get defaultPrevented() { return prevented; },
  };
};

const modifiedKeyEvent = (code: string, modifier: "ctrlKey" | "metaKey" | "altKey") => {
  let prevented = false;
  return {
    code,
    [modifier]: true,
    preventDefault() { prevented = true; },
    get defaultPrevented() { return prevented; },
  };
};

describe("createKeyboard", () => {
  it("tracks a held key from keydown to keyup", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    t.fire("keydown", keyEvent("KeyW"));
    expect(kb.held.has("KeyW")).toBe(true);
    t.fire("keyup", keyEvent("KeyW"));
    expect(kb.held.has("KeyW")).toBe(false);
    kb.dispose();
  });
  it("holds several keys at once", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    t.fire("keydown", keyEvent("ArrowLeft"));
    t.fire("keydown", keyEvent("ArrowUp"));
    t.fire("keydown", keyEvent("KeyW"));
    expect([...kb.held].sort()).toEqual(["ArrowLeft", "ArrowUp", "KeyW"]);
    kb.dispose();
  });
  it("preventDefault's game keys so arrows do not scroll the page", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    const e = keyEvent("ArrowDown");
    t.fire("keydown", e);
    expect(e.defaultPrevented).toBe(true);
    kb.dispose();
  });
  it("leaves non-game keys alone, including Escape and browser shortcuts", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    for (const code of ["Escape", "F5", "KeyR", "Tab"]) {
      const e = keyEvent(code);
      t.fire("keydown", e);
      expect(e.defaultPrevented).toBe(false);
    }
    kb.dispose();
  });
  it("clears every held key on blur (no stuck throttle when you alt-tab away)", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    t.fire("keydown", keyEvent("KeyW"));
    t.fire("keydown", keyEvent("ArrowUp"));
    t.fire("blur", {});
    expect(kb.held.size).toBe(0);
    kb.dispose();
  });
  it("ignores an autorepeat keydown for an already-held key", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    t.fire("keydown", keyEvent("KeyF"));
    t.fire("keydown", keyEvent("KeyF"));
    expect(kb.held.size).toBe(1);
    kb.dispose();
  });
  it("dispose removes every listener and stops tracking", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    expect(t.count("keydown")).toBe(1);
    kb.dispose();
    expect(t.count("keydown")).toBe(0);
    expect(t.count("keyup")).toBe(0);
    expect(t.count("blur")).toBe(0);
    t.fire("keydown", keyEvent("KeyW"));
    expect(kb.held.size).toBe(0);
  });
  it("Escape is deliberately NOT a game key (the flight loop owns pause)", () => {
    expect(GAME_KEY_CODES.has("Escape")).toBe(false);
    expect(GAME_KEY_CODES.has("ArrowUp")).toBe(true);
  });
  it("captures KeyL — the leveling assist reads it from the held set (issue #5a)", () => {
    expect(GAME_KEY_CODES.has("KeyL")).toBe(true);
    const t = fakeTarget();
    const kb = createKeyboard(t);
    const e = keyEvent("KeyL");
    t.fire("keydown", e);
    expect(kb.held.has("KeyL")).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    kb.dispose();
  });
  it("does NOT capture the retired KeyR live-traffic shortcut", () => {
    expect(GAME_KEY_CODES.has("KeyR")).toBe(false);
  });
  it("does NOT capture KeyY — re-sync is a one-shot chrome key, not a held control (issue #5b)", () => {
    expect(GAME_KEY_CODES.has("KeyY")).toBe(false);
    const t = fakeTarget();
    const kb = createKeyboard(t);
    t.fire("keydown", keyEvent("KeyY"));
    expect(kb.held.has("KeyY")).toBe(false);
    kb.dispose();
  });
  it("captures KeyQ and preventDefaults it — free-look holds it while pointer-locked (issue #9)", () => {
    expect(GAME_KEY_CODES.has("KeyQ")).toBe(true);
    const t = fakeTarget();
    const kb = createKeyboard(t);
    const e = keyEvent("KeyQ");
    t.fire("keydown", e);
    expect(kb.held.has("KeyQ")).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    kb.dispose();
  });
  it("does not capture or preventDefault a ctrl/cmd/alt-modified game key (browser shortcuts)", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
      const e = modifiedKeyEvent("KeyW", modifier);
      t.fire("keydown", e);
      expect(e.defaultPrevented).toBe(false);
      expect(kb.held.has("KeyW")).toBe(false);
    }
    kb.dispose();
  });
});
