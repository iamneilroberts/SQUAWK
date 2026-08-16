import { describe, expect, it } from "vitest";
import { unrankedMessage } from "./unrankedReason";

describe("unrankedMessage", () => {
  it("is null when neither reason applies — a normal ranked flight", () => {
    expect(unrankedMessage({ repositioned: false, timeCompressed: false })).toBeNull();
  });

  it("names REPOSITIONED alone (spawn chooser or SKIP TO FINAL, no compression used)", () => {
    expect(unrankedMessage({ repositioned: true, timeCompressed: false }))
      .toBe("REPOSITIONED — LOCAL AND UNRANKED. NO RESULT SUBMITTED.");
  });

  it("names TIME COMPRESSION USED alone (flew the whole route, just sped up)", () => {
    expect(unrankedMessage({ repositioned: false, timeCompressed: true }))
      .toBe("TIME COMPRESSION USED — LOCAL AND UNRANKED. NO RESULT SUBMITTED.");
  });

  it("names both reasons when both applied — never claims a reason that didn't happen", () => {
    expect(unrankedMessage({ repositioned: true, timeCompressed: true }))
      .toBe("REPOSITIONED + TIME COMPRESSION USED — LOCAL AND UNRANKED. NO RESULT SUBMITTED.");
  });
});
