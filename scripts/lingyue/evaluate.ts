import { Retrieval } from '../../src/server/lingyue/retrieval.js';
import { hash } from '../../src/server/lingyue/text.js';
import { ensureTokenizers } from '../../src/server/lingyue/tokenization.js';
import type { Chunk } from '../../src/server/lingyue/types.js';
import { type EvaluationCase, metrics, normalize } from './evaluation-metrics.js';
import { evaluationProvider } from './evaluation-provider.js';
import { evaluationStore } from './evaluation-store.js';
import { cache, jsonFile, localFileURL, saveJson } from './files.js';
import { chunkDocument } from './markdown.js';
import type { Prepared } from './prepared.js';

const argument = (name: string, fallback: string) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
async function main() {
  await ensureTokenizers('bge', 'chat');
  const split = argument('split', 'dev');
  if (!['dev', 'holdout'].includes(split)) throw new Error('Select dev or holdout explicitly');
  const file = localFileURL(argument('prepared', '.cache/lingyue/prepared.json'));
  const prepared = (await jsonFile(file)) as Prepared;
  const chunksFile = argument('chunks', '');
  const chunks = chunksFile
    ? ((await jsonFile(localFileURL(chunksFile))) as Chunk[])
    : prepared.snapshot.documents.flatMap(chunkDocument);
  const dataset = (await jsonFile(new URL('../../evaluation/lingyue/cases.json', import.meta.url))) as {
    cases: EvaluationCase[];
  };
  for (const item of dataset.cases)
    for (const gold of item.evidence) {
      const doc = prepared.snapshot.documents.find((document) => document.id === gold.documentId);
      if (!doc || !normalize(doc.body).includes(normalize(gold.quote))) throw new Error(`Stale evidence label: ${item.id}`);
    }
  const { providers, calls } = await evaluationProvider();
  const database = await evaluationStore(chunks, prepared.vectors);
  const retrieval = new Retrieval(database.store, providers, providers.c);
  const rows: Array<Record<string, unknown>> = [];
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  try {
    for (const item of dataset.cases.filter((item) => item.split === split)) {
      let trace: Parameters<NonNullable<Parameters<Retrieval['find']>[2]>>[0] | undefined;
      const start = Date.now();
      const result = await retrieval.find(
        { message: item.question, history: [], requestId: item.id },
        AbortSignal.timeout(90000),
        (value) => {
          trace = value;
        },
      );
      if (result.degraded.length) throw new Error(`Provider degraded on ${item.id}; do not report as a valid live evaluation`);
      const ranked = (ids: string[]) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
      let sources = result.sources.map((source) => ({
        documentId: source.documentId!,
        chunkId: source.chunkId,
        heading: source.heading,
        title: source.title,
        text: source.text,
      }));
      if (argument('policy', 'current') === 'legacy') {
        let size = 0;
        sources = [];
        for (const { chunk } of trace?.reranked ?? []) {
          const room = 6500 - size;
          if (room < 300 || sources.length >= 6) break;
          if (Buffer.byteLength(chunk.text, 'utf8') > room) continue;
          size += Buffer.byteLength(chunk.text + chunk.title + chunk.heading, 'utf8') + 100;
          sources.push({ ...chunk, chunkId: chunk.id });
        }
      }
      const positive = item.evidence.length > 0;
      rows.push({
        id: item.id,
        kind: item.kind,
        positive,
        milliseconds: Date.now() - start,
        keyword: positive ? metrics(ranked(trace?.keyword ?? []), item.evidence, 10, chunks) : undefined,
        fused: positive ? metrics(ranked(trace?.fused ?? []), item.evidence, 20, chunks) : undefined,
        reranked: positive
          ? metrics(
              (trace?.reranked ?? []).map((candidate) => candidate.chunk),
              item.evidence,
              6,
              chunks,
            )
          : undefined,
        selected: positive ? metrics(sources, item.evidence, 6, chunks) : undefined,
        accepted: sources.length,
        ids: sources.map((source) => source.chunkId),
        scores: trace?.reranked.map((candidate) => ({
          chunkId: candidate.chunk.id,
          documentId: candidate.chunk.documentId,
          score: candidate.score,
        })),
      });
      console.log(`评测 ${rows.length}：${item.id}，证据 ${sources.length}`);
    }
  } finally {
    await database.close();
  }
  const positive = rows.filter((row) => row.positive);
  const stages = ['keyword', 'fused', 'reranked', 'selected'];
  const summary = Object.fromEntries(
    stages.map((stage) => [
      stage,
      Object.fromEntries(
        ['recall', 'mrr', 'ndcg'].map((metric) => [
          metric,
          positive.reduce((sum, row) => sum + Number((row[stage] as Record<string, number>)[metric]), 0) /
            Math.max(1, positive.length),
        ]),
      ),
    ]),
  );
  const negatives = Object.fromEntries(
    ['unrelated', 'missing-detail'].map((kind) => {
      const group = rows.filter((row) => row.kind === kind);
      return [
        kind,
        {
          count: group.length,
          evidenceAcceptanceRate: group.filter((row) => Number(row.accepted) > 0).length / Math.max(1, group.length),
        },
      ];
    }),
  );
  const label = argument('label', 'current').replace(/[^a-z0-9_-]/gi, '_');
  const report = {
    schema: 1,
    label,
    split,
    created: new Date().toISOString(),
    datasetHash: hash(JSON.stringify(dataset)),
    snapshotHash: hash(JSON.stringify(prepared.snapshot)),
    policy: argument('policy', 'current'),
    embeddingModel: providers.c.EMBEDDING_MODEL,
    reranker: providers.c.RERANK_MODEL,
    labelReview: 'assistant-curated; owner evidence review pending',
    documents: prepared.snapshot.documents.length,
    chunks: chunks.length,
    cases: rows.length,
    positives: positive.length,
    calls: calls(),
    summary,
    negatives,
    rows,
  };
  await saveJson(new URL(`evaluation-${label}-${split}.json`, cache), report);
  console.log(JSON.stringify({ ...report, rows: undefined }));
}
main().catch((error) => {
  console.error(
    '评测未完成；检查本地向量、标签和模型连接。',
    error instanceof Error && /^(Stale evidence|Provider degraded|Evaluation vectors|Select dev)/.test(error.message)
      ? error.message
      : '',
  );
  process.exitCode = 1;
});
