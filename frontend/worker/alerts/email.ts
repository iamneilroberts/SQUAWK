import type { Env } from "../env";
import { ALERT_RECIPIENT, type AlertNotification } from "./types";

export type AlertEmailBinding = Pick<SendEmail, "send">;

function bounded(value: string | null): string {
  if (value === null) return "n/a";
  return value.replace(/[\r\n]/g, " ").slice(0, 256);
}

export function alertEmailMessage(
  alert: AlertNotification,
  environment: string,
  adminUrl: string,
): { to: string; from: string; subject: string; text: string } {
  const normalizedEnvironment = environment.toUpperCase().replace(/[^A-Z0-9_-]/g, "-").slice(0, 24);
  const sender = "alerts@fly.voygent.app";
  const subject = `[VOYGENT ADSB][${normalizedEnvironment}][${alert.severity.toUpperCase()}] ${bounded(alert.title)}`;
  const text = [
    alert.phase === "test" ? "TEST ALERT — no production incident is implied." : "Voygent ADS-B operational alert.",
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
  return { to: ALERT_RECIPIENT, from: sender, subject, text };
}

export async function sendAlertEmail(
  env: Pick<Env, "ALERT_EMAIL" | "APP_ENV" | "PUBLIC_ORIGIN">,
  alert: AlertNotification,
): Promise<void> {
  const origin = env.PUBLIC_ORIGIN ?? "https://fly.voygent.app";
  const message = alertEmailMessage(alert, env.APP_ENV ?? "local", `${origin.replace(/\/$/, "")}/admin`);
  await env.ALERT_EMAIL.send(message);
}
