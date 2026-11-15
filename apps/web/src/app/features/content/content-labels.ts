import type {
  CheckState,
  ClaimVerdict,
  CodeCheckStatus,
  ContentIdeaDto,
  IdeaFormat,
  JobDto,
  JobStatus,
  QualityDimension,
  ScriptVersionDto,
} from '@vsf/contracts';
import { EMPTY, Observable, catchError, exhaustMap, of, takeWhile, timer } from 'rxjs';
import { JobsApiService } from '../../core/api/jobs-api.service';

export const JOB_POLL_INTERVAL_MS = 3_000;
export const CHECKS_POLL_INTERVAL_MS = 5_000;

/** Ideas at or above this similarity are flagged (never auto-rejected). */
export const SIMILARITY_FLAG = 0.6;
/** Target duration window for a Short. */
export const MIN_SCRIPT_SEC = 20;
export const MAX_SCRIPT_SEC = 60;
/** Editor limits per scene. */
export const MIN_SCENE_SEC = 1;
export const MAX_SCENE_SEC = 30;
export const MAX_CODE_LINES = 12;

export const MOCK_BANNER_TEXT = 'AI provider not configured — showing mock outputs';

export const FORMAT_LABELS: Record<IdeaFormat, string> = {
  'quick-tip': 'Quick tip',
  'how-to': 'How-to',
  'myth-vs-fact': 'Myth vs fact',
  comparison: 'Comparison',
  'quick-fix': 'Quick fix',
  explainer: 'Explainer',
};

export const DIMENSION_LABELS: Record<QualityDimension, string> = {
  originality: 'Originality',
  repetition: 'Repetition',
  clarity: 'Clarity',
  pacing: 'Pacing',
  accessibility: 'Accessibility',
  platform: 'Platform fit',
  policyRisk: 'Policy risk (5 = lowest risk)',
};
export const QUALITY_DIMENSIONS = Object.keys(DIMENSION_LABELS) as QualityDimension[];

export const VERDICT_LABELS: Record<ClaimVerdict, string> = {
  pending: 'Pending',
  supported: 'Supported',
  unsupported: 'Unsupported',
  contradicted: 'Contradicted',
  overridden: 'Overridden',
};

export const CODE_STATUS_LABELS: Record<CodeCheckStatus, string> = {
  pending: 'Pending',
  passed: 'Passed',
  failed: 'Failed',
  not_executable: 'Not executable',
  unavailable: 'Sandbox unavailable',
  overridden: 'Overridden',
};

export const CHECK_LABELS: Record<keyof ScriptVersionDto['checks'], string> = {
  factCheck: 'Fact-check',
  quality: 'Quality review',
  code: 'Code verification',
};

export function formatLabel(format: IdeaFormat): string {
  return FORMAT_LABELS[format] ?? format;
}

export function isSimilar(idea: Pick<ContentIdeaDto, 'similarityScore'>): boolean {
  return idea.similarityScore >= SIMILARITY_FLAG;
}

/** Warning text when a script's estimated duration is outside the Shorts window, else null. */
export function durationWarning(seconds: number): string | null {
  if (seconds < MIN_SCRIPT_SEC) {
    return `Estimated duration ${seconds} s is below the ${MIN_SCRIPT_SEC} s minimum.`;
  }
  if (seconds > MAX_SCRIPT_SEC) {
    return `Estimated duration ${seconds} s exceeds the ${MAX_SCRIPT_SEC} s maximum.`;
  }
  return null;
}

export function canOverrideClaim(verdict: ClaimVerdict): boolean {
  return verdict === 'unsupported' || verdict === 'contradicted';
}

export function canOverrideCodeCheck(status: CodeCheckStatus): boolean {
  return status === 'failed' || status === 'unavailable';
}

const ACTIVE_CHECK: readonly CheckState[] = ['pending', 'running'];

export function checksActive(checks: ScriptVersionDto['checks']): boolean {
  return Object.values(checks).some((state) => ACTIVE_CHECK.includes(state));
}

const TERMINAL_JOB: readonly JobStatus[] = ['completed', 'failed', 'cancelled'];

export function isTerminalJob(status: JobStatus): boolean {
  return TERMINAL_JOB.includes(status);
}

/**
 * Polls a job until it reaches a terminal status (inclusive). Emits each update; transient
 * errors are skipped and retried on the next tick. Completes immediately for terminal jobs.
 */
export function pollJob(jobs: JobsApiService, job: JobDto, intervalMs = JOB_POLL_INTERVAL_MS): Observable<JobDto> {
  if (isTerminalJob(job.status)) {
    return of(job);
  }
  return timer(intervalMs, intervalMs).pipe(
    exhaustMap(() => jobs.get(job.id, { background: true }).pipe(catchError(() => EMPTY))),
    takeWhile((j) => !isTerminalJob(j.status), true),
  );
}

/**
 * Parses "1, 3,4" into sorted unique positive line numbers.
 * Returns null when the text is not a comma-separated list of positive integers.
 */
export function parseHighlightLines(text: string): number[] | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const parts = trimmed.split(',').map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p) || Number(p) < 1)) {
    return null;
  }
  return [...new Set(parts.map(Number))].sort((a, b) => a - b);
}

export function lineCount(source: string): number {
  return source === '' ? 0 : source.replace(/\n$/, '').split('\n').length;
}
