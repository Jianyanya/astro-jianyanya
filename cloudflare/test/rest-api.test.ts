import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { CloudflareApi, restSql } from '../scripts/api.js';

test('REST batches serialize into a SQL object and preserve hostile strings as literal data', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sample(value TEXT)');
  try {
    const payload = "中文'); DROP TABLE sample; --\n?\u0000tail";
    db.exec(restSql({ sql: 'INSERT INTO sample VALUES (?)', params: [payload] }));
    assert.equal(db.prepare('SELECT value FROM sample').get()?.value, payload);
    assert.throws(() => restSql({ sql: 'SELECT ?', params: [] }));
    const api = new CloudflareApi('account', 'test-only', 'database', 'index', (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(Array.isArray(body), false);
      assert.equal(typeof body.sql, 'string');
      assert.match(body.sql, /SELECT 1;\nSELECT 2/);
      assert.equal(body.params, undefined);
      return Response.json({
        success: true,
        result: [
          { success: true, results: [] },
          { success: true, results: [] },
        ],
      });
    }) as typeof fetch);
    await api.sql([
      { sql: 'SELECT ?', params: [1] },
      { sql: 'SELECT ?', params: [2] },
    ]);
  } finally {
    db.close();
  }
});
