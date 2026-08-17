const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SIGN_IN_CODE = /^\d{6}$/;

export type MagicLinkEmail = {
  from: string;
  to: string;
  link: string;
  code: string;
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
  if (!SIGN_IN_CODE.test(message.code)) throw new TypeError("Sign-in code is invalid");
  const grouped = `${message.code.slice(0, 3)} ${message.code.slice(3)}`;
  await binding.send({
    from: message.from,
    to: message.to,
    subject: `Your sign-in code: ${grouped}`,
    text: [
      "Your one-time sign-in code for SQUAWK:",
      "",
      `    ${grouped}`,
      "",
      "Type this code into the sign-in screen you left open. It expires shortly.",
      "If you did not request it, ignore this message.",
      "",
      "Opening the email on the same browser? This one-time link signs you in too:",
      "",
      message.link,
      "",
      "After sign-in, open APP for the install checklist: Add to Home Screen, rotate to landscape, and enter fullscreen.",
    ].join("\n"),
  });
}
