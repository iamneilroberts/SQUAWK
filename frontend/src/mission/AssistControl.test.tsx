import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistControlBody } from "./AssistControl";

describe("AssistControl", () => {
  it("keeps the current and highest-used guidance prominent", () => {
    const html = renderToStaticMarkup(
      <AssistControlBody
        assist={{ current: "OFF", highestUsed: "FULL" }}
        onCycle={() => undefined}
      />,
    );
    expect(html).toContain("ASSIST");
    expect(html).toContain("OFF");
    expect(html).toContain("MAX FULL");
    expect(html).toContain("Flight guidance OFF; highest used FULL");
  });
});
