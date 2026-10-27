import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { loadConfig } from '../../src/server/lingyue/config.js';
import type { Database, Query } from '../../src/server/lingyue/database.js';

export const testConfig = loadConfig({
  COOKIE_SECRET: 'fictional-cookie-secret-at-least-32-characters',
  CHAT_API_KEY: 'test-only',
  GITHUB_CLIENT_ID: 'fictional-client',
  GITHUB_CLIENT_SECRET: 'fictional-secret',
});
export async function createTestDatabase() {
  const pg = new PGlite({ extensions: { vector } });
  const migrations = new URL('../../migrations/lingyue/', import.meta.url);
  for (const file of (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort())
    await pg.exec(await readFile(new URL(file, migrations), 'utf8'));
  const wrap = (client: Pick<PGlite, 'query'>): Query => ({
    async query<T extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      return (await client.query<T>(sql, values)).rows;
    },
  });
  const db: Database = { ...wrap(pg), transaction: (action) => pg.transaction((tx) => action(wrap(tx))) };
  return {
    db,
    close: () => pg.close(),
    reset: () =>
      pg.exec(
        'UPDATE lingyue.control SET active_version=NULL; DELETE FROM lingyue.chunks; DELETE FROM lingyue.versions; DELETE FROM lingyue.embeddings; DELETE FROM lingyue.requests; DELETE FROM lingyue.auth_sessions; UPDATE lingyue.quota_lock SET cooldown_until=0,next_start=0;',
      ),
  };
}
