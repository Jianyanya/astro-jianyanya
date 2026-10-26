import { Pool, type PoolClient } from 'pg';

export interface Query {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<T[]>;
}
export interface Database extends Query {
  transaction<T>(action: (query: Query) => Promise<T>): Promise<T>;
}

const wrap = (client: Pool | PoolClient): Query => ({
  async query<T extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
    return (await client.query<T>(sql, values)).rows;
  },
});

export function database(connectionString: string): Database & { close(): Promise<void> } {
  if (!connectionString) throw new Error('Database connection is not configured');
  const url = new URL(connectionString);
  if (url.hostname.endsWith('.neon.tech')) url.searchParams.set('sslmode', 'verify-full');
  const pool = new Pool({
    connectionString: url.toString(),
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
    allowExitOnIdle: true,
  });
  return {
    ...wrap(pool),
    async transaction<T>(action: (query: Query) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await action(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
