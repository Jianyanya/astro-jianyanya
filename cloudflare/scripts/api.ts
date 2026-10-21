export interface Statement {
  sql: string;
  params?: unknown[];
}

/** REST D1 accepts one SQL object, unlike the Worker binding's batch API. */
export function restSql(statement: Statement): string {
  let index = 0;
  const sql = statement.sql.replace(/\?/g, () => {
    const value = statement.params?.[index++];
    if (value === null) return 'NULL';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string') return `CAST(X'${Buffer.from(value).toString('hex')}' AS TEXT)`;
    throw new Error('Unsupported SQL binding');
  });
  if (index !== (statement.params?.length ?? 0)) throw new Error('SQL binding count mismatch');
  return sql;
}

/** Build/CI only. Credentials never reach the Worker request or browser bundle. */
export class CloudflareApi {
  constructor(
    readonly account: string,
    readonly token: string,
    readonly database: string,
    readonly index: string,
    readonly request: typeof fetch = fetch,
  ) {}
  async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        response = await this.request(`https://api.cloudflare.com/client/v4/accounts/${this.account}/${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${this.token}`, ...init.headers },
          signal: AbortSignal.timeout(60000),
        });
        if (response.status !== 429 && response.status < 500) break;
        await response.body?.cancel();
        response = undefined;
      } catch {
        response = undefined;
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
    if (!response) throw new Error('Cloudflare request failed after retries');
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Cloudflare request failed (${response.status})`);
    }
    const value = (await response.json()) as { success: boolean; result: T };
    if (!value.success) throw new Error('Cloudflare operation failed');
    return value.result;
  }
  async sql<T = Record<string, unknown>>(statements: Statement[]): Promise<Array<{ results: T[] }>> {
    const result = await this.call<Array<{ results: T[]; success: boolean }>>(`d1/database/${this.database}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: statements.map(restSql).join(';\n') }),
    });
    if (result.length !== statements.length || result.some((r) => !r.success)) throw new Error('D1 batch failed');
    return result;
  }
  async upsert(vectors: unknown[]) {
    const form = new FormData();
    form.append(
      'vectors',
      new Blob([vectors.map((v) => JSON.stringify(v)).join('\n') + '\n'], { type: 'application/x-ndjson' }),
      'vectors.ndjson',
    );
    return this.call<{ mutationId: string }>(`vectorize/v2/indexes/${this.index}/upsert`, { method: 'POST', body: form });
  }
  async remove(ids: string[]) {
    return this.call<{ mutationId: string }>(`vectorize/v2/indexes/${this.index}/delete_by_ids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  }
  async wait(mutationId: string) {
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      const info = await this.call<{ processedUpToMutation?: string }>(`vectorize/v2/indexes/${this.index}/info`);
      if (info.processedUpToMutation === mutationId) return;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error('Vector mutation has not become queryable; index was not published');
  }
}
