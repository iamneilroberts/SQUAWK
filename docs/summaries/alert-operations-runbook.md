# ADS-B game alert operations runbook

## Application alert path

The singleton `AdsbBroker` owns transition, cooldown, deduplication, and pending-delivery
state. Alert mail is sent from `alerts@fly.voygent.app` through the `ALERT_EMAIL`
binding, which permits only that sender and the fixed destination
`dneilroberts@gmail.com`. A failed send remains in the broker outbox and is retried with
bounded backoff. A five-minute UTC Cron retries pending mail, evaluates silent provider
staleness and recoveries, rolls health windows, and backfills recent audited admin events.
A missed Cron invocation is absence of evidence, not evidence that the application is
healthy.

Messages contain only the UTC time, environment, bounded signal/threshold/action,
remaining capacity, request/audit IDs when applicable, and the environment's `/admin`
link. They must never contain an actor email, IP address, admin reason, request body,
token, secret, or ADS-B contact data.

The transition thresholds are:

- admitted dynamic requests at 70%, 90%, and 100% of daily capacity, plus UTC reset;
- provider calls at 70%, 90%, and 100% of the configured daily allowance, plus UTC reset;
- active flights at 8 of 10 and 10 of 10, plus downward transitions;
- API 5xx at a minimum of 20 observed requests, at least five failures, and at least a
  20% five-minute failure rate; recovery is 5% or lower;
- D1, R2, Email, and provider health after three consecutive failures, with success
  recovery;
- all-provider cache staleness/recovery during the scheduled check;
- audited mode, settings, cache, ban/unban, session revoke, flight termination, and
  test-alert actions.

Health/provider/API signals use a 15-minute per-state cooldown. Distinct capacity bands,
audited actions, TEST drills, and recoveries retain their own fingerprints.

## Staging delivery drill — Owner checkpoint C

1. Open the Access-protected staging `/admin` console and select **Controls**.
2. Enter a non-PII reason of at least eight characters and select **Send test alert**.
3. Confirm the response succeeds and the audit/event views contain `alert.test` with the
   request and audit IDs.
4. Confirm exactly one email reaches `dneilroberts@gmail.com`. Its subject must contain
   `[VOYGENT ADSB][STAGING][TEST]`, and its first line must say `TEST ALERT`.
5. Confirm the email's UTC time, environment, IDs, and admin link match the audit. Confirm
   it contains no reason text, actor identity, email/IP, token, or secret.
6. Repeat with the same idempotency key only in an API drill; confirm no second email.
7. Run the read-only, kill-switch/recovery, provider cache-only, and user/session/flight
   control drills from checkpoint C. Confirm one action email per new audit and no storm.

If delivery fails, do not repeat with new idempotency keys. Preserve the original audit
ID, inspect Workers Logs for `adsb_alert_delivery_failed`, verify the Email routing domain
and binding restrictions, and allow the five-minute Cron to retry. Use the Cloudflare
notification backups below while the application path is degraded.

## Manual Cloudflare-native backup notifications

These policies require an account Administrator (or Notifications Read/Write API token)
and are deliberately provisioned through Cloudflare rather than granting the application
Worker account-mutation privileges.

In the Cloudflare dashboard, open **Notifications**, select **Add**, choose the applicable
account notification, set the recipient to `dneilroberts@gmail.com`, scope it to the ADS-B
game services/resources where filters are offered, create it, and use **Test** on the
enabled policy. At checkpoint C, configure and record:

- Workers error/exception notification for the staging and production ADS-B game
  services, if that notification is available on the account plan;
- resource-usage notifications offered for Workers, Durable Objects, D1, R2, and Email;
- two usage-based billing policies at **$10** and **$25** for the applicable Cloudflare
  usage products.

Notification availability and filters vary by plan. If a named policy is not offered,
record `not available on current plan` in the checkpoint evidence rather than substituting
an unreviewed webhook or giving the Worker broader credentials.

Cloudflare notifications and billing alerts are delayed informational safeguards. They
are not a hard spending cap and cannot replace broker admission limits, provider
allowances, dashboards, or operator review. Keep both $10 and $25 policies enabled so a
missed or delayed lower threshold does not silently remove the higher warning.

## Recovery evidence

For every drill or incident, retain the deployment version, environment, first and last
email UTC times, signal and recovery fingerprints, request/audit IDs, and relevant
scrubbed log links. Do not paste email bodies, Access assertions, cookies, secrets, raw
addresses, or raw request payloads into the repository.
