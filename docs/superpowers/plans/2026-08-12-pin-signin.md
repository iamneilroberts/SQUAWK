# PIN Sign-In Implementation Plan (#40)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the stranded magic-link handoff with an emailed 6-digit code typed into the same SignInSheet, per `docs/superpowers/specs/2026-08-12-pin-signin.md` (read it first — it is binding).

**Architecture:** One request row serves both code and link (shared one-use). New `POST /api/auth/verify-code` reuses the existing atomic consume batch. Frontend adds a code-entry step to SignInSheet; no reload, briefing survives in memory.

**Tech Stack:** Cloudflare Worker + D1 (STRICT schema, migrations in `frontend/migrations/`) · React 18 + TS · vitest (worker integration tests run against real D1 via the existing harness — follow `frontend/worker/auth/magicLinks.integration.test.ts` conventions).

## Global Constraints

- All security invariants in spec §5 — verify each in tests, not by inspection.
- ALL verify-code failures return the identical 401 `AUTH_CODE_INVALID` body; `/api/auth/request` keeps its identical 202 regardless of outcome.
- `code_digest = sha256(email_key + ":" + code)` hex — salted exactly so; raw code never stored or logged; email identity never logged.
- Code format `/^\d{6}$/`, leading zeros legal (crypto-random integer 0–999999, zero-padded).
- Max 5 verify attempts per row, enforced by an atomic UPDATE-increment guard, not read-then-write.
- No new dependencies. No Turnstile on verify-code. Existing link path (`/api/auth/consume`, `AuthReturn`) stays fully working.
- Existing tests may be EXTENDED, never weakened; the existing consume-batch semantics (user upsert, preference upsert, prior-session revocation, single-winner) must be reused, not reimplemented.
- Run commands from `/home/neil/dev/adsb-game-worktrees/mongols-rich-hud/frontend`.
- Commit per task; suite green at every commit.

---

### Task 1: Migration + code generation/storage + consume-by-code core

**Files:**
- Create: `frontend/migrations/0005_auth_codes.sql`
- Modify: `frontend/worker/db/users.ts` (`createMagicLink` gains code digest), `frontend/worker/auth/magicLinks.ts` (new `consumeAuthCodeSession`), `frontend/worker/auth/sessions.ts` or a small helper for code generation (implementer's call, follow file conventions)
- Test: extend `frontend/worker/auth/magicLinks.integration.test.ts` (+ a focused unit test for code generation/digest if conventions suggest one)

**Interfaces (Produces — Task 2 depends on these exactly):**
- `generateSignInCode(): string` — 6 crypto-random digits, zero-padded.
- `codeDigest(emailKey: string, code: string): Promise<string>` — sha256 hex of `${emailKey}:${code}`.
- `createMagicLink(...)` extended to persist `code_digest` for new rows.
- `consumeAuthCodeSession(db, { emailKey, code, now, ... }): Promise<SessionResult | null>` — newest eligible row for emailKey with non-null code_digest → atomic attempt increment (guard `code_attempts < 5 AND consumed_at IS NULL AND expires_at > now`, 0 rows → null) → constant-time digest compare → on match the SAME batch semantics as `consumeMagicLinkSession` (reuse/refactor its statement builder; do not duplicate the 5 statements). Null on any failure, indistinguishable.

**Steps (TDD):**
- [ ] Write failing integration tests FIRST covering: happy path issues a session + revokes the prior one; wrong code 5× burns the row (6th with correct code → null); expired row → null; row consumed via LINK → code null (and vice-versa: code consume marks the row so the link token is dead); concurrent double-verify has a single winner; legacy row with NULL code_digest is never matched; digest is salted (row for email A cannot be consumed with email B + same code).
- [ ] Run to confirm they fail. Implement migration + code. Run to green.
- [ ] Migration check: `npx wrangler d1 migrations apply DB --local` (or the harness's migration loader) proves 0005 applies over 0001–0004 on the STRICT schema.
- [ ] Full gate `npx vitest run && npx tsc --noEmit`. Commit `feat(auth): one-time sign-in codes — storage, atomic attempt-capped consume (#40)`.

### Task 2: `/api/auth/verify-code` route + email template

**Files:**
- Modify: `frontend/worker/http/routes/auth.ts` (new route in `createAuthRoutes`), `frontend/worker/auth/email.ts` (code-first template)
- Test: extend `frontend/worker/http/routes/auth.integration.test.ts`, `frontend/worker/auth/email.test.ts`

**Interfaces:**
- Consumes Task 1's exports verbatim.
- Produces: `POST /api/auth/verify-code` — body `{ email, code }`, exact-keys validated like `/api/auth/request` (same body-size cap); email normalized with the same `email_key` derivation as request; IP rate-limited via `AUTH_REQUEST_RATE_LIMITER` BEFORE any DB work; success → 200 with `__Host-adsb_session` cookie + `{ csrfToken }` body exactly mirroring `/api/auth/consume`'s shape; every failure → the same 401 `AUTH_CODE_INVALID`.
- `/api/auth/request` now also calls `generateSignInCode()` and passes the digest to `createMagicLink`; `sendMagicLinkEmail` renamed/extended to carry the code (subject "Your sign-in code: NNN NNN", body code-first, link below as fallback). Send-failure cleanup still deletes the row.

**Steps (TDD):**
- [ ] Failing tests: route happy path (cookie + csrfToken present, session usable against `/api/me`); identical-401 matrix (unknown email / wrong code / expired / attempt-capped / malformed code all byte-identical bodies); rate-limit 429 path; GET → 405; email test pins code present in body+subject, link still present, no identity in logs, digest-only storage claim unchanged.
- [ ] Implement. Green. Full gate `npx vitest run && npx tsc --noEmit`. Commit `feat(auth): verify-code endpoint + code-first sign-in email (#40)`.

### Task 3: SignInSheet code entry + client API

**Files:**
- Modify: `frontend/src/auth/session.ts` (`verifyAuthCode(email, code)`), `frontend/src/auth/SignInSheet.tsx` (state machine + copy per spec §4)
- Test: extend `frontend/src/auth/session.test.ts`; add `frontend/src/auth/SignInSheet.test.tsx` if a component-test harness convention exists nearby, else pin the new pure state logic

**Interfaces:**
- Consumes: `POST /api/auth/verify-code` contract from Task 2.
- Produces: sheet flow `ready → sending → sent(code entry) → verifying → done|code-error`; input `inputmode="numeric" autocomplete="one-time-code" maxLength=6`; on success `csrfToken` captured (same seam as consume, session.ts:211 pattern), `loadCurrentProfile()`, then the existing `onAuthenticated` callback — sheet closes, briefing continues in place. Code-error state shows "CODE INVALID OR EXPIRED" and keeps the resend affordance. Copy per spec §4. `AuthReturn` untouched.

**Steps (TDD):**
- [ ] Failing tests for `verifyAuthCode` (success stores csrfToken; 401 clears nothing and surfaces a typed error; malformed input rejected client-side without a request).
- [ ] Implement + wire the sheet. Green. Full gate. Commit `feat(auth): in-place 6-digit code entry in SignInSheet (#40)`.

### Task 4: Prod migration + deploy + live verify

- [ ] `npx wrangler d1 migrations apply DB --env production --remote` (database `voygent-adsb-game-production`) — BEFORE deploying the worker that writes the new columns. Capture output.
- [ ] `npm run deploy:production`; probe `https://fly.voygent.app/` → 200.
- [ ] Append a dated CF-020 entry to `docs/decisions.md` (PIN alongside link, one shared row, salted digest, attempt cap — the why per spec §2/§5). Commit docs. Push branch.
- [ ] Owner live test (acceptance spec §7.1); close #40 only after that.

## Self-Review notes

Spec §5 invariants each have a named test in Tasks 1–2. The plan deliberately specifies contracts, invariants, SQL guard, and full test matrices rather than verbatim implementation code: implementers MUST read the existing `magicLinks.ts` / `auth.ts` / `email.ts` and reuse their patterns (the consume batch is reused, not rewritten). Type/name consistency: `generateSignInCode`/`codeDigest`/`consumeAuthCodeSession`/`verifyAuthCode` are the only new cross-task names.
