import type { CaptionCue } from '@vsf/contracts';
import { CAPTION, captionMaxChars, captionRect, insideBox, SAFE_AREA, wrapWords } from './layout';

/**
 * Splits narration into caption cues of at most CAPTION.maxLines wrapped lines, timed proportionally to their
 * length across the spoken audio [offsetMs, offsetMs + speechMs]. The last cue is held until `sceneEndMs`.
 */
export function buildCues(narration: string, offsetMs: number, speechMs: number, sceneEndMs: number): CaptionCue[] {
  const maxChars = captionMaxChars();
  const lines = wrapWords(narration, maxChars);
  if (lines.length === 0) return [];
  const groups: string[][] = [];
  for (let i = 0; i < lines.length; i += CAPTION.maxLines) groups.push(lines.slice(i, i + CAPTION.maxLines));
  const weights = groups.map((g) => g.join(' ').length);
  const total = weights.reduce((a, b) => a + b, 0);
  const cues: CaptionCue[] = [];
  let t = offsetMs;
  groups.forEach((g, i) => {
    const isLast = i === groups.length - 1;
    const dur = Math.round((speechMs * weights[i]) / total);
    const end = isLast ? sceneEndMs : Math.min(t + dur, sceneEndMs);
    cues.push({ startMs: t, endMs: end, text: g.join(' '), lines: g });
    t = end;
  });
  return cues;
}

export interface CaptionIssue {
  severity: 'fail' | 'warn';
  message: string;
}

/** Validates bounds (line length, line count, inside the video) and timing (overlaps, min duration, reading speed). */
export function validateCues(cues: CaptionCue[], videoDurationMs: number): CaptionIssue[] {
  const issues: CaptionIssue[] = [];
  const maxChars = captionMaxChars();
  let prevEnd = 0;
  cues.forEach((c, i) => {
    const n = i + 1;
    if (c.lines.length > CAPTION.maxLines) issues.push({ severity: 'fail', message: `cue ${n}: ${c.lines.length} lines (max ${CAPTION.maxLines})` });
    const longest = Math.max(...c.lines.map((l) => l.length));
    if (longest > maxChars) issues.push({ severity: 'fail', message: `cue ${n}: line of ${longest} chars exceeds the caption area (${maxChars})` });
    // Independent of the wrapping above: the rectangle actually drawn must sit inside the Shorts safe area.
    if (!insideBox(captionRect(c.lines), SAFE_AREA)) issues.push({ severity: 'fail', message: `cue ${n}: caption box leaves the safe area` });
    if (c.endMs <= c.startMs) issues.push({ severity: 'fail', message: `cue ${n}: ends before it starts` });
    if (c.startMs < prevEnd) issues.push({ severity: 'fail', message: `cue ${n}: overlaps the previous cue` });
    if (c.endMs > videoDurationMs + 50) issues.push({ severity: 'fail', message: `cue ${n}: ends after the video (${c.endMs} > ${videoDurationMs} ms)` });
    const dur = c.endMs - c.startMs;
    if (dur < CAPTION.minCueMs) issues.push({ severity: 'warn', message: `cue ${n}: on screen ${dur} ms (< ${CAPTION.minCueMs} ms)` });
    else if ((c.text.length * 1000) / dur > CAPTION.maxCharsPerSec) issues.push({ severity: 'warn', message: `cue ${n}: ${Math.round((c.text.length * 1000) / dur)} chars/s reading speed` });
    prevEnd = c.endMs;
  });
  return issues;
}

function stamp(ms: number, sep: '.' | ','): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (v: number, w = 2) => String(v).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

/** Cue text is plain text: escape VTT markup/entities (this also removes any "-->" separator inside a cue). */
export function vttEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** WebVTT sidecar (dashboard player track and YouTube caption upload). */
export function toWebVtt(cues: CaptionCue[]): string {
  const body = cues.map((c, i) => `${i + 1}\n${stamp(c.startMs, '.')} --> ${stamp(c.endMs, '.')}\n${c.lines.map(vttEscape).join('\n')}`).join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

export function toSrt(cues: CaptionCue[]): string {
  return `${cues.map((c, i) => `${i + 1}\n${stamp(c.startMs, ',')} --> ${stamp(c.endMs, ',')}\n${c.lines.map((l) => l.replace(/-->/g, '->')).join('\n')}`).join('\n\n')}\n`;
}
