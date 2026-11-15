import type { CollectionStatus, ResearchSourceKey, ScoreComponent } from '@vsf/contracts';

export const SOURCE_LABELS: Record<ResearchSourceKey, string> = {
  hackernews: 'Hacker News',
  stackexchange: 'Stack Exchange',
  github: 'GitHub',
  rss: 'RSS feeds',
  youtube: 'YouTube',
};

export const COMPONENT_LABELS: Record<ScoreComponent, string> = {
  freshness: 'Freshness',
  growth: 'Growth',
  relevance: 'Relevance',
  competition: 'Competition',
  demand: 'Demand',
  repeatability: 'Repeatability',
};

/** What is lost when a source is not configured (shown in the source registry). */
export const SOURCE_IMPACT: Partial<Record<ResearchSourceKey, string>> = {
  youtube: 'competition signal unavailable',
};

const TERMINAL: readonly CollectionStatus[] = ['completed', 'partial', 'failed'];

export function isTerminalStatus(status: CollectionStatus): boolean {
  return TERMINAL.includes(status);
}

export function sourceLabel(key: ResearchSourceKey): string {
  return SOURCE_LABELS[key] ?? key;
}

export function componentLabel(component: ScoreComponent): string {
  return COMPONENT_LABELS[component] ?? component;
}

/** 0..1 → "72%". */
export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Local, optimistic view of a decision before the server confirms it. */
export function withDecision<T extends { status: string; decisionNote: string | null; decidedAt: string | null }>(
  topic: T,
  decision: 'approved' | 'rejected',
  note: string | undefined,
): T {
  return { ...topic, status: decision, decisionNote: note ?? null, decidedAt: new Date().toISOString() };
}
