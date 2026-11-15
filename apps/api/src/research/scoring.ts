/**
 * Deterministic, explainable trend clustering and scoring (docs/AI_ARCHITECTURE.md §5).
 * Pure functions only: no I/O, no clock reads (the caller passes `now`), so results are reproducible.
 */
import type { ResearchSourceKey, ScoreComponent, ScoreComponentDetail } from '@vsf/contracts';

export interface SignalInput {
  /** Stable id within the run (DB id once persisted). */
  id: string;
  source: ResearchSourceKey;
  title: string;
  url: string;
  tags: string[];
  publishedAt: Date | null;
  retrievedAt: Date;
  /** Raw source metrics, e.g. { points, comments } (HN), { stars, forks } (GitHub), { score, answers, views } (SE). */
  metrics: Record<string, number>;
}

export interface NicheRules {
  keywords: string[];
  excludeKeywords: string[];
}

export const WEIGHTS: Record<ScoreComponent, number> = {
  freshness: 0.2,
  growth: 0.25,
  relevance: 0.25,
  competition: 0.15,
  demand: 0.1,
  repeatability: 0.05,
};

const FRESHNESS_HALF_LIFE_DAYS = 7;
export const STALE_AFTER_DAYS = 14;
const CLUSTER_JACCARD = 0.5;
/** Score multiplier at zero confidence; at full confidence the multiplier is 1. */
export const SPARSE_FLOOR = 0.5;

const STOPWORDS = new Set(
  'a an and are as at be by for from has have how i in into is it its of on or show ask hn the this to vs was we what when why with you your new using use via'.split(
    ' ',
  ),
);

// ---------------------------------------------------------------- text

/** Lower-cases and tokenizes, keeping tech punctuation that matters (node.js, c#, c++, .net). */
export function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[“”"'`’()[\]{}<>!?,;:|/\\]+/g, ' ')
    .replace(/\s-\s|—|–/g, ' ');
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.replace(/^[.\-_]+|[.\-_]+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return [...new Set(tokens)];
}

export function slugify(tokens: string[]): string {
  return (
    tokens
      .slice(0, 8)
      .join('-')
      .replace(/[^a-z0-9.+#-]/g, '')
      .slice(0, 120) || 'topic'
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Keywords (possibly multi-word, e.g. "github actions") found in the signal's title or tags. */
export function matchedKeywords(signal: Pick<SignalInput, 'title' | 'tags'>, keywords: string[]): string[] {
  const haystack = ` ${tokenize(signal.title).join(' ')} ${signal.tags.map((t) => t.toLowerCase()).join(' ')} `;
  return keywords.filter((k) => haystack.includes(` ${k.toLowerCase().trim()} `));
}

/** 0 matches → irrelevant (dropped); 1 → 0.6; 2 → 0.8; 3+ → 1.0. */
export function relevanceFromMatches(n: number): number {
  return n <= 0 ? 0 : n === 1 ? 0.6 : n === 2 ? 0.8 : 1;
}

export function isRelevant(signal: SignalInput, rules: NicheRules): boolean {
  if (matchedKeywords(signal, rules.excludeKeywords).length > 0) return false;
  return matchedKeywords(signal, rules.keywords).length > 0;
}

// ---------------------------------------------------------------- clustering

export interface Cluster {
  slug: string;
  title: string;
  signals: SignalInput[];
}

/** Engagement used only to order signals (the most engaged signal names the topic). */
export function engagement(s: SignalInput): number {
  const m = s.metrics;
  return (m.points ?? 0) + (m.comments ?? 0) + (m.stars ?? 0) + (m.score ?? 0) * 10 + (m.views ?? 0) / 100;
}

/**
 * Greedy single-pass clustering: a signal joins the first cluster whose seed tokens have Jaccard ≥ 0.5
 * with its own, or that already contains the same URL. Deterministic for a given input order.
 */
export function clusterSignals(signals: SignalInput[]): Cluster[] {
  const ordered = [...signals].sort((a, b) => engagement(b) - engagement(a) || a.id.localeCompare(b.id));
  const clusters: Array<Cluster & { seed: Set<string>; urls: Set<string> }> = [];
  for (const s of ordered) {
    const tokens = new Set(tokenize(s.title));
    const url = normalizeUrl(s.url);
    const hit = clusters.find((c) => c.urls.has(url) || jaccard(c.seed, tokens) >= CLUSTER_JACCARD);
    if (hit) {
      hit.signals.push(s);
      hit.urls.add(url);
    } else {
      clusters.push({ slug: slugify([...tokens]), title: s.title.trim(), signals: [s], seed: tokens, urls: new Set([url]) });
    }
  }
  // Slugs must be unique within a collection.
  const seen = new Map<string, number>();
  return clusters.map(({ slug, title, signals: sigs }) => {
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    return { slug: n === 1 ? slug : `${slug}-${n}`, title, signals: sigs };
  });
}

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    for (const p of [...url.searchParams.keys()]) if (p.startsWith('utm_')) url.searchParams.delete(p);
    return `${url.host.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}${url.search}`;
  } catch {
    return u;
  }
}

// ---------------------------------------------------------------- normalization

/** Linear interpolation percentile on a sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Min-max normalization after winsorizing at p5/p95 (outliers can't flatten everything else).
 * With no spread every value maps to 0.5 (no information to rank by).
 */
export function makeNormalizer(values: number[]): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return () => 0.5;
  const lo = percentile(sorted, 0.05);
  const hi = percentile(sorted, 0.95);
  if (hi - lo < 1e-9) return () => 0.5;
  return (v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

// ---------------------------------------------------------------- per-signal raw rates

function ageDays(s: SignalInput, now: Date): number {
  const t = (s.publishedAt ?? s.retrievedAt).getTime();
  return Math.max(0, (now.getTime() - t) / 86_400_000);
}

/** Growth rate per day, by source. Undefined when the source has no growth signal (RSS). */
export function growthRate(s: SignalInput, now: Date): { rate: number; label: string } | undefined {
  const days = Math.max(ageDays(s, now), 1 / 24);
  const m = s.metrics;
  switch (s.source) {
    case 'hackernews':
      return m.points === undefined ? undefined : { rate: m.points / days, label: 'HN points/day' };
    case 'github':
      return m.stars === undefined ? undefined : { rate: m.stars / Math.max(days, 1), label: 'GitHub stars/day' };
    case 'stackexchange':
      return m.score === undefined ? undefined : { rate: m.score / Math.max(days, 1), label: 'SO votes/day' };
    default:
      return undefined;
  }
}

/** Audience demand, by source. Undefined when the source has no demand signal. */
export function demandValue(s: SignalInput): { value: number; label: string } | undefined {
  const m = s.metrics;
  if (s.source === 'hackernews' && m.comments !== undefined) return { value: m.comments, label: 'HN comments' };
  if (s.source === 'stackexchange' && m.views !== undefined) return { value: m.views, label: 'SO question views' };
  return undefined;
}

// ---------------------------------------------------------------- scoring

export interface ScoringContext {
  now: Date;
  rules: NicheRules;
  /** Competing YouTube Shorts in the last 7 days per topic slug; absent → component missing for that topic. */
  youtubeCompetition?: Map<string, number>;
  /**
   * How many of the previous N collections of this niche contained the same slug. `undefined` when the niche
   * has no previous collections (repeatability is then missing rather than zero).
   */
  history?: { previousCollections: number; slugCounts: Map<string, number> };
}

export interface ScoredTopic {
  slug: string;
  title: string;
  signals: SignalInput[];
  score: number;
  confidence: number;
  breakdown: ScoreComponentDetail[];
  missingComponents: ScoreComponent[];
  stale: boolean;
  newestSignalAt: Date;
  sources: ResearchSourceKey[];
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const fmt = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1));

/**
 * Final score from a breakdown: weighted mean over available components, then evidence shrinkage.
 * Renormalizing over available components alone would let a data-poor topic (e.g. a release note with only
 * freshness + relevance) outrank well-evidenced ones, so the mean is scaled by
 * SPARSE_FLOOR + (1 - SPARSE_FLOOR) * confidence. Also used when YouTube data is redacted after 30 days.
 */
export function scoreFromBreakdown(details: ScoreComponentDetail[]): {
  score: number;
  confidence: number;
  missingComponents: ScoreComponent[];
} {
  const available = details.filter((d) => d.value !== null);
  const wSum = available.reduce((a, d) => a + d.weight, 0);
  const weighted = wSum > 0 ? available.reduce((a, d) => a + d.weight * (d.value as number), 0) / wSum : 0;
  return {
    score: round(weighted * (SPARSE_FLOOR + (1 - SPARSE_FLOOR) * wSum)),
    confidence: round(wSum, 3),
    missingComponents: details.filter((d) => d.value === null).map((d) => d.component),
  };
}

export function scoreClusters(clusters: Cluster[], ctx: ScoringContext): ScoredTopic[] {
  const { now } = ctx;

  // Collection-wide normalizers, per source, so HN points and GitHub stars are compared within their own scale.
  const growthBySource = new Map<ResearchSourceKey, number[]>();
  const demandBySource = new Map<ResearchSourceKey, number[]>();
  for (const c of clusters)
    for (const s of c.signals) {
      const g = growthRate(s, now);
      if (g) growthBySource.set(s.source, [...(growthBySource.get(s.source) ?? []), g.rate]);
      const d = demandValue(s);
      if (d) demandBySource.set(s.source, [...(demandBySource.get(s.source) ?? []), d.value]);
    }
  const growthNorm = new Map([...growthBySource].map(([k, v]) => [k, makeNormalizer(v)]));
  const demandNorm = new Map([...demandBySource].map(([k, v]) => [k, makeNormalizer(v)]));
  const competitionValues = ctx.youtubeCompetition ? [...ctx.youtubeCompetition.values()] : [];
  const competitionNorm = makeNormalizer(competitionValues);

  return clusters.map((c) => {
    const newest = c.signals.reduce((a, s) => Math.max(a, (s.publishedAt ?? s.retrievedAt).getTime()), 0);
    const newestAge = Math.max(0, (now.getTime() - newest) / 86_400_000);
    const details: ScoreComponentDetail[] = [];

    // freshness
    const fresh = 0.5 ** (newestAge / FRESHNESS_HALF_LIFE_DAYS);
    details.push({
      component: 'freshness',
      weight: WEIGHTS.freshness,
      value: round(fresh),
      explanation: `Newest signal ${fmt(newestAge)} days old (half-life ${FRESHNESS_HALF_LIFE_DAYS} days)`,
    });

    // growth: best normalized rate across the topic's signals
    let growth: { v: number; why: string } | undefined;
    for (const s of c.signals) {
      const g = growthRate(s, now);
      if (!g) continue;
      const v = growthNorm.get(s.source)!(g.rate);
      if (!growth || v > growth.v) growth = { v, why: `${fmt(g.rate)} ${g.label} (normalized within ${s.source} signals)` };
    }
    details.push({
      component: 'growth',
      weight: WEIGHTS.growth,
      value: growth ? round(growth.v) : null,
      explanation: growth?.why ?? 'No source with a growth metric (points, stars or votes) for this topic',
    });

    // relevance
    const matched = new Set(c.signals.flatMap((s) => matchedKeywords(s, ctx.rules.keywords)));
    details.push({
      component: 'relevance',
      weight: WEIGHTS.relevance,
      value: relevanceFromMatches(matched.size),
      explanation: `Matches niche keywords: ${[...matched].join(', ') || 'none'}`,
    });

    // competition (inverse: fewer competing Shorts is better)
    const comp = ctx.youtubeCompetition?.get(c.slug);
    details.push({
      component: 'competition',
      weight: WEIGHTS.competition,
      value: comp === undefined ? null : round(1 - competitionNorm(comp)),
      explanation:
        comp === undefined
          ? 'YouTube data unavailable (API key not configured, quota, or topic not checked)'
          : `~${comp} short videos (<4 min) on YouTube in the last 7 days, per YouTube search estimate (fewer is better)`,
    });

    // demand
    let demand: { v: number; why: string } | undefined;
    for (const s of c.signals) {
      const d = demandValue(s);
      if (!d) continue;
      const v = demandNorm.get(s.source)!(d.value);
      if (!demand || v > demand.v) demand = { v, why: `${fmt(d.value)} ${d.label} (normalized within ${s.source} signals)` };
    }
    details.push({
      component: 'demand',
      weight: WEIGHTS.demand,
      value: demand ? round(demand.v) : null,
      explanation: demand?.why ?? 'No audience-demand metric (comments or question views) for this topic',
    });

    // repeatability
    const hist = ctx.history;
    const seenBefore = hist ? (hist.slugCounts.get(c.slug) ?? 0) : undefined;
    details.push({
      component: 'repeatability',
      weight: WEIGHTS.repeatability,
      value: hist && hist.previousCollections > 0 ? round(Math.min(1, seenBefore! / hist.previousCollections)) : null,
      explanation:
        hist && hist.previousCollections > 0
          ? `Seen in ${seenBefore} of the previous ${hist.previousCollections} collections`
          : 'No previous collections for this niche yet',
    });

    const totals = scoreFromBreakdown(details);

    return {
      slug: c.slug,
      title: c.title,
      signals: c.signals,
      score: totals.score,
      confidence: totals.confidence,
      breakdown: details,
      missingComponents: totals.missingComponents,
      stale: newestAge > STALE_AFTER_DAYS,
      newestSignalAt: new Date(newest),
      sources: [...new Set(c.signals.map((s) => s.source))].sort(),
    };
  });
}
