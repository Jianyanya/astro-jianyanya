import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Tokenizer } from '@huggingface/tokenizers';
import type { TokenizerKind } from './tokenizer-manifest.js';
import type { Message } from './types.js';

const loaded: Partial<Record<TokenizerKind, Tokenizer>> = {};
const pending: Partial<Record<TokenizerKind, Promise<void>>> = {};
async function data(file: string) {
  for (const directory of ['.cache/lingyue/tokenizers', '.belluna-tokenizers']) {
    try {
      return JSON.parse(await readFile(resolve(process.cwd(), directory, file), 'utf8')) as object;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Tokenizer artifacts missing; run pnpm knowledge:tokenizers');
}
/** Loads only vocabularies. Production chat never loads BGE or any model weights. */
export async function ensureTokenizers(...kinds: TokenizerKind[]) {
  await Promise.all(
    kinds.map(async (kind) => {
      if (loaded[kind]) return;
      pending[kind] ??= Promise.all([data(`${kind}.json`), data(`${kind}.config.json`)])
        .then(([model, config]) => {
          loaded[kind] = new Tokenizer(model, config);
        })
        .catch((error) => {
          delete pending[kind];
          throw error;
        });
      await pending[kind];
    }),
  );
}
function count(kind: TokenizerKind, text: string) {
  const tokenizer = loaded[kind];
  if (!tokenizer) throw new Error('Tokenizer is not initialized');
  return tokenizer.encode(text, { add_special_tokens: kind === 'bge' }).ids.length;
}
export const embeddingTokens = (text: string) => count('bge', text);
export const chatTokens = (text: string) => count('chat', text);
/** Exact text tokenization; reserve separately for the provider's chat envelope/system additions. */
export function messageTokens(messages: Array<Message | { role: 'system'; content: string }>) {
  return messages.reduce((total, message) => total + chatTokens(message.content), 256 + messages.length * 16);
}
