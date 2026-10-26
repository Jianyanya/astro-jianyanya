import { CloudflareApi } from '../../cloudflare/scripts/api.js';
import { localRequest, readLocalSettings } from '../../cloudflare/scripts/local-auth.js';
import { cache, jsonFile, saveJson } from './files.js';
import { vectorSchema } from './prepared.js';

/** One-time, read-only import. Leaves the live Cloudflare knowledge version and quotas untouched. */
async function main() {
  const s = await readLocalSettings();
  const api = new CloudflareApi(s.account, 'in-memory-oauth', s.database, s.index, await localRequest());
  const vectors: Record<string, number[]> = {};
  const file = new URL('embeddings.json', cache);
  try {
    Object.assign(vectors, await jsonFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const rows = (await api.sql<{ key: string; data: string }>([{ sql: 'SELECT key,data FROM embeddings' }]))[0]!.results;
  for (const row of rows) vectors[row.key] = vectorSchema.parse(JSON.parse(row.data));
  await saveJson(file, vectors);
  console.log(`已只读导入 ${rows.length} 份向量缓存，没有更改 Cloudflare 线上数据。`);
}
main().catch(() => {
  console.error('缓存导入未完成，请检查本机 Wrangler 登录；Cloudflare 线上数据未修改。');
  process.exitCode = 1;
});
