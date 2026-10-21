import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { memo, useMemo } from 'react';

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // Replies support Markdown, not arbitrary HTML or remote image requests.
    html: () => '',
    image: () => '',
    checkbox: ({ checked }) => (checked ? '☑ ' : '☐ '),
  },
});

function renderMarkdown(text: string): string {
  // Conversation history is restored after mounting; no browser DOM exists during SSR.
  if (typeof window === 'undefined') return '';
  const fragment = DOMPurify.sanitize(markdown.parse(text, { async: false }), {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: [
      'p',
      'br',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'strong',
      'em',
      'del',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'hr',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    ALLOWED_ATTR: ['href', 'title', 'start', 'align'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  for (const link of fragment.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    try {
      const url = new URL(href, window.location.href);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
        link.removeAttribute('href');
        continue;
      }
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    } catch {
      link.removeAttribute('href');
    }
  }
  for (const table of fragment.querySelectorAll('table')) {
    const scroll = document.createElement('div');
    scroll.className = 'lingyue-table';
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', '表格，可横向滚动');
    table.replaceWith(scroll);
    scroll.append(table);
  }
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

// Older replies do not need reparsing while the newest reply streams in.
export const MessageBody = memo(function MessageBody({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown output is sanitized with a tag/attribute allowlist above.
  return <div className="lingyue-prose" dangerouslySetInnerHTML={{ __html: html }} />;
});
