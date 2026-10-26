import type { Config } from './config.js';
import type { Providers } from './providers.js';
import type { Store } from './store.js';
import { embeddingText, hash, rrf, tokenBound } from './text.js';
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
  async find(input: ChatInput, signal: AbortSignal): Promise<{ sources: Source[]; degraded: string[] }> {
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
    if (this.c.RERANK_ENABLED === 'true' && candidates.length > 1) {
      try {
        const indices = await this.providers.rerank(query, candidates.map(embeddingText), signal);
        candidates = indices.map((i) => candidates[i]!);
      } catch {
        signal.throwIfAborted();
        degraded.push('精排暂不可用，已保留混合检索排序');
      }
    }
    // Summary requests need chapter coverage, not only the most similar paragraph.
    if (/总结|概括|整体|全文/.test(input.message) && current) {
      const sections = new Map<string, Chunk>();
      for (const chunk of document) if (!sections.has(chunk.heading)) sections.set(chunk.heading, chunk);
      const unique = [...sections.values()];
      const samples =
        unique.length <= 6 ? unique : Array.from({ length: 6 }, (_, i) => unique[Math.floor((i * (unique.length - 1)) / 5)]!);
      candidates = [...samples, ...candidates.filter((chunk) => !samples.some((s) => s.id === chunk.id))];
    }
    const sources: Source[] = [];
    let size = 0;
    const seen = new Set<string>();
    for (const chunk of candidates) {
      if (seen.has(chunk.id) || sources.length >= 6) continue;
      const room = 6500 - size;
      if (room < 300) break;
      // Preserve full code blocks whenever possible; don't add cut-off trailing fences.
      if (tokenBound(chunk.text) > room) continue;
      size += tokenBound(chunk.text) + tokenBound(chunk.title + chunk.heading) + 100;
      seen.add(chunk.id);
      sources.push({
        id: `S${sources.length + 1}`,
        title: chunk.title,
        heading: chunk.heading,
        url: chunk.url,
        text: chunk.text,
      });
    }
    return { sources, degraded };
  }
}
