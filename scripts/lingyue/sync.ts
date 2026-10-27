import { database } from '../../src/server/lingyue/database.js';
import { manifestOf, snapshotSchema } from '../../src/server/lingyue/manifest.js';
import { verifyDeployment } from './deployment.js';
import { cache, jsonFile, localEnv, saveJson } from './files.js';
import { activate, cleanup, stage } from './publish.js';
import { beginPublication, type Publication } from './withdrawals.js';

async function main() {
  const env = await localEnv();
  const db = database(env.KNOWLEDGE_DATABASE_URL ?? '');
  const mode = process.argv[2];
  try {
    if (mode === 'cleanup') {
      await cleanup(db);
      console.log('退休知识版本清理完成。');
      return;
    }
    if (mode === 'begin') {
      const snapshot = snapshotSchema.parse(await jsonFile(new URL('snapshot.json', cache)));
      const publication = await beginPublication(db, snapshot);
      await saveJson(new URL('publication.json', cache), { ...publication, ...manifestOf(snapshot) });
      console.log(`已开始发布，撤回 ${publication.withdrawn} 篇文章；下一步生成并上传新版本。`);
      return;
    }
    if (mode !== 'stage' && mode !== 'activate') throw new Error('Unknown mode');
    const prepared = await jsonFile(new URL('prepared.json', cache));
    const manifest = await stage(db, prepared);
    if (mode === 'stage') {
      console.log(`知识版本 ${manifest.version} 已上传，线上有效版本未改变。`);
      return;
    }
    const publication = (await jsonFile(new URL('publication.json', cache))) as Publication & { version: string };
    if (publication.version !== manifest.version || typeof publication.sequence !== 'string')
      throw new Error('请先为本次快照运行 knowledge:begin，不能复用旧发布凭据');
    const origin =
      process.argv.find((arg) => arg.startsWith('--origin='))?.slice(9) ?? env.SITE_ORIGIN ?? 'https://belluna.love';
    await verifyDeployment(origin, manifest);
    await activate(db, manifest.version, publication.previousVersion, new Date(), publication.sequence);
    await saveJson(new URL('last-neon-sync.json', cache), { ...manifest, activatedAt: new Date().toISOString() });
    console.log(`已验证网站并启用知识版本 ${manifest.version}。`);
    try {
      await cleanup(db);
    } catch {
      console.warn('旧版本清理稍后重试；当前有效版本已启用。');
    }
  } finally {
    await db.close();
  }
}
main().catch(() => {
  console.error('知识发布未完成：请检查数据库配置、待发布产物及网站版本；没有强制切换知识版本。');
  process.exitCode = 1;
});
