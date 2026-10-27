import { randomBytes } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { database } from '../../src/server/lingyue/database.js';
import { localEnv, root } from './files.js';

async function main() {
  const env = await localEnv();
  const connection = env.KNOWLEDGE_DATABASE_URL ?? '';
  const db = database(connection);
  try {
    await db.transaction(async (tx) => {
      const directory = new URL('migrations/lingyue/', root);
      for (const file of (await readdir(directory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort())
        await tx.query(await readFile(new URL(file, directory), 'utf8'));
    });
    const exists = await db.query("SELECT rolname FROM pg_roles WHERE rolname='lingyue_runtime'");
    let runtimeUrl: string | undefined;
    if (!exists.length) {
      const password = randomBytes(32).toString('hex');
      await db.query(`CREATE ROLE lingyue_runtime LOGIN PASSWORD '${password}'`);
      const url = new URL(connection);
      url.username = 'lingyue_runtime';
      url.password = password;
      runtimeUrl = url.toString();
    } else if (!env.DATABASE_URL) throw new Error('运行角色已存在，请恢复先前保存的 DATABASE_URL；脚本不会重置其密码。');
    await db.query(`GRANT USAGE ON SCHEMA lingyue TO lingyue_runtime;
      GRANT SELECT ON lingyue.control,lingyue.chunks TO lingyue_runtime;
      GRANT SELECT ON lingyue.withdrawals TO lingyue_runtime;
      GRANT SELECT,INSERT,UPDATE,DELETE ON lingyue.requests TO lingyue_runtime;
      GRANT SELECT,INSERT,DELETE ON lingyue.auth_sessions TO lingyue_runtime;
      GRANT SELECT,UPDATE ON lingyue.quota_lock TO lingyue_runtime;`);
    if (runtimeUrl) {
      const file = new URL('.env.local', root);
      let contents = '';
      try {
        contents = await readFile(file, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      contents = contents.replace(/^DATABASE_URL=.*(?:\r?\n|$)/gm, '');
      await writeFile(file, `${contents.trimEnd()}\nDATABASE_URL=${JSON.stringify(runtimeUrl)}\n`);
    }
    console.log('数据库初始化完成。受限运行账号已配置；连接串仅保存在本机 .env.local。');
  } finally {
    await db.close();
  }
}
main().catch(() => {
  console.error('数据库初始化未完成，请检查 KNOWLEDGE_DATABASE_URL 和账号权限；不会输出连接串或重置已有密码。');
  process.exitCode = 1;
});
