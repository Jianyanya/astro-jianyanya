import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { verifyDeployment } from '../../scripts/lingyue/deployment.js';
import { chunkDocument } from '../../scripts/lingyue/markdown.js';
import { cacheKey } from '../../scripts/lingyue/prepared.js';
import { activate, cleanup, stage } from '../../scripts/lingyue/publish.js';
import { Auth } from '../../src/server/lingyue/auth.js';
import type { Database } from '../../src/server/lingyue/database.js';
import { handleRequest, readBody } from '../../src/server/lingyue/handler.js';
import { Ledger } from '../../src/server/lingyue/ledger.js';
import { manifestOf, type Snapshot } from '../../src/server/lingyue/manifest.js';
import { Providers } from '../../src/server/lingyue/providers.js';
import { Retrieval } from '../../src/server/lingyue/retrieval.js';
import { Store } from '../../src/server/lingyue/store.js';
import { testConfig as c, createTestDatabase } from './database-fixture.js';

// Actual PostgreSQL + pgvector in WASM, not a SQL string mock. No network/model credentials used.
let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
const values = (i = 0) => Array.from({ length: 1024 }, (_, n) => (n === i ? 1 : 0));
function prepared(text = '向量数据库支持语义检索。', includeSecond = true) {
  const snapshot: Snapshot = {
    schema: 1,
    documents: [
      { id: 'rag', title: 'RAG 向量数据库', url: '/post/rag', locale: 'zh', tags: ['检索'], body: `## 原理\n${text}` },
      ...(includeSecond
        ? [{ id: 'other', title: '旅行记录', url: '/post/other', locale: 'zh', tags: [], body: '周末去公园散步。' }]
        : []),
    ],
  };
  const chunks = snapshot.documents.flatMap(chunkDocument);
  return {
    snapshot,
    vectors: Object.fromEntries(chunks.map((chunk) => [cacheKey(chunk.hash), values(chunk.documentId === 'rag' ? 0 : 1)])),
  };
}
before(async () => {
  fixture = await createTestDatabase();
  db = fixture.db;
});
beforeEach(async () => {
  await fixture.reset();
});
after(async () => {
  await fixture?.close();
});

test('staging does not activate; activation switches text and vectors together, repeated stage is idempotent', async () => {
  const artifact = prepared();
  const m = await stage(db, artifact);
  const store = new Store(db);
  assert.equal(await store.version(), undefined);
  await stage(db, artifact);
  assert.equal((await db.query('SELECT * FROM lingyue.chunks')).length, 2);
  await activate(db, m.version, null);
  assert.equal(await store.version(), m.version);
  assert.deepEqual(await store.vector(m.version, values(), 'rag'), [artifact.snapshot.documents.flatMap(chunkDocument)[0]!.id]);
  assert.equal((await store.keyword(m.version, '向量数据库'))[0], artifact.snapshot.documents.flatMap(chunkDocument)[0]!.id);
});

test('update/delete never leave stale candidates in current recall, even while old versions are retained', async () => {
  const old = await stage(db, prepared());
  await activate(db, old.version, null);
  const nextArtifact = prepared('更新后的向量检索正文。', false);
  const next = await stage(db, nextArtifact);
  const store = new Store(db);
  assert.equal((await store.chunks(old.version, undefined, 'other')).length, 1);
  await activate(db, next.version, old.version);
  assert.equal((await store.chunks(next.version, undefined, 'other')).length, 0);
  assert.deepEqual(
    await store.vector(next.version, values(1)),
    nextArtifact.snapshot.documents.flatMap(chunkDocument).map((chunk) => chunk.id),
  );
  assert.equal((await store.chunks(next.version, undefined, 'rag'))[0]!.text, '更新后的向量检索正文。');
  assert.equal((await db.query('SELECT * FROM lingyue.versions')).length, 2);
});

test('invalid/incomplete artifact cannot alter the live pointer or partially publish a version', async () => {
  const old = await stage(db, prepared());
  await activate(db, old.version, null);
  await assert.rejects(stage(db, { ...prepared('改动'), vectors: {} }));
  assert.equal(await new Store(db).version(), old.version);
  assert.equal((await db.query('SELECT * FROM lingyue.versions')).length, 1);
  await assert.rejects(activate(db, 'missing', old.version));
  assert.equal(await new Store(db).version(), old.version);
});

test('competing activation is rejected instead of overwriting a newer publication', async () => {
  const a = await stage(db, prepared());
  const b = await stage(db, prepared('新内容'));
  await activate(db, a.version, null);
  await assert.rejects(activate(db, b.version, null), /Another release/);
  assert.equal(await new Store(db).version(), a.version);
});

test('deleting all articles publishes a valid empty knowledge version; delete then re-add works', async () => {
  const a = await stage(db, prepared());
  await activate(db, a.version, null);
  const empty = await stage(db, { snapshot: { schema: 1, documents: [] }, vectors: {} });
  await activate(db, empty.version, a.version);
  assert.deepEqual(await new Store(db).vector(empty.version, values()), []);
  assert.deepEqual(await new Store(db).keyword(empty.version, '向量'), []);
  await activate(db, a.version, empty.version);
  assert.equal((await new Store(db).vector(a.version, values())).length, 2);
});

test('cleanup runs independently of content changes and protects a newly retired long-lived version', async () => {
  const old = await stage(db, prepared());
  await activate(db, old.version, null, new Date('2026-01-01'));
  await db.query("UPDATE lingyue.versions SET created_at='2026-01-01' WHERE id=$1", [old.version]);
  const next = await stage(db, prepared('新版'));
  const now = new Date();
  await activate(db, next.version, old.version, now);
  await cleanup(db, now);
  assert.equal((await db.query('SELECT * FROM lingyue.versions')).length, 2);
  await cleanup(db, new Date(now.getTime() + 8 * 86400000));
  await cleanup(db, new Date(now.getTime() + 8 * 86400000));
  assert.equal((await db.query('SELECT * FROM lingyue.versions')).length, 1);
  assert.equal(await new Store(db).version(), next.version);
});

test('deployment verification refuses stale fingerprints and redirects', async () => {
  const m = manifestOf(prepared().snapshot);
  const request = (async () => Response.json(m)) as typeof fetch;
  await verifyDeployment('https://example.com', m, request);
  await assert.rejects(verifyDeployment('https://example.com', { ...m, version: 'other' }, request));
  await assert.rejects(verifyDeployment('http://example.com', m, request));
});

test('quota reservations enforce shared limits, duplicate IDs and conservative cancellation accounting', async () => {
  const ledger = new Ledger(db, { ...c, DAILY_GLOBAL_LIMIT: 1 });
  const id = crypto.randomUUID();
  await ledger.reserve(id, 'visitor', 'ip');
  await assert.rejects(ledger.reserve(id, 'visitor', 'ip'), (e: unknown) => (e as { status: number }).status === 409);
  await assert.rejects(
    ledger.reserve(crypto.randomUUID(), 'other', 'ip2'),
    (e: unknown) => (e as { status: number }).status === 429,
  );
  await ledger.settle(id, true);
  await ledger.settle(id, false); // Late retries cannot refund a completed/unknown-usage call.
  assert.equal((await ledger.quota('visitor', 'ip')).remaining, 0);
  const [row] = await db.query<{ cost: number }>('SELECT cost FROM lingyue.requests WHERE id=$1', [id]);
  assert.ok(row!.cost > 0);
});

test('a pre-model failure refunds its reservation and permits a new request', async () => {
  const ledger = new Ledger(db, c);
  const id = crypto.randomUUID();
  await ledger.reserve(id, 'visitor', 'ip');
  await ledger.settle(id, false);
  assert.equal((await ledger.quota('visitor', 'ip')).remaining, 20);
  await ledger.reserve(crypto.randomUUID(), 'visitor', 'ip', Date.now() + 3000);
});

test('HTTP contract streams text and citations, settles quota and blocks cross-site requests', async () => {
  const m = await stage(db, prepared());
  await activate(db, m.version, null);
  const events =
    [
      { choices: [{ delta: { content: '资料写到语义检索 [S1]，我找到啦喵~' }, finish_reason: null }] },
      { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } },
    ]
      .map((v) => `data: ${JSON.stringify(v)}\n\n`)
      .join('') + 'data: [DONE]\n\n';
  const providers = new Providers(c, (async (url) => {
    if (String(url).endsWith('/embeddings')) return Response.json({ data: [{ index: 0, embedding: values() }] });
    if (String(url).endsWith('/rerank'))
      return Response.json({
        results: [
          { index: 0, relevance_score: 0.9 },
          { index: 1, relevance_score: 0.1 },
        ],
      });
    return new Response(events);
  }) as typeof fetch);
  const auth = new Auth(db, c);
  const cookie = (await auth.issue({ id: 12345, login: 'fictional-reader' })).split(';')[0]!;
  const runtime = { c, auth, providers, ledger: new Ledger(db, c), retrieval: new Retrieval(new Store(db), providers, c) };
  const request = (id: string) =>
    new Request('https://belluna.love/api/lingyue/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://belluna.love',
        'x-vercel-forwarded-for': '192.0.2.1',
        Cookie: cookie,
      },
      body: JSON.stringify({ message: '向量怎么检索', history: [], requestId: id }),
    });
  const id = crypto.randomUUID();
  const response = await handleRequest(request(id), runtime);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /event: delta/);
  assert.match(text, /event: sources/);
  assert.match(text, /event: done/);
  assert.doesNotMatch(text, /test-only/);
  assert.equal((await handleRequest(request(id), runtime)).status, 409);
  const crossSite = request(crypto.randomUUID());
  crossSite.headers.set('Origin', 'https://example.org');
  assert.equal((await handleRequest(crossSite, runtime)).status, 403);
});

test('request parser rejects oversized bodies before model invocation', async () => {
  await assert.rejects(
    readBody(
      new Request('https://example.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'x'.repeat(50000) }),
      }),
    ),
    (error: unknown) => (error as { status: number }).status === 413,
  );
});
