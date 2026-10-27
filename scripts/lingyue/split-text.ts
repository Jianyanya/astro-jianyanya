/** Prefer complete sentences/lines; only split a word or code line when it cannot fit by itself. */
export function splitText(text: string, limit: number, measure: (text: string) => number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest) {
    if (measure(rest) <= limit) {
      parts.push(rest);
      break;
    }
    const chars = [...rest];
    let low = 0;
    let high = chars.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (measure(chars.slice(0, mid).join('')) <= limit) low = mid;
      else high = mid - 1;
    }
    if (!low) throw new Error('Chunk metadata exceeds token budget');
    let prefix = chars.slice(0, low).join('');
    const boundaries = [...prefix.matchAll(/[。！？!?；;]\s*|\n+|\.\s+|\s+/g)];
    const preferred = boundaries.filter((match) => match.index! + match[0].length >= prefix.length * 0.6).at(-1);
    if (preferred) prefix = prefix.slice(0, preferred.index! + preferred[0].length);
    // BPE counts are not strictly monotone; validate the chosen natural boundary too.
    while (measure(prefix) > limit) prefix = [...prefix].slice(0, -1).join('');
    if (!prefix) throw new Error('Cannot fit text into token budget');
    parts.push(prefix);
    rest = rest.slice(prefix.length);
  }
  return parts;
}

export function trailingSentence(text: string, limit: number, measure: (text: string) => number) {
  const sentences = text.match(/[^。！？!?\n]+[。！？!?](?:\s*)|[^\n]+\n/g) ?? [];
  const last = sentences.at(-1)?.trim() ?? '';
  return last && text.trimEnd().endsWith(last) && measure(last) <= limit ? last : '';
}

export function fenced(code: string, language: string) {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${code}\n${fence}`;
}
