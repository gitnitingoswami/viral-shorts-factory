import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SceneCode } from '@vsf/contracts';
import { CAPTION, CODE, DESIGN_HEIGHT, DESIGN_WIDTH, fitText, HEADLINE, MONO_ADVANCE, TITLE_CARD } from './layout';

/** Version of the frame design; part of every frame's cache key and provenance. */
export const FRAME_RENDERER_REF = 'frame-renderer@1';
export const FONT_FAMILY = 'JetBrains Mono';
const TITLE_CARD_INDENT = 50;

/** Bundled fonts (SIL OFL 1.1, see assets/fonts/OFL.txt). Resolved from src/ (ts-jest) and dist/ (build) alike. */
export function fontsDir(): string {
  const candidates = [resolve(__dirname, '../../assets/fonts'), resolve(process.cwd(), 'assets/fonts'), resolve(process.cwd(), 'apps/api/assets/fonts')];
  const found = candidates.find((d) => existsSync(join(d, 'JetBrainsMono-Regular.ttf')));
  if (!found) throw new Error('Bundled fonts not found (assets/fonts)');
  return found;
}

export const FONT_FILES = ['JetBrainsMono-Regular.ttf', 'JetBrainsMono-Bold.ttf'] as const;

const COLORS = {
  bg1: '#0b1020',
  bg2: '#16213e',
  text: '#f8fafc',
  muted: '#94a3b8',
  accent: '#38bdf8',
  panel: '#111827',
  panelBorder: '#334155',
  highlight: '#1e3a5f',
  captionBg: '#000000',
  keyword: '#c084fc',
  string: '#86efac',
  number: '#fdba74',
  comment: '#64748b',
};

export interface FrameSpec {
  width: number;
  height: number;
  /** Short on-screen caption/headline from the storyboard. */
  headline: string;
  code: SceneCode | null;
  /** Caption lines (already wrapped), or null when captions are not burned in. */
  caption: string[] | null;
  /** 0..1 position of this frame in the video (top progress bar). */
  progress: number;
  sceneLabel: string;
}

export interface FrameLayoutNotes {
  /** Lines shortened with an ellipsis because they did not fit at the smallest code font size. */
  truncatedCodeLines: number;
  headlineFits: boolean;
  codeFontSize: number | null;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Non-breaking spaces keep indentation and runs of spaces (SVG collapses normal whitespace). */
const keepSpaces = (s: string): string => s.replace(/ /g, ' ');

const JS_KEYWORDS = new Set(
  'const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of void null undefined true false this super interface type enum implements readonly as satisfies keyof'.split(' '),
);
const SQL_KEYWORDS = new Set('select from where insert into values update set delete join left right inner outer on group by order having limit offset as and or not null create table index primary key returning with distinct count'.split(' '));

type Token = { text: string; color: string };

/** Minimal, deterministic highlighter (keywords, strings, numbers, comments); unknown languages stay plain. */
export function tokenizeLine(line: string, language: SceneCode['language']): Token[] {
  if (language === 'other') return [{ text: line, color: COLORS.text }];
  const commentStart = language === 'sql' ? '--' : language === 'shell' ? '#' : '//';
  const tokens: Token[] = [];
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while (i < line.length) {
    if (line.startsWith(commentStart, i)) {
      tokens.push({ text: line.slice(i), color: COLORS.comment });
      break;
    }
    re.lastIndex = i;
    m = re.exec(line);
    if (!m) break;
    const [text, str, num, word] = m;
    let color = COLORS.text;
    if (str) color = COLORS.string;
    else if (num) color = COLORS.number;
    else if (word) {
      const kw = language === 'sql' ? SQL_KEYWORDS.has(word.toLowerCase()) : language === 'shell' ? false : JS_KEYWORDS.has(word);
      if (kw) color = COLORS.keyword;
    }
    const last = tokens[tokens.length - 1];
    if (last && last.color === color) last.text += text;
    else tokens.push({ text, color });
    i += text.length;
  }
  return tokens;
}

function textBlock(lines: string[], x: number, y: number, fontSize: number, lineHeight: number, weight: 'normal' | 'bold', fill: string, anchor: 'start' | 'middle'): string {
  return lines
    .map((l, i) => `<text x="${x}" y="${(y + fontSize + i * fontSize * lineHeight).toFixed(1)}" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(keepSpaces(l))}</text>`)
    .join('');
}

/** Builds the SVG for one frame (design coordinates, scaled to the output size via viewBox). */
export function buildFrameSvg(spec: FrameSpec): { svg: string; notes: FrameLayoutNotes } {
  const parts: string[] = [];
  const notes: FrameLayoutNotes = { truncatedCodeLines: 0, headlineFits: true, codeFontSize: null };
  parts.push(
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${COLORS.bg1}"/><stop offset="1" stop-color="${COLORS.bg2}"/></linearGradient></defs>`,
    `<rect width="${DESIGN_WIDTH}" height="${DESIGN_HEIGHT}" fill="url(#bg)"/>`,
    // Progress bar + scene label.
    `<rect x="80" y="80" width="${DESIGN_WIDTH - 160}" height="8" rx="4" fill="${COLORS.panelBorder}"/>`,
    `<rect x="80" y="80" width="${((DESIGN_WIDTH - 160) * Math.max(0, Math.min(1, spec.progress))).toFixed(1)}" height="8" rx="4" fill="${COLORS.accent}"/>`,
    `<text x="${DESIGN_WIDTH - 80}" y="130" font-family="${FONT_FAMILY}" font-size="28" fill="${COLORS.muted}" text-anchor="end">${esc(spec.sceneLabel)}</text>`,
  );

  if (spec.code) {
    const head = fitText(spec.headline, HEADLINE.box, HEADLINE.fontSizes, HEADLINE.maxLines, HEADLINE.lineHeight);
    notes.headlineFits = head.fits;
    parts.push(textBlock(head.lines, HEADLINE.box.x, HEADLINE.box.y + 20, head.fontSize, HEADLINE.lineHeight, 'bold', COLORS.text, 'start'));

    const src = spec.code.source.replace(/\t/g, '  ').replace(/\s+$/gm, '').split('\n').slice(0, 12);
    const longest = Math.max(1, ...src.map((l) => l.length));
    const inner = CODE.box.width - 2 * CODE.padding;
    let fontSize = CODE.fontSizes[CODE.fontSizes.length - 1];
    for (const size of CODE.fontSizes) {
      const fitsWidth = (longest + CODE.gutterChars + 1) * size * MONO_ADVANCE <= inner;
      const fitsHeight = src.length * size * CODE.lineHeight <= CODE.box.height - 2 * CODE.padding - 40;
      if (fitsWidth && fitsHeight) {
        fontSize = size;
        break;
      }
    }
    notes.codeFontSize = fontSize;
    const maxChars = Math.floor(inner / (fontSize * MONO_ADVANCE)) - CODE.gutterChars - 1;
    const panelHeight = Math.min(CODE.box.height, src.length * fontSize * CODE.lineHeight + 2 * CODE.padding + 40);
    parts.push(
      `<rect x="${CODE.box.x}" y="${CODE.box.y}" width="${CODE.box.width}" height="${panelHeight.toFixed(1)}" rx="24" fill="${COLORS.panel}" stroke="${COLORS.panelBorder}" stroke-width="2"/>`,
      ...[0, 1, 2].map((i) => `<circle cx="${CODE.box.x + 36 + i * 28}" cy="${CODE.box.y + 30}" r="8" fill="${['#ef4444', '#f59e0b', '#22c55e'][i]}"/>`),
      `<text x="${CODE.box.x + CODE.box.width - 30}" y="${CODE.box.y + 40}" font-family="${FONT_FAMILY}" font-size="24" fill="${COLORS.muted}" text-anchor="end">${esc(spec.code.language)}</text>`,
    );
    const top = CODE.box.y + CODE.padding + 30;
    src.forEach((raw, i) => {
      let line = raw;
      if (line.length > maxChars) {
        line = `${line.slice(0, Math.max(1, maxChars - 1))}…`;
        notes.truncatedCodeLines++;
      }
      const y = top + i * fontSize * CODE.lineHeight;
      if (spec.code?.highlightLines.includes(i + 1)) {
        parts.push(`<rect x="${CODE.box.x + 8}" y="${(y + fontSize * 0.15).toFixed(1)}" width="${CODE.box.width - 16}" height="${(fontSize * CODE.lineHeight).toFixed(1)}" fill="${COLORS.highlight}"/>`);
        parts.push(`<rect x="${CODE.box.x + 8}" y="${(y + fontSize * 0.15).toFixed(1)}" width="6" height="${(fontSize * CODE.lineHeight).toFixed(1)}" fill="${COLORS.accent}"/>`);
      }
      const baseline = (y + fontSize * 1.1).toFixed(1);
      const gutter = String(i + 1).padStart(CODE.gutterChars - 1, ' ');
      const x0 = CODE.box.x + CODE.padding;
      const spans = tokenizeLine(line, spec.code!.language)
        .map((t) => `<tspan fill="${t.color}">${esc(keepSpaces(t.text))}</tspan>`)
        .join('');
      parts.push(
        `<text x="${x0}" y="${baseline}" font-family="${FONT_FAMILY}" font-size="${fontSize}" fill="${COLORS.muted}">${esc(keepSpaces(gutter))}</text>`,
        `<text x="${(x0 + (CODE.gutterChars + 1) * fontSize * MONO_ADVANCE).toFixed(1)}" y="${baseline}" font-family="${FONT_FAMILY}" font-size="${fontSize}">${spans}</text>`,
      );
    });
  } else {
    const card = fitText(spec.headline, { ...TITLE_CARD.box, width: TITLE_CARD.box.width - TITLE_CARD_INDENT }, TITLE_CARD.fontSizes, TITLE_CARD.maxLines, TITLE_CARD.lineHeight);
    notes.headlineFits = card.fits;
    const blockHeight = card.lines.length * card.fontSize * TITLE_CARD.lineHeight;
    const y = TITLE_CARD.box.y + (TITLE_CARD.box.height - blockHeight) / 2;
    parts.push(`<rect x="${TITLE_CARD.box.x}" y="${(y - 40).toFixed(1)}" width="12" height="${(blockHeight + 40).toFixed(1)}" rx="6" fill="${COLORS.accent}"/>`);
    parts.push(textBlock(card.lines, TITLE_CARD.box.x + TITLE_CARD_INDENT, y - 20, card.fontSize, TITLE_CARD.lineHeight, 'bold', COLORS.text, 'start'));
  }

  if (spec.caption && spec.caption.length) {
    const fs = CAPTION.fontSize;
    const h = spec.caption.length * fs * CAPTION.lineHeight + 2 * CAPTION.padding;
    const longest = Math.max(...spec.caption.map((l) => l.length));
    const w = Math.min(CAPTION.box.width, longest * fs * MONO_ADVANCE + 2 * CAPTION.padding);
    const x = CAPTION.box.x + (CAPTION.box.width - w) / 2;
    const y = CAPTION.box.y + CAPTION.box.height - h;
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="18" fill="${COLORS.captionBg}" fill-opacity="0.78"/>`);
    parts.push(textBlock(spec.caption, CAPTION.box.x + CAPTION.box.width / 2, y + CAPTION.padding - fs * 0.2, fs, CAPTION.lineHeight, 'bold', '#ffffff', 'middle'));
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${DESIGN_WIDTH} ${DESIGN_HEIGHT}">${parts.join('')}</svg>`;
  return { svg, notes };
}

/** Rasterizes a frame SVG to PNG with only the bundled fonts (no system fonts, so output is reproducible). */
export function renderPng(svg: string): Buffer {
  const dir = fontsDir();
  const r = new Resvg(svg, {
    font: { fontFiles: FONT_FILES.map((f) => join(dir, f)), loadSystemFonts: false, defaultFontFamily: FONT_FAMILY },
    shapeRendering: 2,
    textRendering: 1,
  });
  return Buffer.from(r.render().asPng());
}
