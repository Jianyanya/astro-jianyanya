import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

/** Export an owner-only build artifact; expose only its fingerprint for publication verification. */
export function lingyueIntegration(): AstroIntegration {
  let root: URL;
  let client: URL;
  return {
    name: 'belluna-lingyue',
    hooks: {
      'astro:config:setup': ({ config, injectRoute }) => {
        root = config.root;
        for (const [pattern, file] of [
          ['/_lingyue-snapshot.json', './snapshot.ts'],
          ['/lingyue-version.json', './version.ts'],
        ] as const)
          injectRoute({ pattern, entrypoint: fileURLToPath(new URL(file, import.meta.url)), prerender: true });
      },
      'astro:config:done': ({ config }) => {
        client = config.build.client;
      },
      'astro:build:done': async ({ logger }) => {
        const staged = new URL('_lingyue-snapshot.json', client);
        const directory = new URL('.cache/lingyue/', root);
        const contents = await readFile(staged, 'utf8');
        await unlink(staged);
        await mkdir(directory, { recursive: true });
        const temp = new URL('snapshot.tmp', directory);
        await writeFile(temp, contents, 'utf8');
        await rename(temp, new URL('snapshot.json', directory));
        logger.info('铃月私有知识快照已导出；本次构建没有更新云端知识库。');
      },
    },
  };
}
