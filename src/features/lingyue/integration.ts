import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

/** Generate using Astro's resolved collection/URLs, then remove from the public build. */
export function lingyueIntegration(): AstroIntegration {
  let root: URL;
  return {
    name: 'belluna-lingyue',
    hooks: {
      'astro:config:setup': ({ config, injectRoute }) => {
        root = config.root;
        injectRoute({
          pattern: '/_lingyue-snapshot.json',
          entrypoint: fileURLToPath(new URL('./snapshot.ts', import.meta.url)),
          prerender: true,
        });
      },
      'astro:server:setup': ({ server }) => {
        server.middlewares.use('/api/lingyue', async (request, response) => {
          // Dev stays same-origin; private keys remain entirely in the independent backend.
          const cancel = new AbortController();
          response.on('close', () => cancel.abort());
          try {
            const backend = process.env.LINGYUE_DEV_BACKEND ?? 'http://127.0.0.1:8787';
            const upstream = await fetch(`${backend}/api/lingyue${request.url ?? ''}`, {
              method: request.method,
              headers: Object.fromEntries(
                Object.entries(request.headers).filter(
                  ([key, value]) => typeof value === 'string' && !['host', 'connection', 'content-length'].includes(key),
                ),
              ) as Record<string, string>,
              ...(request.method === 'POST' ? { body: request as unknown as ReadableStream, duplex: 'half' } : {}),
              signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(115000)]),
            } as RequestInit);
            response.statusCode = upstream.status;
            for (const [key, value] of upstream.headers)
              if (!['transfer-encoding', 'connection', 'content-encoding'].includes(key)) response.setHeader(key, value);
            if (upstream.body) {
              const reader = upstream.body.getReader();
              try {
                while (!cancel.signal.aborted) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  response.write(value);
                }
              } finally {
                await reader.cancel().catch(() => {});
              }
            }
            response.end();
          } catch {
            if (response.destroyed) return;
            if (!response.headersSent) {
              response.statusCode = 503;
              response.setHeader('Content-Type', 'application/json');
            }
            response.end(JSON.stringify({ message: '刚才没接上话，等会儿再来找我喵~' }));
          }
        });
      },
      'astro:build:done': async ({ dir, logger }) => {
        const staged = new URL('_lingyue-snapshot.json', dir);
        const directory = new URL('.cache/lingyue/', root);
        // Delete the intermediate artifact even when private snapshot writing fails.
        const contents = await readFile(staged, 'utf8');
        await unlink(staged);
        await mkdir(directory, { recursive: true });
        const temp = new URL('snapshot.tmp', directory);
        await writeFile(temp, contents, 'utf8');
        await rename(temp, new URL('snapshot.json', directory));
        logger.info('铃月公开知识快照已导出到 .cache/lingyue/，不在网站公开目录中。');
      },
    },
  };
}
