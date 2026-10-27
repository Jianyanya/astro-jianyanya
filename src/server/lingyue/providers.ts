import { z } from 'zod';
import type { Config } from './config.js';
import { PublicError } from './limits.js';
import type { Message, Usage } from './types.js';

const vectorSchema = z.array(z.number().finite()).length(1024);
const embeddingSchema = z.object({
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: vectorSchema })),
});
const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
});
const streamSchema = z.object({
  choices: z.array(
    z.object({ delta: z.object({ content: z.string().nullish() }).passthrough(), finish_reason: z.string().nullish() }),
  ),
  usage: usageSchema.nullish(),
});

/** Provider HTTP failure before an accepted stream; timeout/5xx billing may still be uncertain. */
export class UpstreamHTTPError extends PublicError {
  constructor(
    readonly upstreamStatus: number,
    readonly retryAfterSeconds: number,
  ) {
    super(502, '我这会儿有点忙，稍等一下再陪你聊喵~');
    this.name = `UpstreamHTTP${upstreamStatus}`;
  }
}

function retryAfter(value: string | null) {
  if (!value) return 0;
  const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.min(86400, Math.max(0, Math.ceil(seconds))) : 0;
}

/** POST fetch stream parser, including CRLF, split UTF-8 and multiple data lines. */
async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 1_000_000) throw new Error('Upstream event too large');
      while (true) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          if (data.length) yield data.join('\n');
          data = [];
        } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (done) {
        if (buffer.startsWith('data:')) data.push(buffer.slice(5).trimStart());
        if (data.length) yield data.join('\n');
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class Providers {
  constructor(
    readonly c: Config,
    readonly request: typeof fetch = fetch.bind(globalThis),
  ) {}
  private async silicon(path: string, payload: unknown, signal: AbortSignal) {
    if (!this.c.SILICONFLOW_API_KEY) throw new Error('Embedding provider not configured');
    const response = await this.request(`https://api.siliconflow.cn/v1/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.c.SILICONFLOW_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`SiliconFlow ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  }
  async embed(input: string[], signal: AbortSignal): Promise<number[][]> {
    const result = embeddingSchema.parse(
      await this.silicon(
        'embeddings',
        {
          model: this.c.EMBEDDING_MODEL,
          input,
          encoding_format: 'float',
        },
        signal,
      ),
    );
    if (result.data.length !== input.length || new Set(result.data.map((x) => x.index)).size !== input.length) {
      throw new Error('Embedding response count mismatch');
    }
    return input.map((_, i) => {
      const item = result.data.find((x) => x.index === i);
      if (!item || !item.embedding.some((n) => n !== 0)) throw new Error('Invalid embedding');
      return item.embedding;
    });
  }
  async rerank(query: string, documents: string[], signal: AbortSignal): Promise<number[]> {
    const result = z
      .object({ results: z.array(z.object({ index: z.number().int().nonnegative(), relevance_score: z.number().finite() })) })
      .parse(
        await this.silicon(
          'rerank',
          { model: this.c.RERANK_MODEL, query, documents, top_n: documents.length, return_documents: false },
          signal,
        ),
      );
    const indices = result.results.map((x) => x.index);
    if (new Set(indices).size !== documents.length || indices.some((i) => i >= documents.length))
      throw new Error('Invalid rerank');
    return indices;
  }
  async chat(
    messages: Array<Message | { role: 'system'; content: string }>,
    signal: AbortSignal,
    onDelta: (text: string) => void,
    onUsage: (usage: Usage) => void,
  ) {
    if (!this.c.CHAT_API_KEY) throw new PublicError(503, '铃月还在准备中，站长配置完成后就能聊天啦。');
    const response = await this.request(`${this.c.CHAT_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.c.CHAT_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.c.CHAT_MODEL,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        thinking: { type: 'disabled' },
        max_tokens: this.c.MAX_OUTPUT_TOKENS,
        temperature: 0.6,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new UpstreamHTTPError(response.status, retryAfter(response.headers.get('retry-after')));
    }
    if (!response.body) throw new PublicError(502, '刚才没接上话，稍后再来找我喵~');
    let finished = false;
    for await (const data of readSSE(response.body)) {
      if (data === '[DONE]') {
        finished = true;
        break;
      }
      const event = streamSchema.parse(JSON.parse(data));
      if (event.usage) onUsage(event.usage);
      for (const choice of event.choices) {
        if (choice.delta.content) onDelta(choice.delta.content);
      }
    }
    if (!finished) throw new PublicError(502, '回复连接中断，已生成的内容已保留。');
  }
}
