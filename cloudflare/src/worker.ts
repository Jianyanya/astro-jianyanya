import { z } from 'zod';
import { answer } from './chat.js';
import { loadConfig } from './config.js';
import type { Env } from './env.js';
import { identity, ipHash, PublicError } from './limits.js';
import { Providers } from './providers.js';
import { Retrieval } from './retrieval.js';
import { Store } from './store.js';
import type { Usage } from './types.js';

export { QuotaObject } from './quota-object.js';

const schema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    articleId: z.string().max(200).optional(),
    history: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(6000) }).strict())
      .max(12)
      .default([]),
    requestId: z.string().uuid(),
  })
  .strict();

export async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new PublicError(415, '消息没接好喵~');
  const reader = request.body?.getReader();
  if (!reader) throw new PublicError(400, '重新发一句给我吧喵~');
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 48000) throw new PublicError(413, '这次的内容有点多，分成小一点的问题再和我说喵~');
      text += decoder.decode(value, { stream: true });
    }
    try {
      return JSON.parse(text + decoder.decode()) as unknown;
    } catch {
      throw new PublicError(400, '这条消息没接好，重新发一句给我吧喵~');
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const json = (status: number, data: unknown) => Response.json(data, { status, headers });
    try {
      const path = new URL(request.url).pathname;
      if (!['/api/lingyue/chat', '/api/lingyue/quota'].includes(path)) return json(404, {});
      const c = loadConfig(env);
      if (
        (request.headers.get('origin') && request.headers.get('origin') !== new URL(c.SITE_ORIGIN).origin) ||
        request.headers.get('sec-fetch-site') === 'cross-site'
      )
        throw new PublicError(403, '来博客里找我聊天吧喵~');
      const ident = identity(request.headers.get('cookie') ?? undefined, c.COOKIE_SECRET);
      headers.set('Set-Cookie', ident.cookie + (c.SITE_ORIGIN.startsWith('https:') ? '; Secure' : ''));
      // Only Cloudflare's edge-provided header is trusted; never X-Forwarded-For / browser IDs.
      const ip = ipHash(request.headers.get('CF-Connecting-IP') ?? 'local', c.COOKIE_SECRET);
      const stub = env.QUOTAS.get(env.QUOTAS.idFromName('global'));
      const quota = async (action: string, extra: Record<string, unknown> = {}) => {
        const response = await stub.fetch('https://quota.internal/', {
          method: 'POST',
          body: JSON.stringify({ action, visitor: ident.visitor, ip, ...extra }),
        });
        const data = (await response.json()) as { message?: string; remaining: number; available: boolean; resetsAt: string };
        if (!response.ok) throw new PublicError(response.status, data.message ?? '稍后再来找我喵~');
        return { ...data, available: data.available && Boolean(c.CHAT_API_KEY) };
      };
      if (path.endsWith('/quota') && request.method === 'GET') return json(200, await quota('quota'));
      if (path !== '/api/lingyue/chat' || request.method !== 'POST') return json(405, {});
      if (!c.CHAT_API_KEY) throw new PublicError(503, '我还在准备中，过会儿来找我喵~');
      const parsed = schema.safeParse(await readBody(request));
      if (!parsed.success) throw new PublicError(400, '这条消息没接好，重新发一句给我吧喵~');
      const id = parsed.data.requestId;
      await quota('reserve', { id });
      const cancel = new AbortController();
      const signal = AbortSignal.any([cancel.signal, request.signal, AbortSignal.timeout(110000)]);
      let called = false;
      let usage: Usage | undefined;
      let stage = 'starting';
      const encoder = new TextEncoder();
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>(
        {
          start(value) {
            controller = value;
          },
          cancel() {
            cancel.abort();
          },
        },
        { highWaterMark: 128000, size: (frame) => frame.byteLength },
      );
      const emit = (event: string, data: unknown) => {
        if (event === 'status') stage = (data as { stage: string }).stage;
        signal.throwIfAborted();
        if ((controller.desiredSize ?? 0) <= 0) {
          cancel.abort();
          throw new Error('Slow consumer');
        }
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const task = (async () => {
        try {
          const providers = new Providers(c);
          await answer(
            parsed.data,
            new Retrieval(new Store(env.DB), providers, env.VECTORS, c),
            providers,
            c,
            signal,
            emit,
            () => {
              called = true;
            },
            (v) => {
              usage = v;
            },
          );
          const q = await quota('settle', { id, called, usage });
          emit('done', { quota: q });
        } catch (error) {
          console.warn(
            JSON.stringify({
              event: 'chat_failed',
              stage,
              name: error instanceof Error ? error.name : 'Unknown',
              status: error instanceof PublicError ? error.status : 500,
            }),
          );
          try {
            emit('error', { message: '刚才没能把话说完，等会儿再陪你看看喵~' });
          } catch {
            /* disconnected */
          }
        } finally {
          // Retry is idempotent. On a failed settlement, the full reserved cost remains charged.
          await quota('settle', { id, called, usage }).catch(() => {});
          try {
            controller.close();
          } catch {
            /* disconnected */
          }
          cancel.abort();
        }
      })();
      ctx.waitUntil(task);
      headers.set('Content-Type', 'text/event-stream; charset=utf-8');
      headers.set('X-Accel-Buffering', 'no');
      return new Response(stream, { headers });
    } catch (error) {
      return json(error instanceof PublicError ? error.status : 503, {
        message: error instanceof PublicError ? error.message : '刚才没接上话，等会儿再来找我喵~',
      });
    }
  },
};
