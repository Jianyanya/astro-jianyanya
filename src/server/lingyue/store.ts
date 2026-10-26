import type { Query } from './database.js';
import { terms } from './text.js';
import type { Chunk } from './types.js';

export class Store {
  constructor(readonly db: Query) {}
  async version() {
    return (
      (await this.db.query<{ active_version: string | null }>('SELECT active_version FROM lingyue.control WHERE id=1'))[0]
        ?.active_version ?? undefined
    );
  }
  async chunks(version: string, ids?: string[], documentId?: string): Promise<Chunk[]> {
    if (ids?.length === 0) return [];
    const rows = await this.db.query<{ data: Chunk }>(
      `SELECT data FROM lingyue.chunks WHERE version=$1
       AND ${ids ? 'id=ANY($2::text[])' : 'document_id=$2'} ORDER BY ordinal`,
      [version, ids ?? documentId ?? ''],
    );
    return rows.map((row) => row.data);
  }
  async vector(version: string, values: number[], documentId?: string): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM lingyue.chunks WHERE version=$1 AND ($3::text IS NULL OR document_id=$3)
       ORDER BY embedding <=> $2::vector, id LIMIT 40`,
      [version, JSON.stringify(values), documentId ?? null],
    );
    return rows.map((row) => row.id);
  }
  async keyword(version: string, query: string, documentId?: string): Promise<string[]> {
    const words = terms(query).slice(0, 80);
    if (!words.length) return [];
    // Preserve Chinese segmentation and title/tag weights without requiring a hosted BM25 extension.
    // This is weighted term overlap, not SQLite FTS5 BM25; compare it in migration acceptance.
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM lingyue.chunks c
       CROSS JOIN LATERAL (
         SELECT sum(CASE WHEN term=ANY(c.title_terms) THEN 4 ELSE 0 END
                   +CASE WHEN term=ANY(c.tag_terms) THEN 2 ELSE 0 END
                   +CASE WHEN term=ANY(c.body_terms) THEN 1 ELSE 0 END) AS score
         FROM unnest($2::text[]) AS term
       ) ranked
       WHERE version=$1 AND ($3::text IS NULL OR document_id=$3) AND ranked.score>0
       ORDER BY ranked.score DESC, id LIMIT 20`,
      [version, words, documentId ?? null],
    );
    return rows.map((row) => row.id);
  }
}
