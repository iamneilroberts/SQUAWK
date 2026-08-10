PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  email_key TEXT NOT NULL UNIQUE CHECK (
    length(email_key) = 64 AND email_key NOT GLOB '*[^0-9a-f]*'
  ),
  handle TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(handle) BETWEEN 3 AND 32),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'banned')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  center_lat REAL NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
  center_lon REAL NOT NULL CHECK (center_lon BETWEEN -180 AND 180),
  region_key TEXT NOT NULL CHECK (length(region_key) BETWEEN 1 AND 96),
  default_assist TEXT NOT NULL CHECK (default_assist IN ('none', 'low', 'medium', 'high')),
  tutorial_state TEXT NOT NULL CHECK (tutorial_state IN ('new', 'started', 'complete', 'dismissed')),
  coaching_enabled INTEGER NOT NULL CHECK (coaching_enabled IN (0, 1)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

CREATE TABLE magic_links (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  token_digest TEXT NOT NULL UNIQUE CHECK (
    length(token_digest) = 64 AND token_digest NOT GLOB '*[^0-9a-f]*'
  ),
  email_key TEXT NOT NULL CHECK (
    length(email_key) = 64 AND email_key NOT GLOB '*[^0-9a-f]*'
  ),
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
  consumed_at INTEGER CHECK (consumed_at IS NULL OR consumed_at >= 0),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 128),
  requested_at INTEGER NOT NULL CHECK (requested_at >= 0),
  CHECK (expires_at > requested_at),
  CHECK (consumed_at IS NULL OR (consumed_at >= requested_at AND consumed_at < expires_at))
) STRICT;

CREATE TRIGGER magic_links_consumed_once
BEFORE UPDATE OF consumed_at ON magic_links
WHEN OLD.consumed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'magic link already consumed');
END;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_digest TEXT NOT NULL UNIQUE CHECK (
    length(session_digest) = 64 AND session_digest NOT GLOB '*[^0-9a-f]*'
  ),
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= 0),
  device_label TEXT CHECK (device_label IS NULL OR length(device_label) <= 128),
  rotated_from_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (expires_at > created_at),
  CHECK (last_seen_at >= created_at AND last_seen_at < expires_at)
) STRICT;

CREATE TABLE missions (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  aircraft_hex TEXT NOT NULL CHECK (
    length(aircraft_hex) = 6 AND aircraft_hex NOT GLOB '*[^0-9a-f]*'
  ),
  aircraft_class TEXT NOT NULL CHECK (length(aircraft_class) BETWEEN 1 AND 48),
  adsb_snapshot_json TEXT NOT NULL CHECK (length(adsb_snapshot_json) BETWEEN 2 AND 24576),
  airport_icao TEXT NOT NULL CHECK (length(airport_icao) = 4),
  runway_ident TEXT NOT NULL CHECK (length(runway_ident) BETWEEN 1 AND 8),
  scoring_version TEXT NOT NULL CHECK (length(scoring_version) BETWEEN 1 AND 32),
  physics_version TEXT NOT NULL CHECK (length(physics_version) BETWEEN 1 AND 32),
  assists_json TEXT NOT NULL CHECK (length(assists_json) BETWEEN 2 AND 4096),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked', 'finalized', 'abandoned')),
  trace_pointer TEXT CHECK (trace_pointer IS NULL OR length(trace_pointer) <= 256),
  trace_expires_at INTEGER CHECK (
    (trace_pointer IS NULL AND trace_expires_at IS NULL) OR
    (trace_pointer IS NOT NULL AND trace_expires_at >= 0)
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  locked_at INTEGER CHECK (locked_at IS NULL OR locked_at >= created_at),
  finalized_at INTEGER CHECK (finalized_at IS NULL OR finalized_at >= created_at),
  CHECK (trace_expires_at IS NULL OR trace_expires_at > created_at)
) STRICT;

CREATE TABLE flight_results (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  mission_id TEXT NOT NULL UNIQUE REFERENCES missions(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('landed', 'crashed', 'aborted', 'invalid')),
  measurements_json TEXT NOT NULL CHECK (length(measurements_json) BETWEEN 2 AND 16384),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 1000000),
  highest_assist TEXT NOT NULL CHECK (highest_assist IN ('none', 'low', 'medium', 'high')),
  evidence_status TEXT NOT NULL CHECK (evidence_status IN ('verified', 'partial', 'rejected')),
  evidence_summary_json TEXT NOT NULL CHECK (length(evidence_summary_json) BETWEEN 2 AND 16384),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TABLE user_bans (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email_key TEXT CHECK (
    email_key IS NULL OR (length(email_key) = 64 AND email_key NOT GLOB '*[^0-9a-f]*')
  ),
  scope TEXT NOT NULL CHECK (scope IN ('temporary', 'permanent')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 512),
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 128),
  expires_at INTEGER,
  revoked_at INTEGER,
  revoked_by TEXT CHECK (revoked_by IS NULL OR length(revoked_by) <= 128),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (user_id IS NOT NULL OR email_key IS NOT NULL),
  CHECK (
    (scope = 'temporary' AND expires_at IS NOT NULL AND expires_at > created_at) OR
    (scope = 'permanent' AND expires_at IS NULL)
  ),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
) STRICT;

CREATE TABLE system_events (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  level TEXT NOT NULL CHECK (level IN ('warning', 'error', 'transition')),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 64),
  event_key TEXT NOT NULL CHECK (length(event_key) BETWEEN 1 AND 96),
  request_id TEXT CHECK (request_id IS NULL OR length(request_id) BETWEEN 8 AND 128),
  context_json TEXT NOT NULL CHECK (length(context_json) BETWEEN 2 AND 4096),
  trace_pointer TEXT CHECK (trace_pointer IS NULL OR length(trace_pointer) <= 256),
  trace_expires_at INTEGER CHECK (
    (trace_pointer IS NULL AND trace_expires_at IS NULL) OR
    (trace_pointer IS NOT NULL AND trace_expires_at >= 0)
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (trace_expires_at IS NULL OR trace_expires_at > created_at)
) STRICT;

CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 96),
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 128),
  target_type TEXT NOT NULL CHECK (length(target_type) BETWEEN 1 AND 64),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 128),
  old_state_json TEXT CHECK (old_state_json IS NULL OR length(old_state_json) BETWEEN 2 AND 8192),
  new_state_json TEXT CHECK (new_state_json IS NULL OR length(new_state_json) BETWEEN 2 AND 8192),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 512),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TRIGGER admin_audit_no_update
BEFORE UPDATE ON admin_audit
BEGIN
  SELECT RAISE(ABORT, 'admin audit is append-only');
END;

CREATE TRIGGER admin_audit_no_delete
BEFORE DELETE ON admin_audit
BEGIN
  SELECT RAISE(ABORT, 'admin audit is append-only');
END;

CREATE INDEX idx_users_status ON users(status, created_at);
CREATE INDEX idx_magic_links_expiry ON magic_links(expires_at, consumed_at);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at, revoked_at);
CREATE INDEX idx_sessions_user_status ON sessions(user_id, revoked_at, expires_at);
CREATE INDEX idx_missions_user_status ON missions(user_id, status, created_at);
CREATE INDEX idx_missions_state ON missions(status, created_at);
CREATE INDEX idx_user_bans_user_status ON user_bans(user_id, revoked_at, expires_at);
CREATE INDEX idx_user_bans_email_status ON user_bans(email_key, revoked_at, expires_at);
CREATE INDEX idx_system_events_time ON system_events(created_at);
CREATE INDEX idx_system_events_category_time ON system_events(category, created_at);
CREATE INDEX idx_admin_audit_time ON admin_audit(created_at);
