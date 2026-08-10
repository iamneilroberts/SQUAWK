const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_RESPONSE_LENGTH = 2_048;

type TurnstileResult = {
  success?: unknown;
  action?: unknown;
  hostname?: unknown;
};

export type TurnstileVerification = {
  secret: string;
  response: string;
  remoteIp: string | null;
  idempotencyKey: string;
  expectedAction: string;
  expectedHostname: string;
  fetcher?: typeof fetch;
};

export async function verifyTurnstile(
  input: TurnstileVerification,
): Promise<boolean> {
  if (
    input.secret.length === 0 ||
    input.response.length === 0 ||
    input.response.length > MAX_RESPONSE_LENGTH ||
    input.expectedAction.length === 0 ||
    input.expectedHostname.length === 0
  ) {
    return false;
  }

  try {
    const response = await (input.fetcher ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: input.secret,
        response: input.response,
        ...(input.remoteIp === null ? {} : { remoteip: input.remoteIp }),
        idempotency_key: input.idempotencyKey,
      }),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as TurnstileResult;
    return (
      result.success === true &&
      result.action === input.expectedAction &&
      result.hostname === input.expectedHostname
    );
  } catch {
    return false;
  }
}
