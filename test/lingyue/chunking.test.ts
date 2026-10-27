import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { CHUNK_TOKENS, chunkDocument } from '../../scripts/lingyue/markdown.js';
import { fenced, splitText } from '../../scripts/lingyue/split-text.js';
import { messagesFor } from '../../src/server/lingyue/chat.js';
import { selectEvidence } from '../../src/server/lingyue/evidence.js';
import { embeddingText } from '../../src/server/lingyue/text.js';
import { chatTokens, embeddingTokens, ensureTokenizers, messageTokens } from '../../src/server/lingyue/tokenization.js';
import type { Document } from '../../src/server/lingyue/types.js';
import { testConfig } from './database-fixture.js';

const doc = (body: string): Document => ({
  id: 'test',
  title: '中文 TypeScript 笔记',
  url: '/post/test',
  locale: 'zh',
  tags: [],
  body,
});
before(() => ensureTokenizers('bge', 'chat'));

test('real token budgets include headings and preserve Unicode, sentences and literal code characters', () => {
  const sentence = '铃月在月光下研究 PostgreSQL，今天也要认真写代码喵。\n';
  const text = sentence.repeat(90) + '🐱𝄞结尾';
  const pieces = splitText(text, 100, embeddingTokens);
  assert.equal(pieces.join(''), text);
  assert.ok(pieces.every((part) => embeddingTokens(part) <= 100 && !/\p{Surrogate}/u.test(part)));
  const chunks = chunkDocument(doc(`## 检索\n${text}`));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => embeddingTokens(embeddingText(chunk)) <= CHUNK_TOKENS));
  assert.ok(chunks.every((chunk) => chunk.heading === '检索'));
  const code = 'const value = "' + '数字ABC🐱'.repeat(800) + '";';
  const blocks = chunkDocument(doc(`## 超长代码\n${fenced(code, 'ts')}`));
  assert.ok(blocks.every((chunk) => chunk.kind === 'code' && chunk.continuation));
  const recovered = blocks
    .map((chunk) => chunk.text.replace(/^代码分段（需结合原文上下文）：\n`+ts\n/, '').replace(/\n`+$/, ''))
    .join('');
  assert.equal(recovered, code, 'long code lines must not acquire artificial newlines');
  assert.ok(blocks.every((chunk) => chunk.embeddingTokens! <= CHUNK_TOKENS));
});

test('headings, list items and table headers survive; inline HTML is stripped but generic code is preserved', () => {
  const body = `# 数据\n## 表格\n| 名称 | 值 |\n|---|---|\n${Array.from({ length: 90 }, (_, i) => `| 行${i} | 这是第${i}行的重要数值 |`).join('\n')}\n## 列表\n${Array.from({ length: 80 }, (_, i) => `- 条目${i}：保留完整项目。`).join('\n')}\n## 类型\n文本 <b>加粗</b>，类型是 \`Array<T>\`。\n<script>alert('x')</script>`;
  const chunks = chunkDocument(doc(body));
  for (let i = 0; i < 90; i++) assert.ok(chunks.some((chunk) => chunk.text.includes(`| 行${i} |`)));
  for (const chunk of chunks.filter((item) => item.heading.endsWith('表格'))) assert.match(chunk.text, /\| 名称 \| 值 \|/);
  const content = chunks.map((chunk) => chunk.text).join('\n');
  assert.match(content, /`Array<T>`/);
  assert.doesNotMatch(content, /<b>|<script>|alert\('x'\)/);
  assert.ok(chunks.every((chunk) => chunk.embeddingTokens! <= CHUNK_TOKENS));
});

test('inserting an earlier section keeps unchanged chunk IDs stable', () => {
  const old = chunkDocument(doc('## 第一节\n保持原文。\n## 第二节\n这一节也保持。'));
  const fresh = chunkDocument(doc('## 新增\n前面多一节。\n## 第一节\n保持原文。\n## 第二节\n这一节也保持。'));
  assert.deepEqual(
    fresh.slice(1).map((chunk) => chunk.id),
    old.map((chunk) => chunk.id),
  );
});

test('evidence thresholds reject weak candidates, suppress duplicates and do not fill a fixed top-k', () => {
  const [chunk] = chunkDocument(doc('## 原理\n只有这一条是有用的证据。'));
  const candidates = [
    { chunk: chunk!, score: 0.9 },
    { chunk: { ...chunk!, id: 'duplicate' }, score: 0.8 },
    { chunk: { ...chunk!, id: 'noise', hash: 'different', text: '无关内容' }, score: 0.01 },
  ];
  assert.equal(selectEvidence(candidates).length, 1);
  assert.deepEqual(selectEvidence([{ chunk: chunk!, score: 0.001 }]), []);
});

test('chat budget counts model text tokens with a separate message envelope reserve', () => {
  const input = {
    message: '解释向量检索',
    history: [{ role: 'user' as const, content: '无关历史'.repeat(2000) }],
    requestId: 'test',
  };
  const messages = messagesFor(input, [], { ...testConfig, MAX_INPUT_TOKENS: 1500 });
  assert.equal(messages.length, 3);
  assert.ok(messageTokens(messages) <= 1500);
  assert.ok(
    chatTokens('铃月的向量检索使用 PostgreSQL 和 BGE-M3。') < Buffer.byteLength('铃月的向量检索使用 PostgreSQL 和 BGE-M3。'),
  );
});
