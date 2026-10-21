import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { Providers } from '../src/providers.js';
import { CloudflareApi } from './api.js';
import { publishSnapshot } from './publish.js';

async function main() {
  const env = z
    .object({
      CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/),
      CLOUDFLARE_API_TOKEN: z.string().min(1),
      LINGYUE_D1_ID: z.string().uuid(),
      SILICONFLOW_API_KEY: z.string().min(1),
    })
    .parse(process.env);
  const snapshot: unknown = JSON.parse(await readFile(new URL('../../.cache/lingyue/snapshot.json', import.meta.url), 'utf8'));
  const api = new CloudflareApi(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN, env.LINGYUE_D1_ID, 'lingyue-knowledge');
  const c = loadConfig({ ...env, COOKIE_SECRET: 'build-only-placeholder-not-used-for-chat' });
  console.log(await publishSnapshot(snapshot, api, new Providers(c), console.log));
}
main().catch(() => {
  console.error('知识同步失败；有效索引未切换。请检查凭据、资源 ID、上游额度及 GitHub Actions 日志。');
  process.exitCode = 1;
});
