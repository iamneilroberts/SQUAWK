const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type MagicLinkEmail = {
  from: string;
  to: string;
  link: string;
};

export function buildMagicLinkUrl(publicOrigin: string, token: string): string {
  if (!OPAQUE_TOKEN.test(token)) throw new TypeError("Magic-link token is invalid");
  const origin = new URL(publicOrigin);
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") {
    throw new TypeError("Magic-link origin is invalid");
  }
  const link = new URL("/", origin.origin);
  link.hash = `auth_token=${token}`;
  return link.toString();
}

export async function sendMagicLinkEmail(
  binding: SendEmail,
  message: MagicLinkEmail,
): Promise<void> {
  await binding.send({
    from: message.from,
    to: message.to,
    subject: "Your Voygent ADS-B Game sign-in link",
    text: [
      "Use this one-time link to sign in to Voygent ADS-B Game:",
      "",
      message.link,
      "",
      "This link expires shortly. If you did not request it, ignore this message.",
    ].join("\n"),
  });
}
