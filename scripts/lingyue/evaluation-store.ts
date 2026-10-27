import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Query } from '../../src/server/lingyue/database.js';
import { Store } from '../../src/server/lingyue/store.js';
import { terms } from '../../src/server/lingyue/text.js';
import type { Chunk } from '../../src/server/lingyue/types.js';
import { cacheKey } from './prepared.js';

/** Ephemeral PostgreSQL/pgvector; evaluation can never connect to the production database. */
export async function evaluationStore(chunks: Chunk[], vectors: Record<string, number[]>) {
  const pg = new PGlite({ extensions: { vector } });
  await pg.exec(`CREATE EXTENSION vector; CREATE SCHEMA lingyue;
    CREATE TABLE lingyue.control(id int,active_version text);
    INSERT INTO lingyue.control VALUES(1,'evaluation');
    CREATE TABLE lingyue.withdrawals(document_id text PRIMARY KEY);
    CREATE TABLE lingyue.chunks(version text,id text,document_id text,ordinal int,data jsonb,
      embedding vector(1024),title_terms text[],tag_terms text[],body_terms text[]);`);
  for (let i = 0; i < chunks.length; i += 32) {
    const rows = chunks.slice(i, i + 32).map((chunk) => {
      const embedding = vectors[cacheKey(chunk.hash)];
      if (!embedding || embedding.length !== 1024) throw new Error('Evaluation vectors missing');
      return {
        id: chunk.id,
        document_id: chunk.documentId,
        ordinal: chunk.ordinal,
        data: chunk,
        embedding: JSON.stringify(embedding),
        title_terms: terms(chunk.title),
        tag_terms: terms(chunk.tags.join(' ')),
        body_terms: terms(`${chunk.heading} ${chunk.text}`),
      };
    });
    await pg.query(
      `INSERT INTO lingyue.chunks SELECT 'evaluation',id,document_id,ordinal,data,embedding::vector,title_terms,tag_terms,body_terms
      FROM jsonb_to_recordset($1::jsonb) AS x(id text,document_id text,ordinal int,data jsonb,embedding text,title_terms text[],tag_terms text[],body_terms text[])`,
      [JSON.stringify(rows)],
    );
  }
  const query: Query = {
    async query<T extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      return (await pg.query<T>(sql, values)).rows;
    },
  };
  return { store: new Store(query), close: () => pg.close() };
}
