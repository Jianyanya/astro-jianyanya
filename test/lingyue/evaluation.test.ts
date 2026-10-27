import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metrics } from '../../scripts/lingyue/evaluation-metrics.js';

test('evidence metrics distinguish partial multi-fact recall from document hits and respect k', () => {
  const pool = [
    { documentId: 'a', text: '第一个事实。' },
    { documentId: 'noise', text: '第二个事实。' },
    { documentId: 'b', text: '第二个事实。' },
  ];
  const gold = [
    { documentId: 'a', quote: '第一个事实' },
    { documentId: 'b', quote: '第二个事实' },
  ];
  const at2 = metrics(pool, gold, 2, pool);
  assert.equal(at2.recall, 0.5);
  assert.equal(at2.mrr, 1);
  assert.ok(Math.abs(at2.ndcg - 1 / (1 + 1 / Math.log2(3))) < 1e-12);
  assert.equal(metrics(pool, gold, 3, pool).recall, 1);
  assert.equal(metrics([pool[1]!, pool[0]!], gold.slice(0, 1), 1, pool).mrr, 0);
});

test('heading evidence is visible to the model and formatting does not create false misses', () => {
  const result = metrics(
    [{ documentId: 'a', heading: '使用 QLoRA 微调', text: 'lr=5e-5' }],
    [{ documentId: 'a', quote: '使用 **QLoRA** 微调' }],
    6,
  );
  assert.deepEqual(result, { recall: 1, mrr: 1, ndcg: 1 });
});
