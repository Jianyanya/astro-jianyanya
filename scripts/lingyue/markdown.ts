import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { hash, PIPELINE_VERSION, tokenBound } from '../../src/server/lingyue/text.js';
import type { Chunk, Document } from '../../src/server/lingyue/types.js';

export { PIPELINE_VERSION } from '../../src/server/lingyue/text.js';

export function chunkDocument(doc: Document): Chunk[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(doc.body);
  const headings: string[] = [];
  const chunks: Chunk[] = [];
  let pending = '';
  let pendingHeading = '';
  const push = () => {
    if (!pending.trim()) return;
    const ordinal = chunks.length;
    const contentHash = hash(`${PIPELINE_VERSION}\n${doc.title}\n${pendingHeading}\n${pending}`);
    chunks.push({
      id: hash(`${doc.id}:${ordinal}:${contentHash}`),
      documentId: doc.id,
      ordinal,
      title: doc.title,
      heading: pendingHeading,
      url: doc.url,
      locale: doc.locale,
      tags: doc.tags,
      text: pending.trim(),
      hash: contentHash,
    });
    pending = '';
  };
  for (const node of tree.children) {
    if (node.type === 'heading') {
      push();
      headings.length = node.depth - 1;
      headings[node.depth - 1] = doc.body.slice(node.position?.start.offset, node.position?.end.offset).replace(/^#+\s*/, '');
      pendingHeading = headings.filter(Boolean).join(' / ');
      continue;
    }
    // Never execute MDX/HTML. Strip raw tags while preserving prose, math and code fences.
    if (node.type === 'html' || node.type === 'definition') continue;
    const raw = doc.body.slice(node.position?.start.offset, node.position?.end.offset).trim();
    const blocks: string[] = [];
    if (node.type === 'code') {
      let part = '';
      for (const line of node.value.split('\n')) {
        // Split exceptionally long lines as well as long fenced blocks.
        const pieces = line.match(/.{1,600}/gu) ?? [''];
        for (const piece of pieces) {
          if (tokenBound(part + piece) > 1800 && part) {
            blocks.push(`\`\`\`${node.lang ?? ''}\n${part}\n\`\`\``);
            part = '';
          }
          part += `${piece}\n`;
        }
      }
      if (part) blocks.push(`\`\`\`${node.lang ?? ''}\n${part}\n\`\`\``);
    } else {
      const chars = [...raw];
      let part = '';
      for (const char of chars) {
        if (tokenBound(part + char) > 1800) {
          blocks.push(part);
          part = part.slice(-100);
        }
        part += char;
      }
      if (part) blocks.push(part);
    }
    for (const block of blocks) {
      if (tokenBound(pending + block) > 2100) push();
      pending += `${pending ? '\n\n' : ''}${block}`;
    }
  }
  push();
  return chunks;
}
