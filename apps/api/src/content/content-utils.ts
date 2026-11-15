import { createHash } from 'node:crypto';
import type { CheckState, ClaimVerdict, CodeCheckStatus, StoryboardSceneDto } from '@vsf/contracts';
import { jaccard, tokenize } from '../research/scoring';
import { MAX_CODE_LINES, MAX_DURATION_SEC, MIN_DURATION_SEC, WORDS_PER_SECOND } from './schemas';

/** Deterministic JSON (sorted keys) so equal content always hashes equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Hash bound to approvals: any edit to title or scenes produces a different hash. */
export function versionHash(title: string, scenes: StoryboardSceneDto[]): string {
  return createHash('sha256').update(canonicalJson({ title, scenes })).digest('hex');
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Spoken words and estimated runtime: the longer of the scene durations and the narration at 2.5 words/s. */
export function scriptMetrics(scenes: StoryboardSceneDto[]): { wordCount: number; estDurationSec: number } {
  const wordCount = scenes.reduce((a, s) => a + countWords(s.narration), 0);
  const sceneSeconds = scenes.reduce((a, s) => a + s.durationSec, 0);
  return { wordCount, estDurationSec: Math.max(sceneSeconds, Math.ceil(wordCount / WORDS_PER_SECOND)) };
}

export function codeLineCount(source: string): number {
  return source.replace(/\n+$/, '').split('\n').length;
}

/** Normalizes model/editor scenes: sequential indexes, trimmed text, valid highlight lines. */
export function normalizeScenes(scenes: Array<Omit<StoryboardSceneDto, 'index'>>): StoryboardSceneDto[] {
  return scenes.map((s, index) => {
    const code = s.code
      ? {
          language: s.code.language,
          source: s.code.source.replace(/\r\n/g, '\n').replace(/\s+$/, ''),
          highlightLines: [...new Set(s.code.highlightLines)].filter((n) => n >= 1 && n <= codeLineCount(s.code!.source)).sort((a, b) => a - b),
        }
      : null;
    return {
      index,
      durationSec: s.durationSec,
      narration: s.narration.trim(),
      onScreenText: s.onScreenText.trim(),
      visualConcept: s.visualConcept.trim(),
      code,
      transition: s.transition,
      assetBrief: s.assetBrief.trim(),
    };
  });
}

export interface BlockerInput {
  isCurrent: boolean;
  estDurationSec: number;
  scenes: StoryboardSceneDto[];
  checks: { factCheck: CheckState; quality: CheckState; code: CheckState };
  claims: Array<{ verdict: ClaimVerdict }>;
  codeChecks: Array<{ sceneIndex: number; status: CodeCheckStatus }>;
}

/**
 * Reasons a version can't be approved (empty = approvable). Approval requires: current version, completed checks,
 * no unsupported/contradicted claims (unless overridden with a reason), every executable snippet passed (or
 * overridden), duration 20–60 s, code ≤ 12 lines per scene.
 */
export function approvalBlockers(v: BlockerInput): string[] {
  const out: string[] = [];
  if (!v.isCurrent) out.push('Only the current version can be approved');
  if (v.checks.factCheck !== 'done') out.push(`Fact-check is ${v.checks.factCheck}`);
  if (v.checks.quality !== 'done') out.push(`Quality review is ${v.checks.quality}`);
  if (v.checks.code !== 'done') out.push(`Code verification is ${v.checks.code}`);
  const badClaims = v.claims.filter((c) => c.verdict === 'unsupported' || c.verdict === 'contradicted').length;
  if (badClaims) out.push(`${badClaims} claim(s) unsupported or contradicted: edit the script or override with a reason`);
  const pendingClaims = v.claims.filter((c) => c.verdict === 'pending').length;
  if (pendingClaims) out.push(`${pendingClaims} claim(s) not yet checked`);
  for (const c of v.codeChecks) {
    if (c.status === 'failed' || c.status === 'unavailable' || c.status === 'pending') {
      out.push(`Code in scene ${c.sceneIndex + 1} is ${c.status}: fix it or override with a reason`);
    }
  }
  if (v.estDurationSec < MIN_DURATION_SEC || v.estDurationSec > MAX_DURATION_SEC) {
    out.push(`Estimated duration ${v.estDurationSec}s is outside ${MIN_DURATION_SEC}–${MAX_DURATION_SEC}s`);
  }
  for (const s of v.scenes) {
    if (s.code && codeLineCount(s.code.source) > MAX_CODE_LINES) out.push(`Code in scene ${s.index + 1} exceeds ${MAX_CODE_LINES} lines`);
  }
  return out;
}

export const SIMILARITY_FLAG = 0.6;

/** Token Jaccard between two ideas (title + hook). */
export function ideaSimilarity(a: { title: string; hook: string }, b: { title: string; hook: string }): number {
  return jaccard(new Set(tokenize(`${a.title} ${a.hook}`)), new Set(tokenize(`${b.title} ${b.hook}`)));
}

/** Most similar earlier idea (0..1) and its id. */
export function closestIdea<T extends { id: string; title: string; hook: string }>(
  idea: { title: string; hook: string },
  earlier: T[],
): { score: number; id: string | null } {
  let best = { score: 0, id: null as string | null };
  for (const e of earlier) {
    const s = ideaSimilarity(idea, e);
    if (s > best.score) best = { score: s, id: e.id };
  }
  return best;
}

/**
 * Anti-hallucination guard for fact-checks: evidence must literally appear in a supplied source (whitespace and
 * case-insensitive); otherwise the verdict is downgraded to unsupported.
 */
export function evidenceFound(evidence: string | null, sourceTexts: string[], claim?: string): boolean {
  if (!evidence) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const e = norm(evidence);
  const evidenceTokens = tokenize(e);
  // A meaningful quote: at least 20 characters or 4 content words (not "node" or "stars").
  if (e.length < MIN_EVIDENCE_CHARS && evidenceTokens.length < MIN_EVIDENCE_TOKENS) return false;
  if (!sourceTexts.some((t) => norm(t).includes(e))) return false;
  // The quote must be about the claim: share at least one content word with it.
  if (claim !== undefined) {
    const claimTokens = new Set(tokenize(claim));
    if (!evidenceTokens.some((t) => claimTokens.has(t))) return false;
  }
  return true;
}

export const MIN_EVIDENCE_CHARS = 20;
export const MIN_EVIDENCE_TOKENS = 4;
