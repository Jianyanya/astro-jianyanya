import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { localEnv, root } from './files.js';

async function main() {
  const env = await localEnv();
  const file = new URL('.env.local', root);
  let contents = '';
  try {
    contents = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const existing = parseEnv(contents);
  const keys = [
    'CHAT_BASE_URL',
    'CHAT_MODEL',
    'CHAT_API_KEY',
    'SILICONFLOW_API_KEY',
    'COOKIE_SECRET',
    'CHAT_INPUT_USD_PER_MILLION',
    'CHAT_OUTPUT_USD_PER_MILLION',
    'DAILY_VISITOR_LIMIT',
    'DAILY_IP_LIMIT',
    'DAILY_GLOBAL_LIMIT',
    'DAILY_BUDGET_CNY',
    'MONTHLY_BUDGET_CNY',
    'MAX_CONCURRENT',
  ];
  const added = keys.filter((key) => !existing[key] && env[key]);
  for (const key of added) contents += `\n${key}=${JSON.stringify(env[key])}`;
  if (!existing.SITE_ORIGIN) contents += '\nSITE_ORIGIN=https://belluna.love';
  await writeFile(file, `${contents.trimEnd()}\n`);
  console.log(`已准备 ${added.length} 项服务端配置；没有输出或上传凭据。`);
}
main().catch(() => {
  console.error('本机配置准备失败，请检查 .env 文件。');
  process.exitCode = 1;
});
