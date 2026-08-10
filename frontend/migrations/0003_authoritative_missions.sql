ALTER TABLE missions ADD COLUMN airport_ident TEXT CHECK (
  airport_ident IS NULL OR length(airport_ident) BETWEEN 3 AND 4
);

CREATE UNIQUE INDEX idx_missions_user_idempotency_v1
ON missions (
  user_id,
  json_extract(adsb_snapshot_json, '$.idempotencyKey')
)
WHERE json_extract(adsb_snapshot_json, '$.idempotencyKey') IS NOT NULL;
