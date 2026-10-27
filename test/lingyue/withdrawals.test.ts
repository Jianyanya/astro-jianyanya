import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { chunkDocument } from '../../scripts/lingyue/markdown.js';
import { cacheKey } from '../../scripts/lingyue/prepared.js';
import { activate, stage } from '../../scripts/lingyue/publish.js';
import { beginPublication, withdrawDocument } from '../../scripts/lingyue/withdrawals.js';
import { Providers } from '../../src/server/lingyue/providers.js';
import { Retrieval } from '../../src/server/lingyue/retrieval.js';
import { Store } from '../../src/server/lingyue/store.js';
import { createTestDatabase, testConfig } from './database-fixture.js';

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
function prepared(ids = ['keep', 'remove']) {
  const snapshot = {
    schema: 1 as const,
    documents: ids.map((id) => ({
      id,
      title: id,
      url: `/post/${id}`,
      locale: 'zh',
      tags: [],
      body: `## 事实\n${id} 的向量知识。`,
    })),
  };
  return {
    snapshot,
    vectors: Object.fromEntries(snapshot.documents.flatMap(chunkDocument).map((chunk) => [cacheKey(chunk.hash), vector])),
  };
}
before(async () => {
  fixture = await createTestDatabase();
});
beforeEach(() => fixture.reset());
after(() => fixture.close());

test('local generation has no side effects; publication withdrawal survives a subsequent failed rebuild', async () => {
  const { db } = fixture;
  const old = await stage(db, prepared());
  await activate(db, old.version, null);
  const store = new Store(db);
  const next = prepared(['keep']); // Local preparation is pure.
  assert.equal((await store.chunks(old.version, undefined, 'remove')).length, 1);
  const receipt = await beginPublication(db, next.snapshot);
  assert.equal(receipt.withdrawn, 1);
  await assert.rejects(stage(db, { ...next, vectors: {} }));
  assert.equal(await store.version(), old.version);
  assert.deepEqual(await store.chunks(old.version, undefined, 'remove'), []);
  assert.deepEqual(await store.keyword(old.version, '向量', 'remove'), []);
  assert.deepEqual(await store.vector(old.version, vector, 'remove'), []);
  assert.equal((await store.vector(old.version, vector)).length, 1);
  assert.equal((await store.allowed(['keep', 'remove'])).has('remove'), false);
});

test('a manual withdrawal invalidates older activation receipts, including retries of the same active version', async () => {
  const { db } = fixture;
  const artifact = prepared();
  const version = (await stage(db, artifact)).version;
  const receipt = await beginPublication(db, artifact.snapshot);
  await activate(db, version, receipt.previousVersion, new Date(), receipt.sequence);
  await activate(db, version, receipt.previousVersion, new Date(), receipt.sequence); // idempotent
  await withdrawDocument(db, 'remove');
  await assert.rejects(activate(db, version, receipt.previousVersion, new Date(), receipt.sequence), /superseded/);
  assert.deepEqual(await new Store(db).chunks(version, undefined, 'remove'), []);
});

test('re-added articles stay withdrawn until the complete new version activates; older publishers cannot restore them', async () => {
  const { db } = fixture;
  const a = prepared();
  const v = (await stage(db, a)).version;
  await activate(db, v, null);
  const deleting = await beginPublication(db, prepared(['keep']).snapshot);
  const restoring = await beginPublication(db, a.snapshot);
  await stage(db, a);
  assert.deepEqual(await new Store(db).chunks(v, undefined, 'remove'), []);
  await assert.rejects(activate(db, v, deleting.previousVersion, new Date(), deleting.sequence), /superseded/);
  await activate(db, v, restoring.previousVersion, new Date(), restoring.sequence);
  assert.equal((await new Store(db).chunks(v, undefined, 'remove')).length, 1);
});

test('empty publication withdraws all active articles before activation and later permits an empty index', async () => {
  const { db } = fixture;
  const old = await stage(db, prepared());
  await activate(db, old.version, null);
  const empty = prepared([]);
  const receipt = await beginPublication(db, empty.snapshot);
  assert.equal(receipt.withdrawn, 2);
  assert.deepEqual(await new Store(db).vector(old.version, vector), []);
  const next = await stage(db, empty);
  await activate(db, next.version, old.version, new Date(), receipt.sequence);
  assert.equal(await new Store(db).version(), next.version);
});

test('an article withdrawn during slow reranking is removed before evidence is returned', async () => {
  const { db } = fixture;
  const old = await stage(db, prepared());
  await activate(db, old.version, null);
  const c = { ...testConfig, SILICONFLOW_API_KEY: 'fictional-key' };
  const providers = new Providers(c, (async (url, options) => {
    if (String(url).endsWith('/embeddings')) return Response.json({ data: [{ index: 0, embedding: vector }] });
    await withdrawDocument(db, 'remove');
    const { documents } = JSON.parse(String(options?.body)) as { documents: string[] };
    return Response.json({ results: documents.map((_, index) => ({ index, relevance_score: 0.9 })) });
  }) as typeof fetch);
  const retrieval = new Retrieval(new Store(db), providers, c);
  const result = await retrieval.find(
    { message: '如何查询向量知识', history: [], requestId: 'test' },
    AbortSignal.timeout(5000),
  );
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0]!.documentId, 'keep');
});
