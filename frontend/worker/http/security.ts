import { ApiHttpError } from "./response";

export type AppEnvironment = "local" | "staging" | "production";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://services.arcgisonline.com https://*.reearth.land https://api.rainviewer.com https://*.rainviewer.com https://api.cesium.com https://*.cesium.com",
  "connect-src 'self' blob: https://services.arcgisonline.com https://*.reearth.land https://api.rainviewer.com https://*.rainviewer.com https://api.cesium.com https://*.cesium.com https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self'",
].join("; ");

export function enforceSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin === null || origin === "null") {
    throw new ApiHttpError(403, "ORIGIN_REQUIRED", "Origin header is required");
  }

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    throw new ApiHttpError(403, "ORIGIN_MISMATCH", "Origin does not match request");
  }

  if (normalizedOrigin !== new URL(request.url).origin || normalizedOrigin !== origin) {
    throw new ApiHttpError(403, "ORIGIN_MISMATCH", "Origin does not match request");
  }
}

export function securityHeaders(appEnv: AppEnvironment): Headers {
  const headers = new Headers({
    "content-security-policy": CONTENT_SECURITY_POLICY,
    "permissions-policy":
      "accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  if (appEnv === "production") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return headers;
}

export function applySecurityHeaders(
  response: Response,
  appEnv: AppEnvironment,
): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of securityHeaders(appEnv)) {
    secured.headers.set(name, value);
  }
  return secured;
}
