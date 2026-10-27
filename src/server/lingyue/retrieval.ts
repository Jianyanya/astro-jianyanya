import type { Config } from './config.js';
import { type Candidate, selectEvidence } from './evidence.js';
import type { Providers } from './providers.js';
import type { Store } from './store.js';
import { embeddingText, hash, rrf } from './text.js';
import { ensureTokenizers } from './tokenization.js';
import type { ChatInput, Chunk, Source } from './types.js';

const greeting = /^(你好[呀啊！!。\s]*|嗨[！!。\s]*|hello[!\s]*|hi[!\s]*|早上好[！!。\s]*|晚安[！!。\s]*|谢谢[你！!。\s]*)$/i;
// Exact short social turns only. A nickname or goodnight inside a knowledge
// question must not bypass retrieval; unfamiliar/ambiguous messages still search.
const socialTurns = new Set([
  '在吗',
  '在不在',
  '小宝贝',
  '亲亲',
  '么么么',
  '亲亲么么么',
  '我要睡觉了',
  '我要乖乖睡觉了',
  '好的我要乖乖睡觉了',
]);
export class Retrieval {
  private cache = new Map<string, { vector: number[]; expires: number }>();
  constructor(
    readonly store: Store,
    readonly providers: Providers,
    readonly c: Config,
  ) {}
  async find(
    input: ChatInput,
    signal: AbortSignal,
    trace?: (value: { vector: string[]; keyword: string[]; fused: string[]; reranked: Candidate[] }) => void,
  ): Promise<{ sources: Source[]; degraded: string[] }> {
    await ensureTokenizers('chat');
    const compact = input.message.replace(/[\s，,。.!！?？~～、]/g, '');
    if (greeting.test(input.message.trim()) || socialTurns.has(compact)) return { sources: [], degraded: [] };
    const version = await this.store.version();
    if (!version) return { sources: [], degraded: ['知识索引尚未建立'] };
    const document = input.articleId ? await this.store.chunks(version, undefined, input.articleId) : [];
    const current = document[0];
    let query = input.message;
    if (/它|这个|那个|之前|上述|刚才/.test(query)) {
      const prior = input.history.filter((message) => message.role === 'user').at(-1)?.content;
      if (prior) query = `${prior.slice(0, 350)}\n${query}`;
    }
    if (current && /这篇|本文|当前文章|这里|它/.test(query)) query = `${current.title}\n${query}`;
    const restricted = current && /这篇|本文|当前文章/.test(input.message) ? [current.documentId] : undefined;
    const degraded: string[] = [];
    const keyword = await this.store.keyword(version, query, restricted?.[0]);
    const key = hash(`${this.c.EMBEDDING_MODEL}:${query}`);
    let vectorIds: string[] = [];
    try {
      const cached = this.cache.get(key);
      const vector = cached && cached.expires > Date.now() ? cached.vector : (await this.providers.embed([query], signal))[0]!;
      if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { vector, expires: Date.now() + 5 * 60000 });
      vectorIds = await this.store.vector(version, vector, restricted?.[0]);
    } catch {
      signal.throwIfAborted();
      degraded.push('语义检索暂不可用，已使用关键词检索');
    }
    // Both recall branches filter the same immutable knowledge version before taking top-k.
    const rows = new Map((await this.store.chunks(version, [...new Set([...vectorIds, ...keyword])])).map((c) => [c.id, c]));
    const ranking = rrf([vectorIds.filter((id) => rows.has(id)), keyword]).slice(0, 20);
    let candidates = ranking.map((id) => rows.get(id)).filter((c): c is Chunk => Boolean(c));
    let scored: Candidate[] = candidates.map((chunk) => ({ chunk }));
    if (this.c.RERANK_ENABLED === 'true' && candidates.length) {
      try {
        const result = await this.providers.rerank(query, candidates.map(embeddingText), signal);
        scored = result.map((item) => ({ chunk: candidates[item.index]!, score: item.relevance_score }));
        candidates = scored.map((item) => item.chunk);
      } catch {
        signal.throwIfAborted();
        degraded.push('精排暂不可用，已保留混合检索排序');
      }
    }
    trace?.({ vector: vectorIds, keyword, fused: ranking, reranked: scored });
    // Summary requests need chapter coverage, not only the most similar paragraph.
    const coverage = Boolean(/总结|概括|整体|全文/.test(input.message) && restricted);
    if (coverage) {
      const sections = new Map<string, Chunk>();
      for (const chunk of document) if (!sections.has(chunk.heading)) sections.set(chunk.heading, chunk);
      const unique = [...sections.values()];
      const samples =
        unique.length <= 6 ? unique : Array.from({ length: 6 }, (_, i) => unique[Math.floor((i * (unique.length - 1)) / 5)]!);
      candidates = [...samples, ...candidates.filter((chunk) => !samples.some((s) => s.id === chunk.id))];
      scored = candidates.map((chunk) => ({ chunk }));
    }
    const selected = selectEvidence(scored, { scoped: Boolean(restricted), coverage });
    const allowed = await this.store.allowed(selected.flatMap((source) => (source.documentId ? [source.documentId] : [])));
    const sources = selected.filter((source) => source.documentId && allowed.has(source.documentId));
    return { sources, degraded };
  }
}
