import { terms } from './text.js';
import type { Chunk } from './types.js';

export class Store {
  constructor(readonly db: D1Database) {}
  async version() {
    return (await this.db.prepare("SELECT value FROM meta WHERE key='activeVersion'").first<{ value: string }>())?.value;
  }
  async chunks(version: string, ids?: string[], documentId?: string): Promise<Chunk[]> {
    if (ids?.length === 0) return [];
    const where = ids ? ` AND c.id IN (${ids.map(() => '?').join(',')})` : ' AND c.document_id=?';
    const result = await this.db
      .prepare(`SELECT c.data FROM chunks c JOIN allowed a ON c.document_id=a.id
      WHERE c.version=?${where} ORDER BY c.ordinal`)
      .bind(version, ...(ids ?? [documentId ?? '']))
      .all<{ data: string }>();
    return result.results.map((r) => JSON.parse(r.data) as Chunk);
  }
  async keyword(version: string, query: string, documentId?: string) {
    const match = terms(query)
      .slice(0, 80)
      .map((w) => `"${w.replaceAll('"', '""')}"`)
      .join(' OR ');
    if (!match) return [];
    const result = await this.db
      .prepare(`SELECT s.id FROM search s JOIN chunks c ON c.version=s.version AND c.id=s.id
      JOIN allowed a ON a.id=c.document_id WHERE search MATCH ? AND s.version=?
      ${documentId ? 'AND c.document_id=?' : ''} ORDER BY bm25(search,0,0,4,2,1) LIMIT 20`)
      .bind(match, version, ...(documentId ? [documentId] : []))
      .all<{ id: string }>();
    return result.results.map((r) => r.id);
  }
}
