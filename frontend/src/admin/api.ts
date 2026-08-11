export class AdminApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "AdminApiError";
  }
}

type Envelope<T> = {
  ok: boolean;
  code: string;
  data?: T;
  error?: { message?: string };
};

async function envelope<T>(response: Response): Promise<T> {
  let body: Envelope<T> | null = null;
  try {
    body = await response.json() as Envelope<T>;
  } catch {
    throw new AdminApiError(response.status, "INVALID_RESPONSE", "The admin API returned an invalid response.");
  }
  if (!response.ok || !body.ok || body.data === undefined) {
    throw new AdminApiError(
      response.status,
      body.code ?? "ADMIN_REQUEST_FAILED",
      body.error?.message ?? "The admin request failed.",
    );
  }
  return body.data;
}

export async function adminGet<T>(path: string): Promise<T> {
  return envelope<T>(await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  }));
}

export async function adminMutation<T>(
  path: string,
  body: unknown,
  csrfToken: string,
): Promise<T> {
  return envelope<T>(await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify(body),
  }));
}

export type AdminStatus = {
  utcDay: string;
  admittedRequests: number;
  providerRequests: number;
  automaticMode: "NORMAL" | "READ_ONLY" | "KILL_SWITCH";
  requestedMode: "NORMAL" | "READ_ONLY" | "KILL_SWITCH";
  effectiveMode: "NORMAL" | "READ_ONLY" | "KILL_SWITCH";
  budgetBand: string;
  activeFlights: number;
  protectedReserveRemaining: number;
  registrationEnabled: boolean;
  providerCacheOnly: boolean;
  health: Record<string, number>;
};

export type AdminBootstrap = { status: AdminStatus; csrfToken: string };

export function loadAdminBootstrap(): Promise<AdminBootstrap> {
  return adminGet("/api/admin/status");
}

export function saveDownload(file: {
  filename: string;
  contentType: string;
  content: string;
}): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
}

