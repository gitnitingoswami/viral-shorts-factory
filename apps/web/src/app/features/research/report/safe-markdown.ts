/**
 * Minimal, safe Markdown → block model. The output is plain data rendered with Angular
 * interpolation only (never innerHTML), so any HTML in the source stays literal text.
 * Links are kept only for absolute http/https URLs; everything else renders as text.
 */

export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'link'; text: string; href: string };

export type MdBlock =
  | { kind: 'heading'; level: number; inlines: MdInline[] }
  | { kind: 'paragraph'; inlines: MdInline[] }
  | { kind: 'list'; ordered: boolean; items: MdInline[][] }
  | { kind: 'quote'; inlines: MdInline[] }
  | { kind: 'pre'; text: string }
  | { kind: 'rule' };

/** Returns a normalized href for absolute http(s) URLs, otherwise null. */
export function safeHref(raw: string): string | null {
  const value = raw.trim();
  // Require an explicit scheme so relative or protocol-relative links are not resolved against the app.
  if (!/^https?:\/\//i.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const INLINE = /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;

export function parseInline(source: string): MdInline[] {
  const out: MdInline[] = [];
  let last = 0;
  const pushText = (text: string): void => {
    if (!text) {
      return;
    }
    const prev = out[out.length - 1];
    if (prev?.kind === 'text') {
      prev.text += text;
    } else {
      out.push({ kind: 'text', text });
    }
  };
  for (const m of source.matchAll(INLINE)) {
    const index = m.index ?? 0;
    pushText(source.slice(last, index));
    const [whole, linkText, linkHref, code, strong] = m;
    if (linkText !== undefined && linkHref !== undefined) {
      const href = safeHref(linkHref);
      if (href) {
        out.push({ kind: 'link', text: linkText, href });
      } else {
        pushText(linkText);
      }
    } else if (code !== undefined) {
      out.push({ kind: 'code', text: code });
    } else if (strong !== undefined) {
      out.push({ kind: 'strong', text: strong });
    } else {
      pushText(whole);
    }
    last = index + whole.length;
  }
  pushText(source.slice(last));
  return out;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const TABLE = /^\s*\|/;

export function parseMarkdown(markdown: string): MdBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: MdInline[][] } | null = null;

  const flush = (): void => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', inlines: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      blocks.push({ kind: 'pre', text: body.join('\n') });
      continue;
    }
    if (TABLE.test(line)) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && TABLE.test(lines[i])) {
        rows.push(lines[i].trim());
        i++;
      }
      i--;
      blocks.push({ kind: 'pre', text: rows.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1].length, inlines: parseInline(heading[2]) });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    const item = bullet ?? ordered;
    if (item) {
      const isOrdered = ordered !== null;
      if (paragraph.length || (list && list.ordered !== isOrdered)) {
        flush();
      }
      list ??= { ordered: isOrdered, items: [] };
      list.items.push(parseInline(item[1]));
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      blocks.push({ kind: 'quote', inlines: parseInline(quote[1]) });
      continue;
    }
    if (list) {
      // Lazy continuation of the previous list item.
      const items: MdInline[][] = list.items;
      items[items.length - 1] = [...items[items.length - 1], ...parseInline(` ${line.trim()}`)];
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
