export interface Evidence {
  documentId: string;
  quote: string;
}
export interface EvaluationCase {
  id: string;
  split: 'dev' | 'holdout';
  kind: string;
  question: string;
  answer: string;
  evidence: Evidence[];
}
export const normalize = (value: string) => value.normalize('NFKC').replace(/[`*_~\s]/g, '');

/** Evidence-level recall counts annotated facts, not every near-duplicate chunk as another relevant result. */
type Passage = { documentId: string; text: string; heading?: string; title?: string };
export function metrics(ranked: Passage[], evidence: Evidence[], k: number, pool = ranked) {
  const hit = (item: Passage, gold: Evidence) =>
    item.documentId === gold.documentId &&
    normalize(`${item.title ?? ''}\n${item.heading ?? ''}\n${item.text}`).includes(normalize(gold.quote));
  const ranks = evidence.map((gold) => ranked.findIndex((item) => hit(item, gold)) + 1);
  const recall = ranks.filter((rank) => rank > 0 && rank <= k).length / Math.max(1, evidence.length);
  const first = Math.min(...ranks.filter((rank) => rank > 0));
  const relevant = (item: Passage) => evidence.some((gold) => hit(item, gold));
  const dcg = ranked.slice(0, k).reduce((total, item, index) => total + (relevant(item) ? 1 / Math.log2(index + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(k, pool.filter(relevant).length) }, (_, i) => 1 / Math.log2(i + 2)).reduce(
    (a, b) => a + b,
    0,
  );
  return { recall, mrr: first <= k ? 1 / first : 0, ndcg: ideal ? dcg / ideal : 0 };
}
