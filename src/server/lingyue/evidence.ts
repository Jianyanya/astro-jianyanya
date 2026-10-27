import { chatTokens } from './tokenization.js';
import type { Chunk, Source } from './types.js';

// Calibrate only on the development split; scores measure relevance, not answerability.
const EVIDENCE_POLICY = { minimumScore: 0.1, relativeFloor: 0.15, maximum: 6, tokens: 3500 } as const;
export interface Candidate {
  chunk: Chunk;
  score?: number;
}
function shingles(text: string) {
  const chars = [...text.toLowerCase().replace(/\s+/g, '')];
  return new Set(chars.slice(0, -3).map((_, index) => chars.slice(index, index + 4).join('')));
}
function duplicate(a: Chunk, b: Chunk) {
  if (a.hash === b.hash) return true;
  if (a.documentId !== b.documentId) return false;
  const left = shingles(a.text);
  const right = shingles(b.text);
  const shared = [...left].filter((item) => right.has(item)).length;
  return shared / Math.max(1, left.size + right.size - shared) >= 0.8;
}

export function selectEvidence(candidates: Candidate[], options: { scoped?: boolean; coverage?: boolean } = {}): Source[] {
  const top = Math.max(0, ...candidates.map((item) => item.score ?? 0));
  const selected: Chunk[] = [];
  let tokens = 0;
  for (const { chunk, score } of candidates) {
    if (
      !options.coverage &&
      score !== undefined &&
      score < Math.max(EVIDENCE_POLICY.minimumScore, top * EVIDENCE_POLICY.relativeFloor)
    )
      continue;
    // Without reranking scores, use a small conservative fallback rather than filling six slots.
    if (score === undefined && !options.coverage && selected.length >= 2) break;
    if (selected.length >= EVIDENCE_POLICY.maximum) break;
    if (selected.some((previous) => duplicate(previous, chunk))) continue;
    if (!options.scoped && selected.filter((previous) => previous.documentId === chunk.documentId).length >= 3) continue;
    const cost = chatTokens(`[S${selected.length + 1}] ${chunk.title} / ${chunk.heading}\n${chunk.text}\n\n`);
    if (tokens + cost > EVIDENCE_POLICY.tokens) continue;
    tokens += cost;
    selected.push(chunk);
  }
  return selected.map((chunk, index) => ({
    id: `S${index + 1}`,
    documentId: chunk.documentId,
    chunkId: chunk.id,
    title: chunk.title,
    heading: chunk.heading,
    url: chunk.url,
    text: chunk.text,
  }));
}
