import { describe, expect, it, vi } from "vitest";

import { buildMagicLinkUrl, sendMagicLinkEmail } from "./email";
import { encodeOpaqueToken } from "./sessions";

const TOKEN = encodeOpaqueToken(new Uint8Array(32).fill(4));

describe("magic-link email", () => {
  it("places the raw token only in the URL fragment", () => {
    const link = buildMagicLinkUrl("https://squawk.example/current?old=1", TOKEN);
    const url = new URL(link);

    expect(url.origin).toBe("https://squawk.example");
    expect(url.pathname).toBe("/");
    expect(url.search).toBe("");
    expect(url.hash).toBe(`#auth_token=${TOKEN}`);
    expect(`${url.origin}${url.pathname}${url.search}`).not.toContain(TOKEN);
  });

  it("leads with the space-grouped code, keeps the link as fallback, and logs no identity", async () => {
    const messages: EmailMessageBuilder[] = [];
    const send = vi.fn(async (message: EmailMessageBuilder) => {
      messages.push(message);
      return { messageId: "test-message" };
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await sendMagicLinkEmail(
      { send } as unknown as SendEmail,
      {
        from: "sign-in@squawk.example",
        to: "pilot@example.com",
        link: buildMagicLinkUrl("https://squawk.example", TOKEN),
        code: "123456",
      },
    );

    expect(send).toHaveBeenCalledOnce();
    expect(messages[0]).toMatchObject({
      from: "sign-in@squawk.example",
      to: "pilot@example.com",
      subject: "Your sign-in code: 123 456",
    });
    const text = String(messages[0]?.text);
    // Code leads the body, space-grouped.
    expect(text).toContain("123 456");
    // Link stays as a same-browser fallback.
    expect(text).toContain(`#auth_token=${TOKEN}`);
    expect(text.indexOf("123 456")).toBeLessThan(text.indexOf(`#auth_token=${TOKEN}`));
    expect(text).toMatch(/Add to Home Screen.*landscape.*fullscreen/s);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("rejects a code that is not exactly six digits", async () => {
    const send = vi.fn(async () => ({ messageId: "test-message" }));
    await expect(
      sendMagicLinkEmail({ send } as unknown as SendEmail, {
        from: "sign-in@squawk.example",
        to: "pilot@example.com",
        link: buildMagicLinkUrl("https://squawk.example", TOKEN),
        code: "12345",
      }),
    ).rejects.toThrow(TypeError);
    expect(send).not.toHaveBeenCalled();
  });
});
