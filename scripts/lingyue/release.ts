import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { database } from '../../src/server/lingyue/database.js';
import { manifestOf, snapshotSchema } from '../../src/server/lingyue/manifest.js';
import { verifyDeployment } from './deployment.js';
import { cache, jsonFile, localEnv, saveJson } from './files.js';
import { generate } from './generate.js';
import { activate, cleanup, stage } from './publish.js';
import { beginPublication } from './withdrawals.js';

const exec = promisify(execFile);
async function git(...args: string[]) {
  return (await exec('git', args, { timeout: 120000 })).stdout.trim();
}
async function main() {
  if ((await git('branch', '--show-current')) !== 'main') throw new Error('请在 main 分支发布');
  if (await git('status', '--porcelain')) throw new Error('请先审阅并提交本地改动，再运行发布命令');
  // A stale checkout must fail before it can withdraw documents from a newer release.
  await git('fetch', '--no-tags', 'origin', 'main');
  try {
    await git('merge-base', '--is-ancestor', 'FETCH_HEAD', 'HEAD');
  } catch {
    throw new Error('请先合并远端 main 的最新发布，再构建并发布');
  }
  const commit = await git('rev-parse', 'HEAD');
  const env = await localEnv();
  const db = database(env.KNOWLEDGE_DATABASE_URL ?? '');
  try {
    const snapshot = snapshotSchema.parse(await jsonFile(new URL('snapshot.json', cache)));
    const publication = await beginPublication(db, snapshot);
    await saveJson(new URL('publication.json', cache), { ...publication, ...manifestOf(snapshot) });
    console.log(`开始发布：已撤回 ${publication.withdrawn} 篇不再公开的文章；其他旧知识继续服务。`);
    await saveJson(new URL('release.json', cache), { commit, ...publication, phase: 'withdrawn' });
    const generated = await generate();
    const manifest = await stage(db, generated.artifact);
    await saveJson(new URL('release.json', cache), { commit, ...manifest, phase: 'staged' });
    await git('push', 'origin', 'HEAD:refs/heads/main');
    console.log('GitHub 已推送，等待网站部署为匹配的内容版本；当前知识版本保持不变。');
    const origin = env.SITE_ORIGIN ?? 'https://belluna.love';
    const deadline = Date.now() + 20 * 60000;
    while (true) {
      try {
        await verifyDeployment(origin, manifest);
        break;
      } catch {
        if (Date.now() >= deadline) throw new Error('等待部署超时，请稍后运行 knowledge:activate');
        console.log('网站尚未出现对应知识指纹，15 秒后继续检查。');
        await new Promise((resolve) => setTimeout(resolve, 15000));
      }
    }
    if ((await git('rev-parse', 'HEAD')) !== commit || (await git('status', '--porcelain')))
      throw new Error('等待期间本地内容改变，请重新检查发布');
    await activate(db, manifest.version, publication.previousVersion, new Date(), publication.sequence);
    await saveJson(new URL('release.json', cache), { commit, ...manifest, phase: 'active' });
    console.log(`博客和知识库已发布，知识版本 ${manifest.version}。`);
    try {
      await cleanup(db);
    } catch {
      console.warn('旧版本清理待重试，可运行 knowledge:cleanup。');
    }
  } finally {
    await db.close();
  }
}
main().catch((error: unknown) => {
  const safe = error instanceof Error && /^(请|等待|网站|知识|Another|Database|Incomplete)/.test(error.message);
  console.error(safe ? (error as Error).message : '发布未完成，请检查 Git、Vercel 部署和数据库配置；现有线上服务没有被删除。');
  process.exitCode = 1;
});
