import type { RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { embeddingText, hash, PIPELINE_VERSION } from '../../src/server/lingyue/text.js';
import { embeddingTokens } from '../../src/server/lingyue/tokenization.js';
import type { Chunk, Document } from '../../src/server/lingyue/types.js';
import { fenced, splitText, trailingSentence } from './split-text.js';

export { PIPELINE_VERSION } from '../../src/server/lingyue/text.js';
export const CHUNK_TOKENS = 512;
interface Block {
  text: string;
  start: number;
  end: number;
  code: boolean;
  continuation: boolean;
}
type Positioned = {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: Positioned[];
};
function rawNode(doc: Document, node: Positioned) {
  const start = node.position?.start.offset ?? 0;
  const end = node.position?.end.offset ?? start;
  let text = doc.body.slice(start, end);
  const html: Array<{ start: number; end: number }> = [];
  const visit = (child: Positioned) => {
    if (child.type === 'html')
      html.push({ start: child.position?.start.offset ?? start, end: child.position?.end.offset ?? start });
    else child.children?.forEach(visit);
  };
  visit(node);
  for (const range of html.sort((a, b) => b.start - a.start))
    text = text.slice(0, range.start - start) + text.slice(range.end - start);
  return text.trim();
}

/** Markdown boundaries first, sentence boundaries second, token cutoff only as a last resort. */
export function chunkDocument(doc: Document): Chunk[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(doc.body);
  const chunks: Chunk[] = [];
  const headings: string[] = [];
  const occurrences = new Map<string, number>();
  let heading = '';
  let pending: Block[] = [];
  const measure = (text: string) => embeddingTokens(embeddingText({ title: doc.title, heading, text }));
  const flush = () => {
    if (!pending.length) return;
    const text = pending
      .map((block) => block.text)
      .join('\n\n')
      .trim();
    if (!text) {
      pending = [];
      return;
    }
    const contentHash = hash(`${PIPELINE_VERSION}\n${doc.title}\n${heading}\n${text}`);
    const occurrence = occurrences.get(contentHash) ?? 0;
    occurrences.set(contentHash, occurrence + 1);
    chunks.push({
      id: hash(`${doc.id}:${contentHash}:${occurrence}`),
      documentId: doc.id,
      ordinal: chunks.length,
      title: doc.title,
      heading,
      url: doc.url,
      locale: doc.locale,
      tags: doc.tags,
      text,
      hash: contentHash,
      embeddingTokens: measure(text),
      kind: pending.every((b) => b.code) ? 'code' : pending.some((b) => b.code) ? 'mixed' : 'text',
      continuation: pending.some((b) => b.continuation),
      sourceStart: Math.min(...pending.map((b) => b.start)),
      sourceEnd: Math.max(...pending.map((b) => b.end)),
    });
    pending = [];
  };
  const append = (block: Block) => {
    const combined = [...pending.map((b) => b.text), block.text].join('\n\n');
    if (pending.length && measure(combined) > CHUNK_TOKENS) {
      const previous = pending.at(-1)!;
      const overlap = !previous.code && !block.code ? trailingSentence(previous.text, 48, embeddingTokens) : '';
      flush();
      if (overlap && measure(`${overlap}\n\n${block.text}`) <= CHUNK_TOKENS) pending.push({ ...previous, text: overlap });
    }
    pending.push(block);
  };
  const blocks = (node: RootContent): Block[] => {
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? start;
    const block = (text: string, code = false, continuation = false): Block => ({ text, start, end, code, continuation });
    if (node.type === 'code') {
      const wrap = (part: string) => fenced(part, node.lang ?? '');
      if (measure(wrap(node.value)) <= CHUNK_TOKENS) return [block(wrap(node.value), true)];
      const label = '代码分段（需结合原文上下文）：\n';
      return splitText(node.value, CHUNK_TOKENS, (part) => measure(label + wrap(part))).map((part) =>
        block(label + wrap(part), true, true),
      );
    }
    const raw = rawNode(doc, node);
    if (!raw) return [];
    if (measure(raw) <= CHUNK_TOKENS) return [block(raw)];
    if (node.type === 'list')
      return node.children.flatMap((item) => splitText(rawNode(doc, item), CHUNK_TOKENS, measure).map((part) => block(part)));
    if (node.type === 'table') {
      const lines = raw.split('\n');
      const header = lines.slice(0, 2).join('\n');
      const result: Block[] = [];
      let table = header;
      for (const line of lines.slice(2)) {
        if (measure(`${table}\n${line}`) <= CHUNK_TOKENS) {
          table += `\n${line}`;
          continue;
        }
        if (table !== header) result.push(block(table));
        table = header;
        if (measure(`${header}\n${line}`) <= CHUNK_TOKENS) table += `\n${line}`;
        else {
          const label = '表格行分段（列标题见原文）：\n';
          result.push(
            ...splitText(`${header}\n${line}`, CHUNK_TOKENS, (part) => measure(label + part)).map((part) =>
              block(label + part, false, true),
            ),
          );
        }
      }
      if (table !== header) result.push(block(table));
      return result;
    }
    return splitText(raw, CHUNK_TOKENS, measure).map((part) => block(part));
  };
  for (const node of tree.children) {
    if (node.type === 'heading') {
      flush();
      headings.length = node.depth - 1;
      headings[node.depth - 1] = rawNode(doc, node)
        .replace(/^#+\s*/, '')
        .replace(/\s+#+$/, '');
      heading = headings.filter(Boolean).join(' / ');
    } else if (node.type !== 'html' && node.type !== 'definition') {
      for (const block of blocks(node)) append(block);
    }
  }
  flush();
  return chunks;
}
