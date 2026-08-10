export type RedactionOptions = {
  maxDepth?: number;
  maxEntries?: number;
  maxStringLength?: number;
};

const SENSITIVE_KEY =
  /(authorization|cookie|set-cookie|token|jwt|secret|password|passphrase|session|credential|api[_-]?key|email|ip|evidence|adsb|payload|body)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\bBearer\s+[^\s,;]+/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 =
  /(?<![0-9a-f:])(?=[0-9a-f:]*:[0-9a-f:]*:)[0-9a-f:]+(?![0-9a-f:])/gi;
const SENSITIVE_QUERY =
  /([?&][^&#=\s]*(?:token|secret|password|passphrase|api[_-]?key|session|cookie|jwt|authorization|credential|code)[^&#=\s]*=)[^&#\s]*/gi;
const SENSITIVE_ASSIGNMENT =
  /\b((?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password|passphrase|session(?:id)?|jwt|credential|secret|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const AUTHORIZATION_HEADER =
  /\b(?:authorization|proxy-authorization)\s*:[^\r\n]*/gi;
const COOKIE_HEADER = /\b(?:cookie|set-cookie)\s*:\s*[^\r\n]*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SENSITIVE_WHITESPACE =
  /\b(?:session\s+token|access\s+token|refresh\s+token|client\s+secret|api\s+key|password|passphrase|credential|secret|token)\s+[^\s,;]+/gi;
const SAFE_ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "DOMException",
]);

export function safeErrorName(value: unknown): string {
  return typeof value === "string" && SAFE_ERROR_NAMES.has(value) ? value : "Error";
}

function redactString(value: string, maxLength: number): string {
  const redacted = value
    .replace(SENSITIVE_QUERY, "$1[REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT, "$1[REDACTED]")
    .replace(AUTHORIZATION_HEADER, "Authorization: [REDACTED]")
    .replace(COOKIE_HEADER, "Cookie: [REDACTED]")
    .replace(JWT, "[REDACTED_JWT]")
    .replace(SENSITIVE_WHITESPACE, "[REDACTED_CREDENTIAL]")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(IPV4, "[REDACTED_IP]")
    .replace(IPV6, "[REDACTED_IP]");
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}[TRUNCATED]` : redacted;
}

export function redactSensitive(
  value: unknown,
  options: RedactionOptions = {},
): unknown {
  const maxDepth = options.maxDepth ?? 5;
  const maxEntries = options.maxEntries ?? 50;
  const maxStringLength = options.maxStringLength ?? 1_000;
  const seen = new WeakSet<object>();

  function visit(current: unknown, depth: number): unknown {
    if (typeof current === "string") return redactString(current, maxStringLength);
    if (
      current === null ||
      typeof current === "number" ||
      typeof current === "boolean" ||
      typeof current === "undefined"
    ) {
      return current;
    }
    if (typeof current === "bigint" || typeof current === "symbol" || typeof current === "function") {
      return `[${typeof current}]`;
    }
    if (depth >= maxDepth) return "[TRUNCATED]";
    if (typeof current !== "object") return "[UNSUPPORTED]";
    if (seen.has(current)) return "[CIRCULAR]";
    seen.add(current);

    if (current instanceof Error) {
      return {
        name: safeErrorName(current.name),
        message: "[REDACTED_ERROR_MESSAGE]",
      };
    }
    if (Array.isArray(current)) {
      return current.slice(0, maxEntries).map((entry) => visit(entry, depth + 1));
    }

    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(current).slice(0, maxEntries)) {
      result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : visit(nested, depth + 1);
    }
    return result;
  }

  return visit(value, 0);
}
