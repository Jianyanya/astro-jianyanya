ALTER TABLE lingyue.control ADD COLUMN IF NOT EXISTS publication_seq bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS lingyue.withdrawals (
  document_id text PRIMARY KEY,
  withdrawn_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL
);
