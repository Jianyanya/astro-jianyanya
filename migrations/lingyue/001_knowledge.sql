CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS lingyue;

CREATE TABLE IF NOT EXISTS lingyue.versions (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz,
  document_count integer NOT NULL,
  chunk_count integer NOT NULL,
  manifest_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS lingyue.control (
  id integer PRIMARY KEY CHECK (id=1),
  active_version text REFERENCES lingyue.versions(id)
);
INSERT INTO lingyue.control(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS lingyue.chunks (
  version text NOT NULL REFERENCES lingyue.versions(id) ON DELETE CASCADE,
  id text NOT NULL,
  document_id text NOT NULL,
  ordinal integer NOT NULL,
  data jsonb NOT NULL,
  embedding vector(1024) NOT NULL,
  title_terms text[] NOT NULL,
  tag_terms text[] NOT NULL,
  body_terms text[] NOT NULL,
  embedding_key text NOT NULL,
  PRIMARY KEY(version,id)
);
CREATE INDEX IF NOT EXISTS chunks_document ON lingyue.chunks(version,document_id,ordinal);
ALTER TABLE lingyue.chunks ADD COLUMN IF NOT EXISTS embedding_key text NOT NULL DEFAULT '';
ALTER TABLE lingyue.chunks ALTER COLUMN embedding_key DROP DEFAULT;
CREATE INDEX IF NOT EXISTS chunks_embedding_key ON lingyue.chunks(embedding_key);
CREATE TABLE IF NOT EXISTS lingyue.embeddings (
  key text PRIMARY KEY,
  embedding vector(1024) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lingyue.requests (
  id uuid PRIMARY KEY,
  visitor text NOT NULL,
  ip text NOT NULL,
  day text NOT NULL,
  month text NOT NULL,
  created bigint NOT NULL,
  cost double precision NOT NULL,
  state text NOT NULL CHECK(state IN ('reserved','settled')),
  expires bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_day ON lingyue.requests(day);
CREATE INDEX IF NOT EXISTS requests_month ON lingyue.requests(month);
CREATE TABLE IF NOT EXISTS lingyue.quota_lock(id integer PRIMARY KEY CHECK(id=1));
INSERT INTO lingyue.quota_lock VALUES (1) ON CONFLICT DO NOTHING;
