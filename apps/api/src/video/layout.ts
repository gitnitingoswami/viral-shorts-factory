/**
 * Frame layout for vertical Shorts. All coordinates are designed at 1080×1920 and scaled to the output size.
 * Text uses a monospace font (JetBrains Mono, advance width 0.6em), so line widths are exact and caption bounds
 * can be validated without rasterizing.
 */
export const DESIGN_WIDTH = 1080;
export const DESIGN_HEIGHT = 1920;
/** JetBrains Mono advance width per em. */
export const MONO_ADVANCE = 0.6;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * YouTube Shorts overlays the channel name, title and buttons on the bottom ~25% and the right edge, so captions
 * and key text stay inside this safe area (design units).
 */
export const SAFE_AREA: Box = { x: 80, y: 120, width: 860, height: 1380 };

export const CAPTION = {
  /** Caption box (design units): inside the safe area, above the Shorts UI. */
  box: { x: 90, y: 1190, width: 860, height: 250 },
  fontSize: 50,
  lineHeight: 1.3,
  padding: 28,
  maxLines: 2,
  /** Minimum time a cue stays on screen, and the max comfortable reading speed. */
  minCueMs: 700,
  maxCharsPerSec: 25,
};

/** Rendered caption rectangle (design units) for the given wrapped lines; the frame renderer draws exactly this. */
export function captionRect(lines: string[]): Box {
  const longest = Math.max(0, ...lines.map((l) => l.length));
  const width = Math.min(CAPTION.box.width, longest * CAPTION.fontSize * MONO_ADVANCE + 2 * CAPTION.padding);
  const height = lines.length * CAPTION.fontSize * CAPTION.lineHeight + 2 * CAPTION.padding;
  return { x: CAPTION.box.x + (CAPTION.box.width - width) / 2, y: CAPTION.box.y + CAPTION.box.height - height, width, height };
}

export function insideBox(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/** Characters that fit on one caption line. */
export function captionMaxChars(): number {
  return Math.floor((CAPTION.box.width - 2 * CAPTION.padding) / (CAPTION.fontSize * MONO_ADVANCE));
}

export const HEADLINE = { box: { x: 90, y: 150, width: 860, height: 300 }, fontSizes: [64, 56, 48, 42], maxLines: 3, lineHeight: 1.2 };
export const TITLE_CARD = { box: { x: 90, y: 520, width: 860, height: 600 }, fontSizes: [84, 72, 64, 56, 48], maxLines: 5, lineHeight: 1.2 };
export const CODE = {
  box: { x: 70, y: 470, width: 900, height: 680 },
  fontSizes: [36, 32, 28, 26, 24],
  lineHeight: 1.45,
  padding: 30,
  gutterChars: 3,
};

export function lineWidth(chars: number, fontSize: number): number {
  return chars * fontSize * MONO_ADVANCE;
}

/** Greedy word wrap at `maxChars`; words longer than a line are hard-split. */
export function wrapWords(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (let word of words) {
    while (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (!word) continue;
    if (!current) current = word;
    else if (current.length + 1 + word.length <= maxChars) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Largest font size from `sizes` at which `text` wraps into at most `maxLines` lines inside `box`. */
export function fitText(text: string, box: Box, sizes: number[], maxLines: number, lineHeight: number): { fontSize: number; lines: string[]; fits: boolean } {
  for (const fontSize of sizes) {
    const maxChars = Math.floor(box.width / (fontSize * MONO_ADVANCE));
    const lines = wrapWords(text, maxChars);
    if (lines.length <= maxLines && lines.length * fontSize * lineHeight <= box.height) return { fontSize, lines, fits: true };
  }
  const fontSize = sizes[sizes.length - 1];
  const lines = wrapWords(text, Math.floor(box.width / (fontSize * MONO_ADVANCE)));
  return { fontSize, lines: lines.slice(0, maxLines), fits: false };
}
