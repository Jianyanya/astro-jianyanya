import { z } from 'zod';
import { manifestOf, snapshotSchema } from '../../src/server/lingyue/manifest.js';
import { embeddingText, hash } from '../../src/server/lingyue/text.js';
import { chunkDocument } from './markdown.js';

export const vectorSchema = z
  .array(z.number().finite())
  .length(1024)
  .refine((v) => v.some((n) => n !== 0));
export const cacheKey = (hashValue: string) => hash(`BAAI/bge-m3:${hashValue}`);
const schema = z.object({ snapshot: snapshotSchema, vectors: z.record(vectorSchema) });
export type Prepared = z.infer<typeof schema>;
export function validatePrepared(value: unknown) {
  const artifact = schema.parse(value);
  const chunks = artifact.snapshot.documents.flatMap(chunkDocument);
  for (const chunk of chunks) if (!artifact.vectors[cacheKey(chunk.hash)]) throw new Error('知识向量缺失，请重新生成。');
  return { artifact, chunks, manifest: manifestOf(artifact.snapshot) };
}
export { embeddingText };
