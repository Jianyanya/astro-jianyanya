import { database } from '../../src/server/lingyue/database.js';
import { localEnv } from './files.js';
import { withdrawDocument } from './withdrawals.js';

async function main() {
  const id = process.argv.find((arg) => arg.startsWith('--id='))?.slice(5);
  if (!id) throw new Error('请用 knowledge:withdraw --id=文章ID 指定需要撤回的文章');
  const env = await localEnv();
  const db = database(env.KNOWLEDGE_DATABASE_URL ?? '');
  try {
    await withdrawDocument(db, id);
    console.log('文章已从后续检索撤回；旧发布凭据失效。恢复需要重新发布完整公开版本。');
  } finally {
    await db.close();
  }
}
main().catch(() => {
  console.error('撤回未完成，请检查文章ID和数据库配置。');
  process.exitCode = 1;
});
