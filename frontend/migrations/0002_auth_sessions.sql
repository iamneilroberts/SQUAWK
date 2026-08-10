ALTER TABLE magic_links ADD COLUMN consume_nonce TEXT CHECK (
  consume_nonce IS NULL OR length(consume_nonce) = 36
);

CREATE UNIQUE INDEX idx_magic_links_consume_nonce
  ON magic_links(consume_nonce)
  WHERE consume_nonce IS NOT NULL;

ALTER TABLE sessions ADD COLUMN csrf_digest TEXT CHECK (
  csrf_digest IS NULL OR (
    length(csrf_digest) = 64 AND csrf_digest NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE TABLE auth_email_rate_events (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  email_key TEXT NOT NULL CHECK (
    length(email_key) = 64 AND email_key NOT GLOB '*[^0-9a-f]*'
  ),
  requested_at INTEGER NOT NULL CHECK (requested_at >= 0)
) STRICT;

CREATE INDEX idx_auth_email_rate_events_identity_time
  ON auth_email_rate_events(email_key, requested_at);
