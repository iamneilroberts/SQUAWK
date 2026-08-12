# PIN Sign-In — Design (#40)

**Date:** 2026-08-12 · **Issue:** #40 · **Owner directive:** "use the email pin entered in the
screen where the flight was selected instead of trying to handoff."

## 1. Problem

The magic-link email opens in the device's DEFAULT browser, not the PWA/Safari tab that
requested it. The requesting tab never re-checks `/api/me` (sign-in detection is one-shot,
fragment-based via `AuthReturn`), so the briefing is stranded and the player cannot start a
flight. Root cause is structural: two browser contexts, one cookie jar each.

## 2. Fix

The sign-in email carries a **6-digit one-time code**, typed into the SAME SignInSheet that
requested it. The sheet verifies the code in-place — same tab, same cookie jar, no redirect.
The briefing state is still live in memory, so TAKE CONTROLS unlocks immediately.

The existing magic LINK stays in the email as a fallback (works when the email is opened in
the same browser); consuming either form invalidates both — they are one request row.

## 3. Worker

- **Migration `0005_auth_codes.sql`:** `ALTER TABLE magic_links ADD COLUMN code_digest TEXT`
  (nullable — old rows have none) and `ADD COLUMN code_attempts INTEGER NOT NULL DEFAULT 0`.
- **`POST /api/auth/request`** additionally generates a 6-digit crypto-random code
  (`000000`–`999999`, leading zeros kept). Stored as
  `code_digest = sha256(email_key + ":" + code)` — salted with `email_key` so a leaked DB
  cannot be cross-matched offline against the 10^6 space per-row-cheaply. Raw code appears
  only in the email. Same row, same 15-min TTL, same enumeration-proof 202 response.
- **`POST /api/auth/verify-code` (new)** — body `{ email, code }` (code `/^\d{6}$/`).
  Same IP rate limiter as request (`AUTH_REQUEST_RATE_LIMITER`). No Turnstile (the request
  that sent the email was already Turnstile-gated; the code space is attempt-capped).
  Flow: newest unconsumed, unexpired `magic_links` row for the `email_key` that HAS a
  `code_digest` → **atomic attempt increment** (`UPDATE … SET code_attempts = code_attempts+1
  WHERE id = ? AND code_attempts < 5 AND consumed_at IS NULL AND expires_at > ?`; 0 rows
  changed → fail) → constant-time digest compare → on match, the SAME 5-statement consume
  batch as the link path (mark consumed via the one-use trigger, upsert user + preferences,
  revoke prior session, insert session). Response mirrors `/api/auth/consume`: session
  cookie + `csrfToken`. ALL failures return the same 401 `AUTH_CODE_INVALID` — no
  wrong-code / expired / no-request distinction (enumeration-proof).
- **Email:** subject "Your sign-in code: NNN NNN"; body leads with the code, link below as
  fallback. Identity is still never logged.

## 4. Frontend

- `SignInSheet` state machine gains a code-entry step: after 202, the "sent" branch renders
  a 6-digit input (`inputmode="numeric"`, `autocomplete="one-time-code"` — iOS offers the
  code straight from Mail) + VERIFY CODE button → `verifyAuthCode(email, code)` → on 200,
  `loadCurrentProfile()` and the existing `onAuthenticated` path. No reload: the provisional
  briefing is untouched and TAKE CONTROLS unlocks in place.
- Wrong/expired code → inline "CODE INVALID OR EXPIRED" + the existing re-send affordance.
- Copy: "EMAIL A ONE-TIME CODE TO CONTINUE THIS BRIEFING." / "ENTER THE 6-DIGIT CODE FROM
  THE EMAIL." / button "SEND CODE" → "VERIFY CODE".
- `AuthReturn` fragment path unchanged (link fallback).

## 5. Security invariants (all pre-existing ones hold)

Digest-only storage (now also for codes, salted) · one-use enforced by the existing
`magic_links_consumed_once` trigger and shared `consumed_at` · prior-session revocation on
sign-in · constant public responses on both request and verify · 5 code attempts per row,
3 emails/hour/address, 5 requests/min/IP · 15-min TTL · session cookie `__Host-` +
HttpOnly + SameSite=Lax, CSRF token HMAC-bound to session, returned in body only.

## 6. Non-goals

Removing Turnstile · TOTP/passkeys · changing session TTL or the `/api/me` contract ·
resend-cooldown UI beyond what exists.

## 7. Acceptance

1. On a phone: request code from the briefing, read the 6 digits from Mail, type them into
   the still-open sheet → signed in, TAKE CONTROLS active, no browser switch.
2. The emailed link still signs in when opened in the same browser.
3. 6th wrong attempt on a code → 401 even with the right code afterward (row burned).
4. Worker + frontend suites green; enumeration-proof responses pinned by tests.
