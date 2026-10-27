import { createHash } from 'node:crypto';
import type { Chunk } from './types.js';
export const PIPELINE_VERSION = 'markdown-v2-bge5617a9f-tokens512-sentence-code';
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

export function terms(s: string): string[] {
  const words = [...segmenter.segment(s.toLowerCase())].filter((x) => x.isWordLike).map((x) => x.segment);
  const identifiers = s.toLowerCase().match(/[a-z0-9_][a-z0-9_./:+-]*/g) ?? [];
  const bigrams = (s.match(/[\p{Script=Han}]+/gu) ?? []).flatMap((run) => {
    const chars = [...run];
    return chars.slice(0, -1).map((c, i) => c + chars[i + 1]);
  });
  return [...new Set([...words, ...identifiers, ...bigrams])];
}

export const embeddingText = (chunk: Pick<Chunk, 'title' | 'heading' | 'text'>) =>
  `文章：${chunk.title}\n章节：${chunk.heading}\n${chunk.text}`;

export function rrf(lists: string[][], k = 60): string[] {
  const scores = new Map<string, number>();
  for (const list of lists)
    for (const [index, id] of [...new Set(list)].entries()) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    }
  return [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

export const VECTOR_NAMESPACE = 'bge-m3-markdown-v1';
