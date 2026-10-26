import { z } from 'zod';
import { hash, PIPELINE_VERSION } from './text.js';

export const snapshotSchema = z
  .object({
    schema: z.literal(1),
    documents: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string(),
        body: z.string(),
        locale: z.string(),
        tags: z.array(z.string()),
        url: z
          .string()
          .startsWith('/')
          .refine((s) => !s.startsWith('//') && !/[\\\p{Cc}]/u.test(s)),
      }),
    ),
  })
  .superRefine((s, ctx) => {
    if (new Set(s.documents.map((d) => d.id)).size !== s.documents.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate document' });
  });
export type Snapshot = z.infer<typeof snapshotSchema>;
export function manifestOf(value: unknown) {
  const snapshot = snapshotSchema.parse(value);
  const digest = hash(JSON.stringify([PIPELINE_VERSION, 'BAAI/bge-m3', snapshot]));
  return { schema: 1 as const, version: digest.slice(0, 24), hash: digest, documents: snapshot.documents.length };
}
