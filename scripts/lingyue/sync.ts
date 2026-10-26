import { database } from '../../src/server/lingyue/database.js';
import { verifyDeployment } from './deployment.js';
import { cache, jsonFile, localEnv, saveJson } from './files.js';
import { activate, cleanup, stage } from './publish.js';

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
    if (mode !== 'stage' && mode !== 'activate') throw new Error('Unknown mode');
    const prepared = await jsonFile(new URL('prepared.json', cache));
    const manifest = await stage(db, prepared);
    if (mode === 'stage') {
      console.log(`知识版本 ${manifest.version} 已上传，线上有效版本未改变。`);
      return;
    }
    const [control] = await db.query<{ active_version: string | null }>(
      'SELECT active_version FROM lingyue.control WHERE id=1',
    );
    const origin =
      process.argv.find((arg) => arg.startsWith('--origin='))?.slice(9) ?? env.SITE_ORIGIN ?? 'https://belluna.love';
    await verifyDeployment(origin, manifest);
    await activate(db, manifest.version, control?.active_version ?? null);
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
