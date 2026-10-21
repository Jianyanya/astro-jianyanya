import type { Root, Text } from 'mdast';
import type { Transformer } from 'unified';
import type { Node, Parent } from 'unist';
import { visit } from 'unist-util-visit';

/**
 * Safety net for remarkDirective: unknown *inline* text directives (`:名称`)
 * would otherwise be rendered as empty elements, silently dropping content —
 * e.g. the Chinese sentence `沉到这里去:我自己的数据…` parses as a directive.
 * This converts textDirective nodes back to literal text so nothing is lost.
 * Container/leaf directives (`:::name`, used by the encrypted block) are untouched.
 */
function nodeToText(node: Node): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  let text = '';
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children as Node[]) text += nodeToText(child);
  }
  return text;
}

export function remarkTextDirectiveLiteral(): Transformer<Root> {
  return (tree) => {
    visit(tree, (node, index, parent) => {
      if (node.type !== 'textDirective' || !parent || index === undefined) return;
      const label = 'label' in node && typeof node.label === 'string' && node.label ? `[${node.label}]` : nodeToText(node);
      const name = 'name' in node && typeof node.name === 'string' ? node.name : '';
      const literal: Text = { type: 'text', value: `:${name}${label}` };
      (parent as Parent).children.splice(index, 1, literal);
      return index + 1;
    });
  };
}
