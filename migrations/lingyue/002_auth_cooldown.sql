CREATE TABLE IF NOT EXISTS lingyue.auth_sessions (
  token_hash text PRIMARY KEY,
  github_id text NOT NULL,
  login text NOT NULL,
  expires bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expires ON lingyue.auth_sessions(expires);
ALTER TABLE lingyue.quota_lock ADD COLUMN IF NOT EXISTS cooldown_until bigint NOT NULL DEFAULT 0;
ALTER TABLE lingyue.quota_lock ADD COLUMN IF NOT EXISTS next_start bigint NOT NULL DEFAULT 0;
