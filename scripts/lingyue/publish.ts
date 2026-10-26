import type { Database } from '../../src/server/lingyue/database.js';
import { terms } from '../../src/server/lingyue/text.js';
import { cacheKey, validatePrepared } from './prepared.js';

/** Upload a complete immutable version in one transaction; never change the live pointer here. */
export async function stage(db: Database, value: unknown) {
  const { artifact, chunks, manifest } = validatePrepared(value);
  await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM lingyue.control WHERE id=1 FOR UPDATE');
    const exists = await tx.query('SELECT id FROM lingyue.versions WHERE id=$1', [manifest.version]);
    if (exists.length) return;
    await tx.query('INSERT INTO lingyue.versions(id,document_count,chunk_count,manifest_hash) VALUES ($1,$2,$3,$4)', [
      manifest.version,
      manifest.documents,
      chunks.length,
      manifest.hash,
    ]);
    for (let i = 0; i < chunks.length; i += 32) {
      const rows = chunks.slice(i, i + 32).map((c) => ({
        id: c.id,
        document_id: c.documentId,
        ordinal: c.ordinal,
        data: c,
        embedding: JSON.stringify(artifact.vectors[cacheKey(c.hash)]),
        embedding_key: cacheKey(c.hash),
        title_terms: terms(c.title),
        tag_terms: terms(c.tags.join(' ')),
        body_terms: terms(`${c.heading} ${c.text}`),
      }));
      await tx.query(
        `INSERT INTO lingyue.chunks
        SELECT $1,x.id,x.document_id,x.ordinal,x.data,x.embedding::vector,x.title_terms,x.tag_terms,x.body_terms,x.embedding_key
        FROM jsonb_to_recordset($2::jsonb) AS x(id text,document_id text,ordinal int,data jsonb,
        embedding text,title_terms text[],tag_terms text[],body_terms text[],embedding_key text)`,
        [manifest.version, JSON.stringify(rows)],
      );
    }
    // The cache belongs to publication tooling. Runtime credentials cannot mutate it.
    const vectors = Object.entries(artifact.vectors).map(([key, v]) => ({ key, embedding: JSON.stringify(v) }));
    for (let i = 0; i < vectors.length; i += 64)
      await tx.query(
        `INSERT INTO lingyue.embeddings(key,embedding)
       SELECT key,embedding::vector FROM jsonb_to_recordset($1::jsonb) AS x(key text,embedding text)
       ON CONFLICT(key) DO NOTHING`,
        [JSON.stringify(vectors.slice(i, i + 64))],
      );
  });
  return manifest;
}

/** Caller verifies the public deployment fingerprint before activating. CAS rejects competing publishers. */
export async function activate(db: Database, version: string, expected: string | null, now = new Date()) {
  await db.transaction(async (tx) => {
    const [control] = await tx.query<{ active_version: string | null }>(
      'SELECT active_version FROM lingyue.control WHERE id=1 FOR UPDATE',
    );
    if (!control) throw new Error('Database is not initialized');
    if (control.active_version === version) return;
    if (control.active_version !== expected) throw new Error('Another release activated; verify the deployment again');
    const [target] = await tx.query<{ chunk_count: number }>('SELECT chunk_count FROM lingyue.versions WHERE id=$1', [version]);
    const [count] = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM lingyue.chunks WHERE version=$1', [version]);
    if (!target || count!.n !== target.chunk_count) throw new Error('Incomplete knowledge version');
    await tx.query('UPDATE lingyue.versions SET retired_at=$2 WHERE id=$1', [control.active_version, now.toISOString()]);
    await tx.query('UPDATE lingyue.versions SET activated_at=$2,retired_at=NULL WHERE id=$1', [version, now.toISOString()]);
    await tx.query('UPDATE lingyue.control SET active_version=$1 WHERE id=1', [version]);
  });
}

/** Separate from content equality: retries also clean retired versions, with a grace period for in-flight reads. */
export async function cleanup(db: Database, now = new Date()) {
  await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM lingyue.control WHERE id=1 FOR UPDATE');
    await tx.query(
      `DELETE FROM lingyue.versions WHERE id IS DISTINCT FROM
      (SELECT active_version FROM lingyue.control WHERE id=1)
      AND coalesce(retired_at,created_at)<$1::timestamptz`,
      [new Date(now.getTime() - 7 * 86400000).toISOString()],
    );
    await tx.query(
      `DELETE FROM lingyue.embeddings e WHERE NOT EXISTS
      (SELECT 1 FROM lingyue.chunks c WHERE c.embedding_key=e.key)
      AND updated_at<$1::timestamptz`,
      [new Date(now.getTime() - 7 * 86400000).toISOString()],
    );
  });
}
