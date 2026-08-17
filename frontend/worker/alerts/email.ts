import type { Env } from "../env";
import type { AlertNotification } from "./types";

export type AlertEmailBinding = Pick<SendEmail, "send">;

function bounded(value: string | null): string {
  if (value === null) return "n/a";
  return value.replace(/[\r\n]/g, " ").slice(0, 256);
}

export function alertEmailMessage(
  alert: AlertNotification,
  environment: string,
  adminUrl: string,
  env: { ALERT_FROM_EMAIL: string; ALERT_RECIPIENT: string },
): { to: string; from: string; subject: string; text: string } {
  const normalizedEnvironment = environment.toUpperCase().replace(/[^A-Z0-9_-]/g, "-").slice(0, 24);
  const sender = env.ALERT_FROM_EMAIL;
  const subject = `[SQUAWK][${normalizedEnvironment}][${alert.severity.toUpperCase()}] ${bounded(alert.title)}`;
  const text = [
    alert.phase === "test" ? "TEST ALERT — no production incident is implied." : "SQUAWK operational alert.",
    "",
    `Time (UTC): ${new Date(alert.occurredAtMs).toISOString()}`,
    `Environment: ${normalizedEnvironment}`,
    `State: ${alert.phase}`,
    `Severity: ${alert.severity}`,
    `Signal: ${alert.signalKey}`,
    `Threshold: ${bounded(alert.threshold)}`,
    `Action: ${bounded(alert.action)}`,
    `Remaining capacity: ${alert.remainingCapacity === null ? "n/a" : String(alert.remainingCapacity)}`,
    `Request ID: ${bounded(alert.requestId)}`,
    `Audit ID: ${bounded(alert.auditId)}`,
    `Admin: ${adminUrl}`,
  ].join("\n");
  return { to: env.ALERT_RECIPIENT, from: sender, subject, text };
}

export async function sendAlertEmail(
  env: Pick<Env, "ALERT_EMAIL" | "APP_ENV" | "PUBLIC_ORIGIN" | "ALERT_FROM_EMAIL" | "ALERT_RECIPIENT">,
  alert: AlertNotification,
): Promise<void> {
  const origin = env.PUBLIC_ORIGIN ?? "https://your-domain.example";
  const message = alertEmailMessage(alert, env.APP_ENV ?? "local", `${origin.replace(/\/$/, "")}/admin`, env);
  await env.ALERT_EMAIL.send(message);
}
