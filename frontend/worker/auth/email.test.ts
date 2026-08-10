import { describe, expect, it, vi } from "vitest";

import { buildMagicLinkUrl, sendMagicLinkEmail } from "./email";
import { encodeOpaqueToken } from "./sessions";

const TOKEN = encodeOpaqueToken(new Uint8Array(32).fill(4));

describe("magic-link email", () => {
  it("places the raw token only in the URL fragment", () => {
    const link = buildMagicLinkUrl("https://fly.voygent.app/current?old=1", TOKEN);
    const url = new URL(link);

    expect(url.origin).toBe("https://fly.voygent.app");
    expect(url.pathname).toBe("/");
    expect(url.search).toBe("");
    expect(url.hash).toBe(`#auth_token=${TOKEN}`);
    expect(`${url.origin}${url.pathname}${url.search}`).not.toContain(TOKEN);
  });

  it("sends through the dedicated binding without logging identity material", async () => {
    const messages: EmailMessageBuilder[] = [];
    const send = vi.fn(async (message: EmailMessageBuilder) => {
      messages.push(message);
      return { messageId: "test-message" };
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await sendMagicLinkEmail(
      { send } as unknown as SendEmail,
      {
        from: "sign-in@fly.voygent.app",
        to: "pilot@example.com",
        link: buildMagicLinkUrl("https://fly.voygent.app", TOKEN),
      },
    );

    expect(send).toHaveBeenCalledOnce();
    expect(messages[0]).toMatchObject({
      from: "sign-in@fly.voygent.app",
      to: "pilot@example.com",
      subject: "Your Voygent ADS-B Game sign-in link",
    });
    expect(String(messages[0]?.text)).toContain(`#auth_token=${TOKEN}`);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
