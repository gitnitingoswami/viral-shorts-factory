import type { SourceRunResult } from '@vsf/contracts';
import type { ScoredTopic } from './scoring';

export interface ReportInput {
  nicheName: string;
  windowStart: Date;
  windowEnd: Date;
  sourceResults: SourceRunResult[];
  topics: ScoredTopic[];
  totalSignals: number;
  relevantSignals: number;
}

/** Strips characters that could be interpreted as markdown/HTML structure from untrusted source text. */
export function mdText(s: string): string {
  return s.replace(/[<>[\]`*_#|\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Deterministic weekly report: top topics with evidence links, source coverage, explicit limitations. */
export function buildReport(r: ReportInput, topN = 10): { markdown: string; limitations: string[] } {
  const limitations: string[] = [
    'Scores are relative within this collection and are not predictions of views or performance.',
    'Metrics come only from the listed sources at retrieval time; sources reflect their own audiences (e.g. Hacker News skews toward startup and systems topics).',
  ];
  for (const s of r.sourceResults) {
    if (s.status === 'failed') limitations.push(`Source "${s.source}" failed (${s.message ?? 'error'}); its signals are missing.`);
    if (s.status === 'skipped') limitations.push(`Source "${s.source}" skipped (${s.message ?? 'not configured'}).`);
  }
  if (!r.sourceResults.some((s) => s.source === 'youtube' && s.status === 'ok')) {
    limitations.push('YouTube competition was not measured: the competition component is missing and weights were renormalized.');
  }
  if (r.topics.some((t) => t.stale)) limitations.push('Some topics are stale (newest evidence older than 14 days) and are flagged.');

  const ranked = [...r.topics].sort((a, b) => b.score - a.score).slice(0, topN);
  const lines: string[] = [
    `# Weekly trend report: ${mdText(r.nicheName)}`,
    '',
    `Window: ${day(r.windowStart)} to ${day(r.windowEnd)} · ${r.relevantSignals} relevant of ${r.totalSignals} signals · ${r.topics.length} topics`,
    '',
    '## Source coverage',
    ...r.sourceResults.map((s) => `- ${s.source}: ${s.status}, ${s.signals} signals${s.message ? ` (${mdText(s.message)})` : ''}`),
    '',
    `## Top ${ranked.length} topics`,
  ];
  ranked.forEach((t, i) => {
    lines.push('', `### ${i + 1}. ${mdText(t.title)}`);
    lines.push(`Score ${t.score.toFixed(2)} · confidence ${pct(t.confidence)}${t.stale ? ' · STALE' : ''} · sources: ${t.sources.join(', ')}`);
    if (t.missingComponents.length) lines.push(`Missing data: ${t.missingComponents.join(', ')}`);
    for (const b of t.breakdown) {
      lines.push(`- ${b.component} (${pct(b.weight)}): ${b.value === null ? 'missing' : b.value.toFixed(2)}. ${mdText(b.explanation)}`);
    }
    lines.push('Evidence:');
    for (const s of t.signals.slice(0, 5)) {
      const url = /^https?:\/\//.test(s.url) ? s.url : '';
      lines.push(`- [${s.source}] ${mdText(s.title)}${url ? ` (${url})` : ''}`);
    }
  });
  lines.push('', '## Limitations', ...limitations.map((l) => `- ${l}`));
  return { markdown: lines.join('\n'), limitations };
}
