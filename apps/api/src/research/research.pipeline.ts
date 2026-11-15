import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, In, LessThan } from 'typeorm';
import type { ResearchSourceKey, SourceRunResult } from '@vsf/contracts';
import { BudgetExceededError, BudgetService } from '../budget/budget.service';
import { YOUTUBE_DATA_TTL_DAYS } from '../common/constants';
import type { AppEnv } from '../config/env.schema';
import {
  NicheEntity,
  RawSignalEntity,
  ResearchSourceEntity,
  TrendCollectionEntity,
  TrendMetricEntity,
  TrendTopicEntity,
  TrendTopicSignalEntity,
  WeeklyTrendReportEntity,
} from '../database/research.entities';
import { RESEARCH_ADAPTERS, ResearchAdapters, scrub } from './adapters.provider';
import { buildReport } from './report';
import { clusterSignals, isRelevant, ScoredTopic, scoreClusters, scoreFromBreakdown, SignalInput, tokenize } from './scoring';
import { FetchedSignal } from './sources';

/** Max topics checked against YouTube per run (each costs one search.list call). */
export const YOUTUBE_TOPICS_PER_RUN = 15;
const HISTORY_COLLECTIONS = 4;

export type Heartbeat = (progress: number) => Promise<boolean>;

export class LeaseLostError extends Error {
  constructor() {
    super('Job lease lost; another worker may have taken over');
  }
}

/**
 * Runs one trend collection end to end. Idempotent per collection: a completed collection is left alone,
 * and a retried one discards its partial rows and starts again. Each source is isolated, so one failing
 * source never fails the run (status becomes `partial`).
 */
@Injectable()
export class ResearchPipeline {
  private readonly logger = new Logger(ResearchPipeline.name);
  private readonly youtubeDailyCap: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly budget: BudgetService,
    @Inject(RESEARCH_ADAPTERS) private readonly adapters: ResearchAdapters,
    config: ConfigService<AppEnv, true>,
  ) {
    this.youtubeDailyCap = config.get('YOUTUBE_DAILY_SEARCH_CAP', { infer: true });
  }

  async run(collectionId: string, heartbeat: Heartbeat, jobId: string | null = null): Promise<{ status: string; topics: number }> {
    const m = this.dataSource.manager;
    const collection = await m.findOneByOrFail(TrendCollectionEntity, { id: collectionId });
    if (collection.status === 'completed' || collection.status === 'partial') {
      return { status: collection.status, topics: await m.countBy(TrendTopicEntity, { collectionId }) };
    }
    const niche = await m.findOneByOrFail(NicheEntity, { id: collection.nicheId });
    const now = new Date();
    await m.update(TrendCollectionEntity, { id: collectionId }, { status: 'running', startedAt: now, finishedAt: null, sourceResults: [] });

    // ---- 1. fetch from every enabled source, isolated ----
    const registry = await m.findBy(ResearchSourceEntity, {});
    const enabled = new Set(registry.filter((r) => r.enabled).map((r) => r.key));
    const ctx = { keywords: niche.keywords, windowStart: collection.windowStart, windowEnd: collection.windowEnd, now };
    const results: SourceRunResult[] = [];
    const fetched: FetchedSignal[] = [];
    let leaseLost = false;

    await Promise.all(
      this.adapters.discovery.map(async (adapter) => {
        const started = Date.now();
        if (!enabled.has(adapter.key)) {
          results.push({ source: adapter.key, status: 'skipped', signals: 0, durationMs: 0, message: 'disabled in source registry' });
          return;
        }
        if (!adapter.isConfigured()) {
          results.push({ source: adapter.key, status: 'skipped', signals: 0, durationMs: 0, message: 'not configured' });
          return;
        }
        try {
          const signals = await adapter.fetch(ctx);
          fetched.push(...signals);
          results.push({ source: adapter.key, status: 'ok', signals: signals.length, durationMs: Date.now() - started });
        } catch (err) {
          const message = scrub(err instanceof Error ? err.message : 'error', this.adapters.secrets);
          this.logger.warn({ source: adapter.key, collectionId, message }, 'Research source failed');
          results.push({ source: adapter.key, status: 'failed', signals: 0, durationMs: Date.now() - started, message });
        }
        // Keep the lease alive while slow sources finish.
        if (!(await heartbeat(10 + 7 * results.length))) leaseLost = true;
      }),
    );
    if (leaseLost) throw new LeaseLostError();
    if (!(await heartbeat(40))) throw new LeaseLostError();

    // ---- 2. relevance filter, clustering, first-pass scoring ----
    const rules = { keywords: niche.keywords, excludeKeywords: niche.excludeKeywords };
    const withTempIds: SignalInput[] = fetched.map((s, i) => ({ ...s, id: `${s.source}:${s.externalId}:${i}` }));
    const relevant = withTempIds.filter((s) => isRelevant(s, rules));
    const clusters = clusterSignals(relevant);
    const history = await this.history(m, niche.id, collection.createdAt);
    let scored = scoreClusters(clusters, { now, rules, history });

    // ---- 3. YouTube competition for the strongest candidates (budget-guarded, quota-limited) ----
    const competition = await this.youtubeCompetition(scored, collection, results, jobId, heartbeat);
    if (competition) scored = scoreClusters(clusters, { now, rules, history, youtubeCompetition: competition });
    if (!(await heartbeat(70))) throw new LeaseLostError();

    // ---- 4. persist atomically ----
    const attempted = results.filter((r) => r.status !== 'skipped' && r.source !== 'youtube');
    const okCount = attempted.filter((r) => r.status === 'ok').length;
    const status = okCount === 0 ? 'failed' : okCount < attempted.length ? 'partial' : 'completed';
    const ordered = sortResults(results);

    await this.dataSource.transaction(async (tx) => {
      await tx.delete(TrendTopicEntity, { collectionId });
      await tx.delete(RawSignalEntity, { collectionId });
      await tx.delete(WeeklyTrendReportEntity, { collectionId });
      const idMap = await this.saveSignals(tx, collectionId, withTempIds);
      await this.saveTopics(tx, collection, scored, idMap, competition, now);
      const report = buildReport({
        nicheName: niche.name,
        windowStart: collection.windowStart,
        windowEnd: collection.windowEnd,
        sourceResults: ordered,
        topics: scored,
        totalSignals: withTempIds.length,
        relevantSignals: relevant.length,
      });
      await tx.insert(WeeklyTrendReportEntity, { collectionId, markdown: report.markdown, limitations: report.limitations });
      await tx.update(TrendCollectionEntity, { id: collectionId }, { status, finishedAt: new Date(), sourceResults: ordered });
    });
    await heartbeat(95);
    return { status, topics: scored.length };
  }

  /** Marks a collection failed after its job exhausted all attempts (the error itself is on the job row). */
  async markFailed(collectionId: string): Promise<void> {
    await this.dataSource.manager.update(
      TrendCollectionEntity,
      { id: collectionId, status: In(['queued', 'running']) },
      { status: 'failed', finishedAt: new Date() },
    );
  }

  /**
   * Fails collections whose job has failed (exhausted attempts, lease expired on the final attempt, or
   * claim refused) so no collection stays `running` forever. Returns the number of collections updated.
   */
  async failOrphanedCollections(): Promise<number> {
    const res = await this.dataSource.query<[unknown[], number]>(
      `UPDATE trend_collection c SET status = 'failed', finished_at = now(), updated_at = now()
       FROM job j
       WHERE c.job_id = j.id AND j.status = 'failed' AND c.status IN ('queued', 'running')`,
    );
    return Array.isArray(res) && typeof res[1] === 'number' ? res[1] : 0;
  }

  /**
   * YouTube API Services policy: data about other channels is deleted within 30 days. Removes expired YouTube
   * metric rows and redacts YouTube-derived values from topics (competition component nulled, score and
   * confidence recomputed without it). Reports never contain YouTube numbers (see report.ts).
   */
  async purgeExpired(): Promise<number> {
    const expiredTopics = await this.dataSource.manager.find(TrendTopicEntity, {
      where: { youtubeExpiresAt: LessThan(new Date()) },
      take: 1000,
    });
    for (const t of expiredTopics) {
      const breakdown = t.breakdown.map((b) =>
        b.component === 'competition' ? { ...b, value: null, explanation: 'YouTube data deleted after the 30-day retention period' } : b,
      );
      const totals = scoreFromBreakdown(breakdown);
      await this.dataSource.manager.update(
        TrendTopicEntity,
        { id: t.id },
        { breakdown, score: totals.score, confidence: totals.confidence, missingComponents: totals.missingComponents, youtubeExpiresAt: null },
      );
    }
    const res = await this.dataSource.manager
      .createQueryBuilder()
      .delete()
      .from(TrendMetricEntity)
      .where('expires_at IS NOT NULL AND expires_at < now()')
      .execute();
    const sig = await this.dataSource.manager
      .createQueryBuilder()
      .delete()
      .from(RawSignalEntity)
      .where('expires_at IS NOT NULL AND expires_at < now()')
      .execute();
    return (res.affected ?? 0) + (sig.affected ?? 0) + expiredTopics.length;
  }

  private async youtubeCompetition(
    scored: ScoredTopic[],
    collection: TrendCollectionEntity,
    results: SourceRunResult[],
    jobId: string | null,
    heartbeat: Heartbeat,
  ): Promise<Map<string, number> | undefined> {
    const yt = this.adapters.youtube;
    const started = Date.now();
    if (!yt.isConfigured()) {
      results.push({ source: 'youtube', status: 'skipped', signals: 0, durationMs: 0, message: 'YouTube API key not configured' });
      return undefined;
    }
    try {
      // search.list has no monetary cost; the guard still blocks all external work once the budget is exhausted.
      await this.budget.assertCanSpend(collection.workspaceId, 0);
    } catch (err) {
      if (!(err instanceof BudgetExceededError)) throw err;
      results.push({ source: 'youtube', status: 'skipped', signals: 0, durationMs: 0, message: 'monthly budget exhausted' });
      return undefined;
    }
    // Daily cap across all runs protects the search.list quota bucket from repeated manual runs.
    const dayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    const usedToday = await this.budget.unitsSince(collection.workspaceId, 'youtube', 'search.list call', dayStart);
    const allowance = Math.min(YOUTUBE_TOPICS_PER_RUN, Math.max(0, this.youtubeDailyCap - usedToday));
    if (allowance === 0) {
      results.push({ source: 'youtube', status: 'skipped', signals: 0, durationMs: 0, message: 'daily YouTube search cap reached' });
      return undefined;
    }
    const top = [...scored].sort((a, b) => b.score - a.score).slice(0, allowance);
    const counts = new Map<string, number>();
    let calls = 0;
    try {
      for (const t of top) {
        calls++;
        counts.set(t.slug, await yt.countShorts(tokenize(t.title).slice(0, 6).join(' '), collection.windowStart));
        if (!(await heartbeat(45 + Math.round((25 * calls) / top.length)))) throw new LeaseLostError();
      }
      results.push({ source: 'youtube', status: 'ok', signals: counts.size, durationMs: Date.now() - started });
    } catch (err) {
      if (err instanceof LeaseLostError) throw err;
      const message = scrub(err instanceof Error ? err.message : 'error', this.adapters.secrets);
      results.push({ source: 'youtube', status: counts.size ? 'ok' : 'failed', signals: counts.size, durationMs: Date.now() - started, message });
    } finally {
      if (calls > 0) {
        await this.budget.record({
          workspaceId: collection.workspaceId,
          provider: 'youtube',
          category: 'api',
          units: calls,
          unit: 'search.list call',
          amountMinor: 0,
          relatedType: 'trend_collection',
          relatedId: collection.id,
          jobId,
        });
      }
    }
    return counts.size ? counts : undefined;
  }

  private async history(m: EntityManager, nicheId: string, before: Date) {
    const prev = await m
      .createQueryBuilder(TrendCollectionEntity, 'c')
      .select('c.id', 'id')
      .where(`c.niche_id = :nicheId AND c.status IN ('completed', 'partial') AND c.created_at < :before`, { nicheId, before })
      .orderBy('c.created_at', 'DESC')
      .limit(HISTORY_COLLECTIONS)
      .getRawMany<{ id: string }>();
    if (prev.length === 0) return undefined;
    const rows = await m
      .createQueryBuilder(TrendTopicEntity, 't')
      .select('t.slug', 'slug')
      .addSelect('count(DISTINCT t.collection_id)::int', 'n')
      .where('t.collection_id IN (:...ids)', { ids: prev.map((p) => p.id) })
      .groupBy('t.slug')
      .getRawMany<{ slug: string; n: number }>();
    return { previousCollections: prev.length, slugCounts: new Map(rows.map((r) => [r.slug, r.n])) };
  }

  private async saveSignals(tx: EntityManager, collectionId: string, signals: SignalInput[]): Promise<Map<string, string>> {
    const idMap = new Map<string, string>();
    const seen = new Set<string>();
    for (const chunk of chunks(signals, 200)) {
      const rows = chunk
        .filter((s) => {
          const k = `${s.source}:${externalIdOf(s)}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((s) => ({
          collectionId,
          sourceKey: s.source,
          externalId: externalIdOf(s),
          url: s.url.slice(0, 2000),
          title: s.title.slice(0, 500),
          tags: s.tags.slice(0, 30),
          publishedAt: s.publishedAt,
          retrievedAt: s.retrievedAt,
          metrics: s.metrics,
          expiresAt: null,
        }));
      if (!rows.length) continue;
      await tx.createQueryBuilder().insert().into(RawSignalEntity).values(rows).execute();
    }
    // Read ids back explicitly (independent of driver-specific RETURNING shapes).
    const stored = await tx.query<Array<{ id: string; source_key: string; external_id: string }>>(
      `SELECT id, source_key, external_id FROM raw_signal WHERE collection_id = $1`,
      [collectionId],
    );
    for (const r of stored) idMap.set(`${r.source_key}:${r.external_id}`, r.id);
    // Map temp ids → DB ids (duplicates within the run point to the first stored row).
    const byTemp = new Map<string, string>();
    for (const s of signals) {
      const dbId = idMap.get(`${s.source}:${externalIdOf(s)}`);
      if (dbId) byTemp.set(s.id, dbId);
    }
    return byTemp;
  }

  private async saveTopics(
    tx: EntityManager,
    c: TrendCollectionEntity,
    scored: ScoredTopic[],
    idMap: Map<string, string>,
    competition: Map<string, number> | undefined,
    now: Date,
  ): Promise<void> {
    const ytExpiry = new Date(now.getTime() + YOUTUBE_DATA_TTL_DAYS * 86_400_000);
    for (const t of scored) {
      const topic = await tx.save(
        tx.create(TrendTopicEntity, {
          workspaceId: c.workspaceId,
          collectionId: c.id,
          nicheId: c.nicheId,
          title: t.title.slice(0, 500),
          slug: t.slug,
          score: t.score,
          confidence: t.confidence,
          breakdown: t.breakdown,
          missingComponents: t.missingComponents,
          stale: t.stale,
          sources: t.sources,
          signalCount: t.signals.length,
          newestSignalAt: t.newestSignalAt,
          youtubeExpiresAt: competition?.has(t.slug) ? ytExpiry : null,
          status: 'new',
        }),
      );
      const signalIds = [...new Set(t.signals.map((s) => idMap.get(s.id)).filter((x): x is string => Boolean(x)))];
      if (signalIds.length) {
        await tx.insert(TrendTopicSignalEntity, signalIds.map((signalId) => ({ topicId: topic.id, signalId })));
      }
      // Provenance: one metric row per raw source metric, plus the YouTube competition count (expires in 30 days).
      const metrics: Array<Partial<TrendMetricEntity>> = [];
      for (const s of t.signals) {
        const signalId = idMap.get(s.id) ?? null;
        for (const [name, value] of Object.entries(s.metrics)) {
          metrics.push({
            topicId: topic.id,
            signalId,
            name: `${s.source}.${name}`,
            value,
            unit: 'count',
            sourceKey: s.source,
            observedAt: s.retrievedAt,
            retrievedAt: s.retrievedAt,
            expiresAt: null,
          });
        }
      }
      const comp = competition?.get(t.slug);
      if (comp !== undefined) {
        metrics.push({
          topicId: topic.id,
          signalId: null,
          name: 'youtube.short_videos_7d',
          value: comp,
          unit: 'videos (<4 min, YouTube search estimate)',
          sourceKey: 'youtube',
          observedAt: now,
          retrievedAt: now,
          expiresAt: ytExpiry,
        });
      }
      for (const chunk of chunks(metrics, 500)) await tx.insert(TrendMetricEntity, chunk);
    }
  }
}

function externalIdOf(s: SignalInput): string {
  return (s as SignalInput & { externalId?: string }).externalId ?? s.id;
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const ORDER: ResearchSourceKey[] = ['hackernews', 'stackexchange', 'github', 'rss', 'youtube'];
function sortResults(r: SourceRunResult[]): SourceRunResult[] {
  return [...r].sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source));
}
