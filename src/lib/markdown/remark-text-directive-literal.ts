import type { Plugin } from 'unified';
import type { Nodes, Parent } from 'unist';
import { visit } from 'unist-util-visit';

/**
 * Safety net for remarkDirective: unknown *inline* text directives (`:名称`)
 * would otherwise be rendered as empty elements, silently dropping content —
 * e.g. the Chinese sentence `沉到这里去:我自己的数据…` parses as a directive.
 * This converts textDirective nodes back to literal text so nothing is lost.
 * Container/leaf directives (`:::name`, used by the encrypted block) are untouched.
 */
function nodeToText(node: Nodes): string {
  if (node.type === 'text') return node.value;
  if ('value' in node && typeof node.value === 'string') return node.value;
  let text = '';
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children as Nodes[]) text += nodeToText(child);
  }
  return text;
}

export function remarkTextDirectiveLiteral(): Plugin {
  return (tree) => {
    visit(tree, (node, index, parent) => {
      if (node.type !== 'textDirective' || !parent || index === undefined) return;
      const label = typeof node.label === 'string' && node.label ? `[${node.label}]` : nodeToText(node);
      const literal = `:${node.name}${label}`;
      (parent as Parent).children.splice(index, 1, { type: 'text', value: literal });
      return index + 1;
    });
  };
}
