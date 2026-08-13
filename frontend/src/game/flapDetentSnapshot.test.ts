import { describe, it, expect } from "vitest";
import { buildFlapDetentFields } from "./flightLoop";

describe("flap detent + speedbrake snapshot fields (#48)", () => {
  it("surfaces the live detent index, the class detent count, and airbrake presence", () => {
    const params = { flaps: [{ label: "UP" }, { label: "10" }, { label: "20" }], aero: { speedbrakeCd0: 0.05 } };
    const controls = { flapDetent: 2 };
    expect(buildFlapDetentFields(params as never, controls as never)).toEqual({
      flapDetentIndex: 2, flapDetentCount: 3, hasSpeedbrake: true,
    });
  });
  it("reports no airbrake when speedbrakeCd0 is 0 (C172)", () => {
    const params = { flaps: [{ label: "UP" }, { label: "FULL" }], aero: { speedbrakeCd0: 0 } };
    const controls = { flapDetent: 0 };
    expect(buildFlapDetentFields(params as never, controls as never)).toEqual({
      flapDetentIndex: 0, flapDetentCount: 2, hasSpeedbrake: false,
    });
  });
});
