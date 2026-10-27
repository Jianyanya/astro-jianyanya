import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

export const root = new URL('../../', import.meta.url);
export const cache = new URL('.cache/lingyue/', root);
export const localFileURL = (path: string) => pathToFileURL(resolve(path));
export async function localEnv() {
  const files: Record<string, string | undefined>[] = [];
  for (const file of [new URL('../.env', root), new URL('.env', root), new URL('.env.local', root)]) {
    try {
      files.push(parseEnv(await readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取本地配置。');
    }
  }
  return { ...Object.assign({}, ...files), ...process.env } as Record<string, string | undefined>;
}
export async function jsonFile(file: URL): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}
export async function saveJson(file: URL, value: unknown) {
  await mkdir(new URL('.', file), { recursive: true });
  const temporary = new URL(`${file.pathname.split('/').at(-1)}.tmp`, file);
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, file);
}
