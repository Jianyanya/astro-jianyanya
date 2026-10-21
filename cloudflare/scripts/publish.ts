import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Providers } from '../src/providers.js';
import { embeddingText, hash, terms, VECTOR_NAMESPACE } from '../src/text.js';
import type { CloudflareApi, Statement } from './api.js';
import { chunkDocument, PIPELINE_VERSION } from './markdown.js';

const snapshotSchema = z.object({
  schema: z.literal(1),
  documents: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string(),
      body: z.string(),
      locale: z.string(),
      tags: z.array(z.string()),
      url: z
        .string()
        .startsWith('/')
        .refine((s) => !s.startsWith('//') && !/[\\\p{Cc}]/u.test(s)),
    }),
  ),
});
const MODEL = 'BAAI/bge-m3';
const vectorId = (chunk: string) => hash(`${VECTOR_NAMESPACE}:${chunk}`);

export async function publishSnapshot(
  value: unknown,
  api: CloudflareApi,
  providers: Providers,
  progress: (s: string) => void = () => {},
) {
  const snapshot = snapshotSchema.parse(value);
  if (new Set(snapshot.documents.map((d) => d.id)).size !== snapshot.documents.length) throw new Error('Duplicate document');
  const version = hash(JSON.stringify([PIPELINE_VERSION, MODEL, snapshot])).slice(0, 24);
  const owner = randomUUID();
  const now = Date.now();
  await api.sql([
    {
      sql: `INSERT INTO meta VALUES ('lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value
    WHERE json_extract(meta.value,'$.expires')<?`,
      params: [JSON.stringify({ owner, expires: now + 1800000 }), now],
    },
  ]);
  const lock = (await api.sql<{ value: string }>([{ sql: "SELECT value FROM meta WHERE key='lock'" }]))[0]!.results[0];
  if (!lock || JSON.parse(lock.value).owner !== owner) throw new Error('Another index publisher is running');
  try {
    // Withdraw inaccessible posts before embedding, even if the provider subsequently fails.
    await api.sql([
      { sql: 'DELETE FROM allowed' },
      {
        sql: 'INSERT INTO allowed SELECT value FROM json_each(?)',
        params: [JSON.stringify(snapshot.documents.map((d) => d.id))],
      },
    ]);
    const active = (await api.sql<{ value: string }>([{ sql: "SELECT value FROM meta WHERE key='activeVersion'" }]))[0]!
      .results[0]?.value;
    if (active === version) return { unchanged: true, generated: 0, version };

    // Clean previous/failed staging versions before allocating another version.
    const stale = (
      await api.sql<{ version: string; id: string }>([
        {
          sql: 'SELECT DISTINCT id FROM chunks WHERE version<>? AND version<>? AND id NOT IN (SELECT id FROM chunks WHERE version=?)',
          params: [active ?? '', version, active ?? ''],
        },
      ])
    )[0]!.results;
    for (let i = 0; i < stale.length; i += 100) {
      const mutation = await api.remove(stale.slice(i, i + 100).map((r) => vectorId(r.id)));
      await api.wait(mutation.mutationId);
    }
    await api.sql([
      { sql: 'DELETE FROM search WHERE version<>? AND version<>?', params: [active ?? '', version] },
      { sql: 'DELETE FROM chunks WHERE version<>? AND version<>?', params: [active ?? '', version] },
    ]);
    const activeIds = new Set(
      (
        await api.sql<{ id: string }>([
          {
            sql: 'SELECT id FROM chunks WHERE version=?',
            params: [active ?? ''],
          },
        ])
      )[0]!.results.map((r) => r.id),
    );
    const chunks = snapshot.documents.flatMap(chunkDocument);
    if ((chunks.length * 2 + 64) * 1024 > 5000000) throw new Error('Index exceeds planned Free vector storage budget');
    let generated = 0;
    let lastMutation: string | undefined;
    const pendingVectors: Array<{
      id: string;
      namespace: string;
      values: number[];
      metadata: { chunk: string; document: string };
    }> = [];
    const flush = async () => {
      if (!pendingVectors.length) return;
      const mutation = await api.upsert(pendingVectors.splice(0));
      lastMutation = mutation.mutationId;
      if (!lastMutation) throw new Error('Missing Vectorize mutation ID');
    };
    const liveKeys: string[] = [];
    for (let start = 0; start < chunks.length; start += 8) {
      const batch = chunks.slice(start, start + 8);
      const keys = batch.map((chunk) => hash(`${MODEL}:${chunk.hash}`));
      liveKeys.push(...keys);
      const cached = (
        await api.sql<{ key: string; data: string }>([
          {
            sql: 'SELECT key,data FROM embeddings WHERE key IN (SELECT value FROM json_each(?))',
            params: [JSON.stringify(keys)],
          },
        ])
      )[0]!.results;
      const cache = new Map(cached.map((r) => [r.key, JSON.parse(r.data) as number[]]));
      const missing = batch.flatMap((_, i) => (cache.has(keys[i]!) ? [] : [i]));
      const fresh = missing.length
        ? await providers.embed(
            missing.map((i) => embeddingText(batch[i]!)),
            AbortSignal.timeout(60000),
          )
        : [];
      const writes: Statement[] = [];
      for (const [offset, i] of missing.entries()) {
        cache.set(keys[i]!, fresh[offset]!);
        writes.push({
          sql: 'INSERT OR REPLACE INTO embeddings VALUES (?,?)',
          params: [keys[i], JSON.stringify(fresh[offset])],
        });
      }
      if (writes.length) await api.sql(writes);
      // Record staging IDs first so an interrupted upload can be reclaimed on the next run.
      await api.sql(
        batch.flatMap((chunk): Statement[] => [
          {
            sql: 'INSERT OR REPLACE INTO chunks VALUES (?,?,?,?,?)',
            params: [version, chunk.id, chunk.documentId, chunk.ordinal, JSON.stringify(chunk)],
          },
          { sql: 'DELETE FROM search WHERE version=? AND id=?', params: [version, chunk.id] },
          {
            sql: 'INSERT INTO search VALUES (?,?,?,?,?)',
            params: [
              version,
              chunk.id,
              terms(chunk.title).join(' '),
              terms(chunk.tags.join(' ')).join(' '),
              terms(`${chunk.heading} ${chunk.text}`).join(' '),
            ],
          },
        ]),
      );
      const vectors = batch
        .map((chunk, i) => ({
          id: vectorId(chunk.id),
          namespace: VECTOR_NAMESPACE,
          values: cache.get(keys[i]!)!,
          metadata: { chunk: chunk.id, document: hash(chunk.documentId) },
        }))
        .filter((v) => !activeIds.has(v.metadata.chunk));
      pendingVectors.push(...vectors);
      if (pendingVectors.length >= 128) await flush();
      generated += missing.length;
      progress(`Indexed ${Math.min(start + 8, chunks.length)}/${chunks.length}; new embeddings ${generated}`);
    }
    await flush();
    // Mutations are queued in order; wait once after all uploads, not once per 8-vector batch.
    if (lastMutation) await api.wait(lastMutation);
    const count = (
      await api.sql<{ count: number }>([{ sql: 'SELECT COUNT(*) AS count FROM chunks WHERE version=?', params: [version] }])
    )[0]!.results[0]!.count;
    if (count !== chunks.length) throw new Error('Incomplete staging index');
    await api.sql([
      { sql: "INSERT OR REPLACE INTO meta VALUES ('activeVersion',?)", params: [version] },
      { sql: "INSERT OR REPLACE INTO meta VALUES ('indexedAt',?)", params: [new Date().toISOString()] },
      { sql: 'DELETE FROM embeddings WHERE key NOT IN (SELECT value FROM json_each(?))', params: [JSON.stringify(liveKeys)] },
    ]);
    return { unchanged: false, generated, version, documents: snapshot.documents.length, chunks: chunks.length };
  } finally {
    await api.sql([{ sql: "DELETE FROM meta WHERE key='lock' AND json_extract(value,'$.owner')=?", params: [owner] }]);
  }
}
