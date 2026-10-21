CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE allowed (id TEXT PRIMARY KEY);
CREATE TABLE chunks (version TEXT NOT NULL, id TEXT NOT NULL, document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(version,id));
CREATE INDEX chunks_document ON chunks(version,document_id,ordinal);
CREATE VIRTUAL TABLE search USING fts5(version UNINDEXED,id UNINDEXED,title,tags,body);
CREATE TABLE embeddings (key TEXT PRIMARY KEY, data TEXT NOT NULL);
