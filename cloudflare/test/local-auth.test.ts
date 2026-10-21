import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localSettings, parseAuth } from '../scripts/local-auth.js';

const config = {
  account_id: 'a'.repeat(32),
  d1_databases: [{ binding: 'DB', database_id: '11111111-1111-4111-8111-111111111111' }],
  vectorize: [{ binding: 'VECTORS', index_name: 'knowledge' }],
};

test('local synchronization resolves existing bindings without a CI token or chat key', () => {
  const value = localSettings(config, ' embedding-test-only ');
  assert.equal(value.database, config.d1_databases[0]?.database_id);
  assert.equal(value.index, 'knowledge');
  assert.equal(value.embeddingKey, 'embedding-test-only');
  assert.throws(() => localSettings({ ...config, d1_databases: [] }, 'test-only'));
  assert.throws(() => localSettings(config, undefined));
});

test('Wrangler auth parsing never includes credential values in errors', () => {
  assert.equal(parseAuth('{"type":"oauth","token":"test-only"}'), 'test-only');
  for (const output of ['sensitive-test-only', '{"token":{"secret":"sensitive-test-only"}}', '{}']) {
    assert.throws(
      () => parseAuth(output),
      (error: unknown) => error instanceof Error && !error.message.includes('sensitive-test-only'),
    );
  }
});
