import type { Database } from '../../src/server/lingyue/database.js';
import { snapshotSchema } from '../../src/server/lingyue/manifest.js';

export interface Publication {
  sequence: string;
  previousVersion: string | null;
  withdrawn: number;
}

/** Publish intent is online; local editing/generation never calls this function. */
export async function beginPublication(db: Database, snapshot: unknown): Promise<Publication> {
  const ids = snapshotSchema.parse(snapshot).documents.map((document) => document.id);
  return db.transaction(async (tx) => {
    const [control] = await tx.query<{ active_version: string | null }>(
      'SELECT active_version FROM lingyue.control WHERE id=1 FOR UPDATE',
    );
    if (!control) throw new Error('Database is not initialized');
    const rows = await tx.query(
      `INSERT INTO lingyue.withdrawals(document_id,reason)
       SELECT DISTINCT document_id,'absent-from-public-snapshot' FROM lingyue.chunks
       WHERE version=$1 AND NOT(document_id=ANY($2::text[]))
       ON CONFLICT(document_id) DO UPDATE SET withdrawn_at=now(),reason=EXCLUDED.reason RETURNING document_id`,
      [control.active_version, ids],
    );
    const [next] = await tx.query<{ sequence: string }>(
      'UPDATE lingyue.control SET publication_seq=publication_seq+1 WHERE id=1 RETURNING publication_seq::text AS sequence',
    );
    return { sequence: next!.sequence, previousVersion: control.active_version, withdrawn: rows.length };
  });
}

/** Emergency withdrawal is independent of embeddings, deployment and the active version. */
export async function withdrawDocument(db: Database, id: string) {
  if (!id.trim() || id.length > 400) throw new Error('Invalid document ID');
  await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM lingyue.control WHERE id=1 FOR UPDATE');
    await tx.query('UPDATE lingyue.control SET publication_seq=publication_seq+1 WHERE id=1');
    await tx.query(
      `INSERT INTO lingyue.withdrawals(document_id,reason) VALUES($1,'manual')
      ON CONFLICT(document_id) DO UPDATE SET withdrawn_at=now(),reason=EXCLUDED.reason`,
      [id],
    );
  });
}
