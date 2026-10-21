import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { Providers } from '../src/providers.js';
import type { Usage } from '../src/types.js';

const common = { COOKIE_SECRET: 'test-only-secret-long-enough-to-validate' };
test('Discovery uses its own explicit key and normalizes trailing slashes', () => {
  const config = loadConfig({
    ...common,
    CHAT_BASE_URL: 'https://discovery-api.intern-ai.org.cn/v1/',
    CHAT_MODEL: 'deepseek-v4.1-flash-1017',
    CHAT_API_KEY: 'discovery-test-only',
    DEEPSEEK_API_KEY: 'legacy-test-only',
  });
  assert.equal(config.CHAT_BASE_URL, 'https://discovery-api.intern-ai.org.cn/v1');
  assert.equal(config.CHAT_API_KEY, 'discovery-test-only');
  const missing = loadConfig({ ...common, CHAT_BASE_URL: config.CHAT_BASE_URL, DEEPSEEK_API_KEY: 'legacy-test-only' });
  assert.equal(missing.CHAT_API_KEY, '');
});
test('legacy DeepSeek configuration remains compatible without allowing arbitrary upstream hosts', () => {
  assert.equal(loadConfig({ ...common, DEEPSEEK_API_KEY: 'legacy-test-only' }).CHAT_API_KEY, 'legacy-test-only');
  assert.throws(() => loadConfig({ ...common, CHAT_BASE_URL: 'https://untrusted.example/v1' }));
});

test('Discovery streaming sends the new credential and reports usage', async () => {
  const config = loadConfig({
    ...common,
    CHAT_BASE_URL: 'https://discovery-api.intern-ai.org.cn/v1',
    CHAT_MODEL: 'deepseek-v4.1-flash-1017',
    CHAT_API_KEY: 'discovery-test-only',
    DEEPSEEK_API_KEY: 'legacy-test-only',
  });
  const providers = new Providers(config, (async (url, init) => {
    assert.equal(url, 'https://discovery-api.intern-ai.org.cn/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer discovery-test-only');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, config.CHAT_MODEL);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    return new Response(
      'data: {"choices":[{"delta":{"content":"你好喵~"}}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\ndata: [DONE]\n\n',
    );
  }) as typeof fetch);
  let text = '';
  let usage: Usage | undefined;
  await providers.chat(
    [{ role: 'user', content: '你好' }],
    new AbortController().signal,
    (v) => {
      text += v;
    },
    (v) => {
      usage = v;
    },
  );
  assert.equal(text, '你好喵~');
  assert.deepEqual(usage, { prompt_tokens: 10, completion_tokens: 3 });
});
