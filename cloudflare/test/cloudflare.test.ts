import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { CloudflareApi, Statement } from '../scripts/api.js';
import { publishSnapshot } from '../scripts/publish.js';
import { loadConfig } from '../src/config.js';
import type { Env } from '../src/env.js';
import { Ledger } from '../src/ledger.js';
import { identity } from '../src/limits.js';
import type { Providers } from '../src/providers.js';
import { Retrieval } from '../src/retrieval.js';
import { Store } from '../src/store.js';
import { VECTOR_NAMESPACE } from '../src/text.js';
import worker, { readBody } from '../src/worker.js';

const config = loadConfig({ COOKIE_SECRET: 'test-secret-for-cookie-and-ledger-32-chars' });
function sqlStorage(db: DatabaseSync): SqlStorage {
  return {
    exec(query: string, ...params: Array<string | number | null>) {
      const rows = db.prepare(query).all(...params);
      return { toArray: () => rows };
    },
  } as unknown as SqlStorage;
}
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_knowledge.sql', import.meta.url), 'utf8'));
  let embeddings = 0;
  let uploads = 0;
  let fail = false;
  const providers = {
    async embed(input: string[]) {
      if (fail) throw new Error('Embedding unavailable');
      embeddings += input.length;
      return input.map(() => Array.from({ length: 1024 }, () => 0.1));
    },
    async rerank(_query: string, documents: string[]) {
      return documents.map((_, i) => i);
    },
  } as unknown as Providers;
  const vectors = new Map<string, { namespace: string; metadata: { chunk: string } }>();
  const api = {
    async sql(statements: Statement[]) {
      db.exec('BEGIN');
      try {
        const results = statements.map(({ sql, params = [] }) => ({
          results: db.prepare(sql).all(...(params as Array<string | number | null>)),
        }));
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    async upsert(values: Array<{ id: string; namespace: string; metadata: { chunk: string } }>) {
      uploads += values.length;
      for (const v of values) vectors.set(v.id, v);
      return { mutationId: 'mutation' };
    },
    async remove(ids: string[]) {
      for (const id of ids) vectors.delete(id);
      return { mutationId: 'mutation' };
    },
    async wait() {},
  } as unknown as CloudflareApi;
  const d1 = {
    prepare(query: string) {
      let params: Array<string | number | null> = [];
      const stmt = {
        bind(...values: typeof params) {
          params = values;
          return stmt;
        },
        async first() {
          return db.prepare(query).get(...params) ?? null;
        },
        async all() {
          return { results: db.prepare(query).all(...params) };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return {
    db,
    api,
    providers,
    d1,
    vectors,
    count: () => embeddings,
    uploads: () => uploads,
    fail: () => {
      fail = true;
    },
  };
}
const snapshot = (text = '向量数据库通过语义相似度检索。', second = true) => ({
  schema: 1,
  documents: [
    { id: 'rag', title: 'RAG检索', body: `## 原理\n${text}`, url: '/post/rag', locale: 'zh', tags: ['RAG'] },
    ...(second
      ? [
          {
            id: 'code',
            title: '代码示例',
            body: '## TypeScript\n```ts\nconst example = 1;\n```',
            url: '/post/code',
            locale: 'zh',
            tags: [],
          },
        ]
      : []),
  ],
});

test('incremental publishing reuses embeddings, skips unchanged snapshots and cleans previous versions', async () => {
  const s = setup();
  try {
    const first = await publishSnapshot(snapshot(), s.api, s.providers);
    assert.equal(first.generated, 2);
    assert.equal((await publishSnapshot(snapshot(), s.api, s.providers)).unchanged, true);
    assert.equal(s.uploads(), 2);
    await publishSnapshot(snapshot('修改后的向量检索内容。'), s.api, s.providers);
    assert.equal(s.count(), 3);
    assert.equal(s.uploads(), 3);
    await publishSnapshot(snapshot('再修改一次。', false), s.api, s.providers);
    assert.equal(s.count(), 4);
    assert.equal(s.uploads(), 4);
    assert.ok(s.vectors.size <= 3);
    assert.deepEqual(
      s.db
        .prepare('SELECT id FROM allowed')
        .all()
        .map((r) => r.id),
      ['rag'],
    );
  } finally {
    s.db.close();
  }
});

test('failed update preserves active index and immediately withdraws deleted/private documents', async () => {
  const s = setup();
  try {
    const first = await publishSnapshot(snapshot(), s.api, s.providers);
    s.fail();
    await assert.rejects(publishSnapshot(snapshot('new content', false), s.api, s.providers));
    const store = new Store(s.d1);
    assert.equal(await store.version(), first.version);
    assert.equal((await store.chunks(first.version, undefined, 'code')).length, 0);
    assert.equal((await store.chunks(first.version, undefined, 'rag')).length, 1);
  } finally {
    s.db.close();
  }
});

test('an interrupted asynchronous publication resumes without re-embedding or duplicate FTS rows', async () => {
  const s = setup();
  const wait = s.api.wait;
  try {
    s.api.wait = async () => {
      throw new Error('Index not ready yet');
    };
    await assert.rejects(publishSnapshot(snapshot(), s.api, s.providers));
    assert.equal(s.count(), 2);
    s.api.wait = wait;
    const result = await publishSnapshot(snapshot(), s.api, s.providers);
    assert.equal(result.generated, 0);
    assert.equal(result.chunks, 2);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM search').get()?.n, 2);
  } finally {
    s.db.close();
  }
});

test('hybrid retrieval uses Vectorize namespaces, FTS5 and current-article filtering', async () => {
  const s = setup();
  try {
    await publishSnapshot(snapshot(), s.api, s.providers);
    const vectors = {
      async query(_vector: number[], options: { namespace: string }) {
        assert.equal(options.namespace, VECTOR_NAMESPACE);
        return {
          matches: [...s.vectors.values()]
            .filter((v) => v.namespace === VECTOR_NAMESPACE)
            .map((v) => ({ metadata: v.metadata })),
        };
      },
    } as unknown as VectorizeIndex;
    const retrieval = new Retrieval(new Store(s.d1), s.providers, vectors, config);
    const found = await retrieval.find(
      { message: '向量数据库怎么检索', history: [], requestId: crypto.randomUUID() },
      new AbortController().signal,
    );
    assert.equal(found.sources[0]?.url, '/post/rag');
    assert.deepEqual(found.degraded, []);
    const social = await retrieval.find(
      { message: '小宝贝', history: [], requestId: crypto.randomUUID() },
      new AbortController().signal,
    );
    assert.deepEqual(social.sources, []);
  } finally {
    s.db.close();
  }
});

test('ledger persists concurrency, deduplication, conservative charges and expiry across instances', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const sql = sqlStorage(db);
    const ledger = new Ledger(sql, { ...config, DAILY_GLOBAL_LIMIT: 3 });
    const now = Date.parse('2026-10-21T12:00:00+08:00');
    ledger.reserve('1', 'visitor', 'ip', now);
    assert.throws(() => new Ledger(sql, config).reserve('2', 'visitor', 'ip', now));
    assert.throws(() => ledger.reserve('1', 'other', 'ip', now));
    ledger.settle('1', true);
    assert.ok(ledger.quota('visitor', 'ip', now).cost > 0);
    ledger.settle('1', false);
    assert.equal(ledger.quota('visitor', 'ip', now).total, 1);
    ledger.reserve('2', 'visitor', 'ip', now);
    ledger.reserve('3', 'visitor', 'ip', now + 121000);
    assert.throws(() => ledger.reserve('4', 'other', 'other', now + 121000));
    ledger.settle('3', false);
    assert.equal(ledger.quota('visitor', 'ip', now + 121000).remaining, 1);
  } finally {
    db.close();
  }
});

test('signed visitor cookies reject forged identities', () => {
  const first = identity(undefined, config.COOKIE_SECRET);
  assert.equal(identity(first.cookie, config.COOKIE_SECRET).visitor, first.visitor);
  assert.notEqual(
    identity(first.cookie.replace(first.visitor, crypto.randomUUID()), config.COOKIE_SECRET).visitor,
    first.visitor,
  );
});

test('monthly budget rejects reservations atomically and settles only once', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const ledger = new Ledger(sqlStorage(db), { ...config, MONTHLY_BUDGET_CNY: 0.04 });
    ledger.reserve('first', 'v', 'ip');
    assert.throws(() => ledger.reserve('second', 'other', 'other'));
    ledger.settle('first', true, { prompt_tokens: 100, completion_tokens: 10 });
    const cost = ledger.quota('v', 'ip').cost;
    ledger.settle('first', true, { prompt_tokens: 9999, completion_tokens: 9999 });
    assert.equal(ledger.quota('v', 'ip').cost, cost);
    ledger.reserve('second', 'other', 'other');
  } finally {
    db.close();
  }
});

test('client stream cancellation aborts upstream and retains uncertain-call reservation', async () => {
  const originalFetch = globalThis.fetch;
  const tasks: Promise<unknown>[] = [];
  let called = false;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let aborted = false;
  try {
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        started();
        init?.signal?.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new Error('cancelled'));
          },
          { once: true },
        );
      })) as typeof fetch;
    const env = {
      COOKIE_SECRET: config.COOKIE_SECRET,
      DEEPSEEK_API_KEY: 'test-only',
      QUOTAS: {
        idFromName() {},
        get() {
          return {
            async fetch(_url: string, init: RequestInit) {
              const value = JSON.parse(String(init.body));
              if (value.action === 'settle') called = value.called;
              return Response.json({ remaining: 29, available: true, resetsAt: '' });
            },
          };
        },
      },
    } as unknown as Env;
    const response = await worker.fetch(
      new Request('https://belluna.love/api/lingyue/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: '在吗', requestId: crypto.randomUUID() }),
      }),
      env,
      {
        waitUntil(task: Promise<unknown>) {
          tasks.push(task);
        },
      } as unknown as ExecutionContext,
    );
    await ready;
    await response.body?.cancel();
    await Promise.all(tasks);
    assert.equal(aborted, true);
    assert.equal(called, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('request boundary enforces byte limits even without Content-Length', async () => {
  await assert.rejects(
    readBody(
      new Request('https://belluna.love/api/lingyue/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '中'.repeat(17000),
      }),
    ),
    /内容有点多/,
  );
});

test('Worker rejects cross-site and malformed chat requests before quotas or upstream calls', async () => {
  const env = {
    COOKIE_SECRET: config.COOKIE_SECRET,
    DEEPSEEK_API_KEY: 'test-only',
    SITE_ORIGIN: 'https://belluna.love',
  } as Env;
  const ctx = { waitUntil() {} } as unknown as ExecutionContext;
  const response = await worker.fetch(
    new Request('https://belluna.love/api/lingyue/chat', {
      method: 'POST',
      headers: { origin: 'https://other.example' },
    }),
    env,
    ctx,
  );
  assert.equal(response.status, 403);
  const bad = await worker.fetch(
    new Request('https://belluna.love/api/lingyue/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    {
      ...env,
      QUOTAS: {
        idFromName() {},
        get() {
          return {};
        },
      } as unknown as DurableObjectNamespace,
    },
    ctx,
  );
  assert.equal(bad.status, 400);
});

test('Worker streams model replies and citations, settles budget, and rejects a repeated request', async () => {
  const s = setup();
  const quotaDb = new DatabaseSync(':memory:');
  const originalFetch = globalThis.fetch;
  const tasks: Promise<unknown>[] = [];
  try {
    await publishSnapshot(snapshot(), s.api, s.providers);
    const ledger = new Ledger(sqlStorage(quotaDb), config);
    const quota = {
      async fetch(_url: string, init: RequestInit) {
        const v = JSON.parse(String(init.body));
        try {
          if (v.action === 'reserve') ledger.reserve(v.id, v.visitor, v.ip);
          if (v.action === 'settle') ledger.settle(v.id, v.called, v.usage);
          return Response.json(ledger.quota(v.visitor, v.ip));
        } catch {
          return Response.json({ message: 'duplicate' }, { status: 409 });
        }
      },
    };
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      if (url.endsWith('/embeddings')) return Response.json({ data: [{ index: 0, embedding: Array(1024).fill(0.1) }] });
      if (url.endsWith('/rerank')) {
        const payload = JSON.parse(String(init.body));
        return Response.json({ results: payload.documents.map((_: string, index: number) => ({ index, relevance_score: 1 })) });
      }
      assert.equal(url, 'https://api.deepseek.com/v1/chat/completions');
      const payload = JSON.parse(String(init.body));
      assert.equal(payload.model, 'deepseek-flash');
      assert.equal(payload.thinking.type, 'disabled');
      return new Response(
        'data: ' +
          JSON.stringify({ choices: [{ delta: { content: '根据博客，向量用于语义检索[S1]喵~' } }] }) +
          '\n\ndata: ' +
          JSON.stringify({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 30 } }) +
          '\n\ndata: [DONE]\n\n',
      );
    }) as typeof fetch;
    const env = {
      DB: s.d1,
      VECTORS: {
        async query() {
          return { matches: [...s.vectors.values()].map((v) => ({ metadata: v.metadata })) };
        },
      },
      QUOTAS: {
        idFromName() {},
        get() {
          return quota;
        },
      },
      COOKIE_SECRET: config.COOKIE_SECRET,
      DEEPSEEK_API_KEY: 'test-only',
      SILICONFLOW_API_KEY: 'test-only',
    } as unknown as Env;
    const ctx = {
      waitUntil(task: Promise<unknown>) {
        tasks.push(task);
      },
    } as unknown as ExecutionContext;
    const id = crypto.randomUUID();
    const request = () =>
      new Request('https://belluna.love/api/lingyue/chat', {
        method: 'POST',
        headers: { origin: 'https://belluna.love', 'content-type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
        body: JSON.stringify({ message: '向量检索怎么做', history: [], requestId: id }),
      });
    const response = await worker.fetch(request(), env, ctx);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly.*Secure/);
    const text = await response.text();
    await Promise.all(tasks);
    assert.match(text, /event: delta/);
    assert.match(text, /event: sources/);
    assert.match(text, /\/post\/rag/);
    assert.match(text, /event: done/);
    assert.doesNotMatch(text, /test-only/);
    assert.equal(quotaDb.prepare('SELECT state FROM requests WHERE id=?').get(id)?.state, 'settled');
    assert.equal((await worker.fetch(request(), env, ctx)).status, 409);
  } finally {
    globalThis.fetch = originalFetch;
    s.db.close();
    quotaDb.close();
  }
});
