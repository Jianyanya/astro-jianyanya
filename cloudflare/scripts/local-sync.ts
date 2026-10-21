import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/config.js';
import { Providers } from '../src/providers.js';
import { CloudflareApi } from './api.js';
import { localRequest, readLocalSettings } from './local-auth.js';
import { publishSnapshot } from './publish.js';

async function main() {
  const settings = await readLocalSettings();
  const request = await localRequest();
  const snapshot: unknown = JSON.parse(await readFile(new URL('../../.cache/lingyue/snapshot.json', import.meta.url), 'utf8'));
  const config = loadConfig({
    COOKIE_SECRET: 'local-build-placeholder-not-used-for-chat',
    SILICONFLOW_API_KEY: settings.embeddingKey,
  });
  console.log('使用本机 Wrangler 登录同步知识库；不会向 GitHub 上传任何凭据。');
  const api = new CloudflareApi(
    settings.account,
    'local-oauth-injected-by-request',
    settings.database,
    settings.index,
    request,
  );
  const result = await publishSnapshot(snapshot, api, new Providers(config), console.log);
  const dir = new URL('../../.cache/lingyue/', import.meta.url);
  await mkdir(dir, { recursive: true });
  const temp = new URL('last-sync.tmp', dir);
  await writeFile(temp, JSON.stringify({ ...result, synchronizedAt: new Date().toISOString() }, null, 2) + '\n');
  await rename(temp, new URL('last-sync.json', dir));
  console.log(result.unchanged ? '文章知识没有变化，无需重新生成向量。' : '知识库已完成增量更新。');
  console.log('现在可以照常 git add / commit / push，Cloudflare 会按原流程自动发布博客。');
}
main().catch(() => {
  console.error(
    '知识同步未完成。请检查本机 Wrangler 登录、SILICONFLOW_API_KEY 和 wrangler.jsonc 的资源 ID 后重试。旧有效索引会保留；已删除或私密文章会先撤出检索。',
  );
  process.exitCode = 1;
});
