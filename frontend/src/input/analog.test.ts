import { describe, it, expect } from "vitest";
import {
  stickToAxes,
  sliderToThrottle,
  gearButtonDisabled,
  gearButtonInTransit,
  trimBadgeText,
  trimBadges,
  shouldShowLevelButton,
} from "./analog";

const R = 60; // pad radius px
const DZ = 0.1; // 10% radial deadzone

describe("virtual stick — pad offset to roll/pitch", () => {
  it("dead-centre is 0/0", () => {
    expect(stickToAxes(0, 0, R, DZ)).toEqual({ roll: 0, pitch: 0 });
  });
  it("inside the deadzone reads 0/0 — the stick does not hunt", () => {
    // 5% of the radius, well inside the 10% deadzone.
    const c = stickToAxes(R * 0.05, 0, R, DZ);
    expect(c.roll).toBe(0);
    expect(c.pitch).toBe(0);
  });
  it("full right is roll≈+1 with no pitch; full left is roll≈-1", () => {
    expect(stickToAxes(R, 0, R, DZ).roll).toBeCloseTo(1, 6);
    expect(stickToAxes(R, 0, R, DZ).pitch).toBeCloseTo(0, 6);
    expect(stickToAxes(-R, 0, R, DZ).roll).toBeCloseTo(-1, 6);
  });
  it("thumb DOWN the pad is nose UP (pitch>0), thumb UP is nose down — matches ArrowDown", () => {
    expect(stickToAxes(0, R, R, DZ).pitch).toBeCloseTo(1, 6);
    expect(stickToAxes(0, -R, R, DZ).pitch).toBeCloseTo(-1, 6);
  });
  it("clamps a drag past the rim to full deflection, never beyond 1", () => {
    const c = stickToAxes(R * 3, 0, R, DZ);
    expect(c.roll).toBe(1);
    expect(Math.abs(c.pitch)).toBeLessThanOrEqual(1);
  });
  it("just outside the deadzone is near 0, not a step to full — the rescale is continuous", () => {
    const c = stickToAxes(R * (DZ + 0.01), 0, R, DZ);
    expect(c.roll).toBeGreaterThan(0);
    expect(c.roll).toBeLessThan(0.05);
  });
  it("a zero radius is safe (returns centre) rather than dividing by zero", () => {
    expect(stickToAxes(10, 10, 0, DZ)).toEqual({ roll: 0, pitch: 0 });
  });
});

describe("throttle slider — position to [0,1] absolute", () => {
  const TOP = 100;
  const H = 200;
  it("top of the track is full throttle", () => {
    expect(sliderToThrottle(TOP, TOP, H)).toBe(1);
  });
  it("bottom of the track is idle", () => {
    expect(sliderToThrottle(TOP + H, TOP, H)).toBe(0);
  });
  it("halfway is 0.5", () => {
    expect(sliderToThrottle(TOP + H / 2, TOP, H)).toBeCloseTo(0.5, 6);
  });
  it("clamps drags above and below the track to [0,1]", () => {
    expect(sliderToThrottle(TOP - 50, TOP, H)).toBe(1);
    expect(sliderToThrottle(TOP + H + 50, TOP, H)).toBe(0);
  });
  it("a zero-height track is safe", () => {
    expect(sliderToThrottle(TOP, TOP, 0)).toBe(0);
  });
});

describe("gear button inert rule", () => {
  it("is disabled for a fixed-gear class (matches KeyG inertness)", () => {
    expect(gearButtonDisabled("fixed")).toBe(true);
  });
  it("is enabled for a retractable-gear class", () => {
    expect(gearButtonDisabled("retractable")).toBe(false);
  });
});

describe("gear button amber-in-transit rule (#48 mobile)", () => {
  it("is amber only mid-cycle on a retractable class", () => {
    expect(gearButtonInTransit("retractable", 0.5)).toBe(true);
  });
  it("is NOT amber fully up or fully down", () => {
    expect(gearButtonInTransit("retractable", 0)).toBe(false);
    expect(gearButtonInTransit("retractable", 1)).toBe(false);
  });
  it("never fires for a fixed-gear class (always position 1)", () => {
    expect(gearButtonInTransit("fixed", 0.5)).toBe(false);
    expect(gearButtonInTransit("fixed", 1)).toBe(false);
  });
});

describe("trim badge text (#48 mobile) — magnitude only", () => {
  it("neutral yields no badge", () => {
    expect(trimBadgeText(0)).toBeNull();
    expect(trimBadgeText(0.004)).toBeNull(); // rounds to 0%
    expect(trimBadgeText(null)).toBeNull();
    expect(trimBadgeText(undefined)).toBeNull();
  });
  it("shows the rounded percent magnitude regardless of direction", () => {
    expect(trimBadgeText(0.5)).toBe("50%");
    expect(trimBadgeText(-0.5)).toBe("50%");
    expect(trimBadgeText(1)).toBe("100%");
  });
});

describe("trim badges (#83 mobile) — sign-matched button", () => {
  it("neutral/deadband shows no badge on either button", () => {
    expect(trimBadges(0)).toEqual({ up: null, down: null });
    expect(trimBadges(0.004)).toEqual({ up: null, down: null }); // rounds to 0%
    expect(trimBadges(-0.004)).toEqual({ up: null, down: null });
    expect(trimBadges(null)).toEqual({ up: null, down: null });
    expect(trimBadges(undefined)).toEqual({ up: null, down: null });
  });
  it("positive (nose-up) trim badges TRM▲ only", () => {
    expect(trimBadges(0.5)).toEqual({ up: "50%", down: null });
    expect(trimBadges(1)).toEqual({ up: "100%", down: null });
  });
  it("negative (nose-down) trim badges TRM▼ only", () => {
    expect(trimBadges(-0.5)).toEqual({ up: null, down: "50%" });
    expect(trimBadges(-1)).toEqual({ up: null, down: "100%" });
  });
});

describe("mobile LEVEL assist button visibility (#5) — off-level threshold", () => {
  it("level (0,0) is hidden", () => {
    expect(shouldShowLevelButton(0, 0)).toBe(false);
  });
  it("banked 0.2rad roll shows the button", () => {
    expect(shouldShowLevelButton(0.2, 0)).toBe(true);
  });
  it("pitched -0.2rad shows the button", () => {
    expect(shouldShowLevelButton(0, -0.2)).toBe(true);
  });
  it("just under the ~10° threshold (0.17rad) stays hidden", () => {
    expect(shouldShowLevelButton(0.17, 0)).toBe(false);
    expect(shouldShowLevelButton(0, 0.17)).toBe(false);
  });
  it("null/undefined values hide the button rather than guessing", () => {
    expect(shouldShowLevelButton(null, null)).toBe(false);
    expect(shouldShowLevelButton(undefined, undefined)).toBe(false);
    expect(shouldShowLevelButton(null, 0.2)).toBe(true); // pitch alone still trips it
  });
});
