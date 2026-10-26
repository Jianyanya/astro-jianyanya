import { z } from 'zod';
import { answer } from './chat.js';
import type { Config } from './config.js';
import type { Ledger } from './ledger.js';
import { identity, ipHash, PublicError } from './limits.js';
import type { Providers } from './providers.js';
import type { Retrieval } from './retrieval.js';
import type { Usage } from './types.js';

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
export interface Runtime {
  origins?: string[];
  c: Config;
  ledger: Ledger;
  providers: Providers;
  retrieval: Retrieval;
}

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

export async function handleRequest(
  request: Request,
  runtime: Runtime,
  background: (task: Promise<unknown>) => void = () => {},
) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  const json = (status: number, data: unknown) => Response.json(data, { status, headers });
  const { c, ledger, providers, retrieval } = runtime;
  try {
    const path = new URL(request.url).pathname;
    if (!['/api/lingyue/chat', '/api/lingyue/quota'].includes(path)) return json(404, {});
    if (
      (request.headers.get('origin') &&
        ![new URL(c.SITE_ORIGIN).origin, ...(runtime.origins ?? [])].includes(request.headers.get('origin')!)) ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new PublicError(403, '来博客里找我聊天吧喵~');
    const ident = identity(request.headers.get('cookie') ?? undefined, c.COOKIE_SECRET);
    headers.set('Set-Cookie', ident.cookie + (c.SITE_ORIGIN.startsWith('https:') ? '; Secure' : ''));
    const ip = ipHash(request.headers.get('x-vercel-forwarded-for') ?? 'local', c.COOKIE_SECRET);
    const quota = async () => {
      const { remaining, available, resetsAt } = await ledger.quota(ident.visitor, ip);
      return { remaining, available: available && Boolean(c.CHAT_API_KEY), resetsAt };
    };
    if (path.endsWith('/quota') && request.method === 'GET') return json(200, await quota());
    if (path !== '/api/lingyue/chat' || request.method !== 'POST') return json(405, {});
    if (!c.CHAT_API_KEY) throw new PublicError(503, '我还在准备中，过会儿来找我喵~');
    const parsed = schema.safeParse(await readBody(request));
    if (!parsed.success) throw new PublicError(400, '这条消息没接好，重新发一句给我吧喵~');
    const id = parsed.data.requestId;
    await ledger.reserve(id, ident.visitor, ip);
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
        await answer(
          parsed.data,
          retrieval,
          providers,
          c,
          signal,
          emit,
          () => {
            called = true;
          },
          (value) => {
            usage = value;
          },
        );
        await ledger.settle(id, called, usage);
        emit('done', { quota: await quota() });
      } catch (error) {
        console.warn(JSON.stringify({ event: 'chat_failed', stage, name: error instanceof Error ? error.name : 'Unknown' }));
        try {
          emit('error', { message: '刚才没能把话说完，等会儿再陪你看看喵~' });
        } catch {
          /* disconnected */
        }
      } finally {
        await ledger.settle(id, called, usage).catch(() => {});
        try {
          controller.close();
        } catch {
          /* disconnected */
        }
        cancel.abort();
      }
    })();
    background(task);
    headers.set('Content-Type', 'text/event-stream; charset=utf-8');
    return new Response(stream, { headers });
  } catch (error) {
    return json(error instanceof PublicError ? error.status : 503, {
      message: error instanceof PublicError ? error.message : '刚才没接上话，等会儿再来找我喵~',
    });
  }
}
