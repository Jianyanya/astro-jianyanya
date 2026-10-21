import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { Providers } from '../src/providers.js';

test('default provider fetch preserves the Worker global receiver', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = function (this: unknown) {
      assert.equal(this, globalThis);
      return Promise.resolve(new Response('data: {"choices":[{"delta":{"content":"你好喵~"}}]}\n\ndata: [DONE]\n\n'));
    };
    const providers = new Providers(
      loadConfig({ COOKIE_SECRET: 'test-secret-long-enough-for-runtime', DEEPSEEK_API_KEY: 'test-only' }),
    );
    let text = '';
    await providers.chat(
      [{ role: 'user', content: '你好' }],
      new AbortController().signal,
      (delta) => {
        text += delta;
      },
      () => {},
    );
    assert.equal(text, '你好喵~');
  } finally {
    globalThis.fetch = original;
  }
});
