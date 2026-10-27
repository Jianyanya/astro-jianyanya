import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { TOKENIZERS, type TokenizerKind } from '../../src/server/lingyue/tokenizer-manifest.js';
import { cache } from './files.js';
import { closePublicNetwork, fetchPublic } from './network.js';

const directory = new URL('tokenizers/', cache);
const valid = (bytes: Buffer, file: { algorithm: string; digest: string }) => {
  const digest =
    file.algorithm === 'git'
      ? createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
      : createHash('sha256').update(bytes).digest('hex');
  return digest === file.digest;
};
try {
  await mkdir(directory, { recursive: true });
  const kinds: TokenizerKind[] = process.env.VERCEL === '1' && !process.argv.includes('--all') ? ['chat'] : ['bge', 'chat'];
  for (const kind of kinds) {
    const model = TOKENIZERS[kind];
    for (const file of model.files) {
      const target = new URL(file.local, directory);
      const existing = await readFile(target).catch(() => undefined);
      if (existing && valid(existing, file)) continue;
      const response = await fetchPublic(`https://huggingface.co/${model.model}/resolve/${model.revision}/${file.source}`);
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Tokenizer download failed');
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!valid(bytes, file)) throw new Error('Tokenizer checksum mismatch');
      const temp = new URL(`${file.local}.tmp`, directory);
      await writeFile(temp, bytes);
      await rename(temp, target);
      console.log(`Tokenizer ready: ${kind}/${file.source}`);
    }
  }
} catch {
  console.error('Tokenizer 准备失败；请检查官方 Hugging Face 网络连接/本机代理，已有文件保留。');
  process.exitCode = 1;
} finally {
  await closePublicNetwork();
}
