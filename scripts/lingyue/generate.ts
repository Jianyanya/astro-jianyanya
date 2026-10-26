import { loadConfig } from '../../src/server/lingyue/config.js';
import { snapshotSchema } from '../../src/server/lingyue/manifest.js';
import { Providers } from '../../src/server/lingyue/providers.js';
import { cache, jsonFile, localEnv, saveJson } from './files.js';
import { chunkDocument } from './markdown.js';
import { cacheKey, embeddingText, validatePrepared, vectorSchema } from './prepared.js';

async function main() {
  const env = await localEnv();
  const snapshot = snapshotSchema.parse(await jsonFile(new URL('snapshot.json', cache)));
  let vectors: Record<string, number[]> = {};
  const file = new URL('embeddings.json', cache);
  try {
    const existing = (await jsonFile(file)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(existing)) {
      const parsed = vectorSchema.safeParse(value);
      if (parsed.success) vectors[key] = parsed.data;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('本地向量缓存损坏，请先检查备份。');
  }
  const chunks = snapshot.documents.flatMap(chunkDocument);
  const missing = [...new Map(chunks.filter((c) => !vectors[cacheKey(c.hash)]).map((c) => [cacheKey(c.hash), c])).values()];
  const providers = new Providers(
    loadConfig({ ...env, COOKIE_SECRET: env.COOKIE_SECRET ?? 'local-generation-placeholder-32-characters' }),
  );
  for (let i = 0; i < missing.length; i += 8) {
    const batch = missing.slice(i, i + 8);
    const fresh = await providers.embed(batch.map(embeddingText), AbortSignal.timeout(60000));
    for (const [offset, chunk] of batch.entries()) vectors[cacheKey(chunk.hash)] = fresh[offset]!;
    await saveJson(file, vectors);
    console.log(`本地向量 ${Math.min(i + 8, missing.length)}/${missing.length}`);
  }
  vectors = Object.fromEntries(chunks.map((c) => [cacheKey(c.hash), vectors[cacheKey(c.hash)]!]));
  const prepared = validatePrepared({ snapshot, vectors });
  await saveJson(new URL('prepared.json', cache), prepared.artifact);
  console.log(`本地知识已生成：${snapshot.documents.length} 篇，${chunks.length} 片段；新增向量 ${missing.length}。`);
  console.log(`版本 ${prepared.manifest.version}；没有连接或更新线上知识数据库。`);
}
main().catch(() => {
  console.error('知识生成未完成。请检查快照、向量缓存和 SILICONFLOW_API_KEY；已有缓存已保留。');
  process.exitCode = 1;
});
