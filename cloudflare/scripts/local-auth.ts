import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv, promisify } from 'node:util';
import { z } from 'zod';

const exec = promisify(execFile);
const cloudflareRoot = new URL('../', import.meta.url);
const projectRoot = new URL('../../', import.meta.url);

export function localSettings(value: unknown, key: string | undefined) {
  const config = z
    .object({
      account_id: z.string().regex(/^[a-f0-9]{32}$/),
      d1_databases: z.array(z.object({ binding: z.string(), database_id: z.string().uuid() })),
      vectorize: z.array(z.object({ binding: z.string(), index_name: z.string().min(1) })),
    })
    .parse(value);
  const database = config.d1_databases.find((d) => d.binding === 'DB')?.database_id;
  const index = config.vectorize.find((v) => v.binding === 'VECTORS')?.index_name;
  if (!database || !index || database === '00000000-0000-0000-0000-000000000000')
    throw new Error('请先在 cloudflare/wrangler.jsonc 配置已有知识库的资源 ID。');
  if (!key?.trim()) throw new Error('请在博客 .env 中设置 SILICONFLOW_API_KEY；当前工作区也支持父目录 .env。');
  return { account: config.account_id, database, index, embeddingKey: key.trim() };
}

export function parseAuth(output: string): string {
  try {
    return z.object({ token: z.string().min(1) }).parse(JSON.parse(output)).token;
  } catch {
    // Never propagate parser details: output can contain credentials.
    throw new Error('无法获取本机 Cloudflare 登录授权，请运行 pnpm --dir cloudflare exec wrangler login。');
  }
}

export async function readLocalSettings() {
  const files = await Promise.all(
    [new URL('.env', projectRoot), new URL('../.env', projectRoot)].map(async (file) => {
      try {
        return parseEnv(await readFile(file, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
        throw new Error('无法读取本地 .env 配置。');
      }
    }),
  );
  const key = process.env.SILICONFLOW_API_KEY ?? files[0]?.SILICONFLOW_API_KEY ?? files[1]?.SILICONFLOW_API_KEY;
  return localSettings(JSON.parse(await readFile(new URL('wrangler.jsonc', cloudflareRoot), 'utf8')), key);
}

async function loginToken() {
  try {
    const { stdout } = await exec(
      process.execPath,
      [fileURLToPath(new URL('node_modules/wrangler/bin/wrangler.js', cloudflareRoot)), 'auth', 'token', '--json'],
      {
        cwd: fileURLToPath(cloudflareRoot),
        timeout: 120000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_API_KEY: undefined, WRANGLER_SEND_METRICS: 'false' },
      },
    );
    return parseAuth(stdout);
  } catch {
    throw new Error('本机 Cloudflare 登录不可用，请运行 pnpm --dir cloudflare exec wrangler login 后重试。');
  }
}

/** OAuth remains in memory; refresh through Wrangler instead of copying it into CI secrets. */
export async function localRequest(): Promise<typeof fetch> {
  let token = await loginToken();
  let checkedAt = Date.now();
  return async (input, init) => {
    if (Date.now() - checkedAt > 5 * 60000) {
      token = await loginToken();
      checkedAt = Date.now();
    }
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
}
