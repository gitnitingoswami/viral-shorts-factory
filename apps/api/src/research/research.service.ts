import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type {
  NicheDto,
  Page,
  ResearchSourceDto,
  TopicDecisionRequest,
  TrendCollectionDto,
  TrendMetricDto,
  TrendSignalDto,
  TrendTopicDetailDto,
  TrendTopicDto,
  UpsertNicheRequest,
  WeeklyTrendReportDto,
} from '@vsf/contracts';
import { JOB_TYPE_RESEARCH_COLLECT, QUEUE_RESEARCH } from '../common/constants';
import {
  NicheEntity,
  RawSignalEntity,
  ResearchSourceEntity,
  TrendCollectionEntity,
  TrendMetricEntity,
  TrendTopicEntity,
  WeeklyTrendReportEntity,
} from '../database/research.entities';
import { JobsService } from '../jobs/jobs.service';
import { RESEARCH_ADAPTERS, ResearchAdapters } from './adapters.provider';

export const RESEARCH_WINDOW_DAYS = 7;

export function nicheSlug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'niche';
}

export function normalizeKeywords(list: string[] | undefined): string[] {
  return [...new Set((list ?? []).map((k) => k.toLowerCase().trim().replace(/\s+/g, ' ')).filter(Boolean))];
}

/** ISO-8601 week label (e.g. 2026-W46), used to make scheduled runs idempotent per niche and week. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function toNicheDto(n: NicheEntity): NicheDto {
  return {
    id: n.id,
    name: n.name,
    slug: n.slug,
    description: n.description,
    keywords: n.keywords,
    excludeKeywords: n.excludeKeywords,
    active: n.active,
    createdAt: n.createdAt.toISOString(),
  };
}

function toCollectionDto(c: TrendCollectionEntity, topicCount: number): TrendCollectionDto {
  return {
    id: c.id,
    nicheId: c.nicheId,
    trigger: c.trigger,
    status: c.status,
    windowStart: c.windowStart.toISOString(),
    windowEnd: c.windowEnd.toISOString(),
    startedAt: c.startedAt?.toISOString() ?? null,
    finishedAt: c.finishedAt?.toISOString() ?? null,
    sourceResults: c.sourceResults,
    topicCount,
    jobId: c.jobId,
    createdAt: c.createdAt.toISOString(),
  };
}

function toTopicDto(t: TrendTopicEntity): TrendTopicDto {
  return {
    id: t.id,
    collectionId: t.collectionId,
    title: t.title,
    score: t.score,
    confidence: t.confidence,
    breakdown: t.breakdown,
    missingComponents: t.missingComponents,
    stale: t.stale,
    sources: t.sources,
    signalCount: t.signalCount,
    status: t.status,
    decidedAt: t.decidedAt?.toISOString() ?? null,
    decisionNote: t.decisionNote,
  };
}

export interface TopicQuery {
  status?: 'new' | 'approved' | 'rejected';
  minScore?: number;
  q?: string;
  sort?: 'score' | 'freshness' | 'confidence';
  limit: number;
  offset: number;
}

@Injectable()
export class ResearchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jobs: JobsService,
    @InjectRepository(NicheEntity) private readonly niches: Repository<NicheEntity>,
    @InjectRepository(TrendCollectionEntity) private readonly collections: Repository<TrendCollectionEntity>,
    @InjectRepository(TrendTopicEntity) private readonly topics: Repository<TrendTopicEntity>,
    @Inject(RESEARCH_ADAPTERS) private readonly adapters: ResearchAdapters,
  ) {}

  // ------------------------------------------------------------ sources

  async listSources(): Promise<ResearchSourceDto[]> {
    const rows = await this.dataSource.manager.find(ResearchSourceEntity, { order: { key: 'ASC' } });
    const configured = new Map<string, boolean>(this.adapters.discovery.map((a) => [a.key, a.isConfigured()]));
    configured.set('youtube', this.adapters.youtube.isConfigured());
    return rows.map((r) => ({
      key: r.key,
      name: r.name,
      enabled: r.enabled,
      configured: configured.get(r.key) ?? false,
      termsUrl: r.termsUrl,
      termsNotes: r.termsNotes,
    }));
  }

  // ------------------------------------------------------------ niches

  async listNiches(workspaceId: string): Promise<NicheDto[]> {
    return (await this.niches.find({ where: { workspaceId }, order: { createdAt: 'ASC' } })).map(toNicheDto);
  }

  async createNiche(workspaceId: string, body: UpsertNicheRequest): Promise<NicheDto> {
    const keywords = normalizeKeywords(body.keywords);
    if (!keywords.length) throw new BadRequestException('At least one keyword is required');
    const slug = nicheSlug(body.name);
    if (await this.niches.exists({ where: { workspaceId, slug } })) throw new ConflictException('A niche with this name already exists');
    const saved = await this.niches.save(
      this.niches.create({
        workspaceId,
        name: body.name.trim(),
        slug,
        description: body.description?.trim() ?? '',
        keywords,
        excludeKeywords: normalizeKeywords(body.excludeKeywords),
        active: body.active ?? true,
      }),
    );
    return toNicheDto(saved);
  }

  async updateNiche(workspaceId: string, id: string, body: Partial<UpsertNicheRequest>): Promise<NicheDto> {
    const niche = await this.niches.findOne({ where: { id, workspaceId } });
    if (!niche) throw new NotFoundException('Niche not found');
    if (body.name !== undefined) {
      niche.name = body.name.trim();
      niche.slug = nicheSlug(body.name);
    }
    if (body.description !== undefined) niche.description = body.description.trim();
    if (body.keywords !== undefined) {
      const k = normalizeKeywords(body.keywords);
      if (!k.length) throw new BadRequestException('At least one keyword is required');
      niche.keywords = k;
    }
    if (body.excludeKeywords !== undefined) niche.excludeKeywords = normalizeKeywords(body.excludeKeywords);
    if (body.active !== undefined) niche.active = body.active;
    return toNicheDto(await this.niches.save(niche));
  }

  // ------------------------------------------------------------ runs

  /**
   * Creates (or returns) the collection for `runKey` and enqueues its job. Both steps are idempotent, so a
   * retried request or a crash between them converges on exactly one collection and one job.
   */
  async startRun(input: {
    workspaceId: string;
    nicheId: string;
    trigger: 'manual' | 'scheduled';
    runKey: string;
    createdBy?: string | null;
    correlationId?: string | null;
    now?: Date;
  }): Promise<TrendCollectionDto> {
    const niche = await this.niches.findOne({ where: { id: input.nicheId, workspaceId: input.workspaceId } });
    if (!niche) throw new NotFoundException('Niche not found');
    if (!niche.active) throw new BadRequestException('Niche is inactive');
    const now = input.now ?? new Date();

    await this.collections
      .createQueryBuilder()
      .insert()
      .values({
        workspaceId: input.workspaceId,
        nicheId: niche.id,
        trigger: input.trigger,
        status: 'queued',
        runKey: input.runKey,
        windowStart: new Date(now.getTime() - RESEARCH_WINDOW_DAYS * 86_400_000),
        windowEnd: now,
      })
      .orIgnore()
      .execute();
    const collection = await this.collections.findOneByOrFail({ runKey: input.runKey });

    const { job } = await this.jobs.enqueue({
      type: JOB_TYPE_RESEARCH_COLLECT,
      queue: QUEUE_RESEARCH,
      idempotencyKey: `${JOB_TYPE_RESEARCH_COLLECT}:${input.runKey}`,
      input: { collectionId: collection.id },
      maxAttempts: 3,
      createdBy: input.createdBy ?? null,
      correlationId: input.correlationId ?? null,
      workspaceId: input.workspaceId,
    });
    if (collection.jobId !== job.id) {
      await this.collections.update({ id: collection.id }, { jobId: job.id });
      collection.jobId = job.id;
    }
    return toCollectionDto(collection, await this.topics.countBy({ collectionId: collection.id }));
  }

  /** Enqueues this week's scheduled run for every active niche (idempotent per niche and ISO week). */
  async scheduleWeekly(now = new Date()): Promise<number> {
    const active = await this.niches.find({ where: { active: true } });
    for (const n of active) {
      await this.startRun({ workspaceId: n.workspaceId, nicheId: n.id, trigger: 'scheduled', runKey: `scheduled:${n.id}:${isoWeek(now)}`, now });
    }
    return active.length;
  }

  async listCollections(workspaceId: string, nicheId: string | undefined, limit: number, offset: number): Promise<Page<TrendCollectionDto>> {
    const [rows, total] = await this.collections.findAndCount({
      where: { workspaceId, ...(nicheId ? { nicheId } : {}) },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    const counts = await this.topicCounts(rows.map((r) => r.id));
    return { items: rows.map((r) => toCollectionDto(r, counts.get(r.id) ?? 0)), total, limit, offset };
  }

  async getCollection(workspaceId: string, id: string): Promise<TrendCollectionDto> {
    const c = await this.collections.findOne({ where: { id, workspaceId } });
    if (!c) throw new NotFoundException('Collection not found');
    return toCollectionDto(c, await this.topics.countBy({ collectionId: id }));
  }

  async getReport(workspaceId: string, collectionId: string): Promise<WeeklyTrendReportDto> {
    await this.getCollection(workspaceId, collectionId);
    const r = await this.dataSource.manager.findOneBy(WeeklyTrendReportEntity, { collectionId });
    if (!r) throw new NotFoundException('Report not available yet');
    return { collectionId, generatedAt: r.generatedAt.toISOString(), markdown: r.markdown, limitations: r.limitations };
  }

  // ------------------------------------------------------------ topics

  async listTopics(workspaceId: string, collectionId: string, q: TopicQuery): Promise<Page<TrendTopicDto>> {
    await this.getCollection(workspaceId, collectionId);
    const qb = this.topics.createQueryBuilder('t').where('t.collection_id = :collectionId', { collectionId });
    if (q.status) qb.andWhere('t.status = :status', { status: q.status });
    if (q.minScore !== undefined) qb.andWhere('t.score >= :minScore', { minScore: q.minScore });
    if (q.q) qb.andWhere(`t.title ILIKE :q ESCAPE '\\'`, { q: `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` });
    const order = q.sort === 'freshness' ? 't.newest_signal_at' : q.sort === 'confidence' ? 't.confidence' : 't.score';
    qb.orderBy(order, 'DESC', 'NULLS LAST').addOrderBy('t.id', 'ASC').take(q.limit).skip(q.offset);
    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map(toTopicDto), total, limit: q.limit, offset: q.offset };
  }

  async getTopic(workspaceId: string, id: string): Promise<TrendTopicDetailDto> {
    const [detail] = await this.topicDetails(workspaceId, [id]);
    if (!detail) throw new NotFoundException('Topic not found');
    return detail;
  }

  async compare(workspaceId: string, ids: string[]): Promise<TrendTopicDetailDto[]> {
    const unique = [...new Set(ids)];
    if (unique.length < 2 || unique.length > 4) throw new BadRequestException('Compare needs 2 to 4 topic ids');
    const details = await this.topicDetails(workspaceId, unique);
    if (details.length !== unique.length) throw new NotFoundException('One or more topics not found');
    return unique.map((id) => details.find((d) => d.id === id)!);
  }

  async decide(workspaceId: string, id: string, userId: string, body: TopicDecisionRequest): Promise<TrendTopicDto> {
    const topic = await this.topics.findOne({ where: { id, workspaceId } });
    if (!topic) throw new NotFoundException('Topic not found');
    topic.status = body.decision;
    topic.decidedBy = userId;
    topic.decidedAt = new Date();
    topic.decisionNote = body.note?.trim() || null;
    return toTopicDto(await this.topics.save(topic));
  }

  private async topicDetails(workspaceId: string, ids: string[]): Promise<TrendTopicDetailDto[]> {
    const topics = await this.topics.find({ where: { id: In(ids), workspaceId } });
    if (!topics.length) return [];
    const signalRows = await this.dataSource.manager
      .createQueryBuilder(RawSignalEntity, 's')
      .innerJoin('trend_topic_signal', 'ts', 'ts.signal_id = s.id')
      .addSelect('ts.topic_id', 'topic_id')
      .where('ts.topic_id IN (:...ids)', { ids: topics.map((t) => t.id) })
      .orderBy('s.published_at', 'DESC', 'NULLS LAST')
      .getRawAndEntities();
    const metrics = await this.dataSource.manager.find(TrendMetricEntity, {
      where: { topicId: In(topics.map((t) => t.id)) },
      order: { name: 'ASC' },
    });
    return topics.map((t) => {
      const signals: TrendSignalDto[] = signalRows.entities
        .filter((_, i) => (signalRows.raw[i] as { topic_id: string }).topic_id === t.id)
        .map((s) => ({
          id: s.id,
          source: s.sourceKey,
          title: s.title,
          url: s.url,
          publishedAt: s.publishedAt?.toISOString() ?? null,
          retrievedAt: s.retrievedAt.toISOString(),
          metrics: s.metrics,
        }));
      const ms: TrendMetricDto[] = metrics
        .filter((m) => m.topicId === t.id)
        .map((m) => ({
          name: m.name,
          value: m.value,
          unit: m.unit,
          source: m.sourceKey,
          observedAt: m.observedAt.toISOString(),
          retrievedAt: m.retrievedAt.toISOString(),
        }));
      return { ...toTopicDto(t), signals, metrics: ms };
    });
  }

  private async topicCounts(collectionIds: string[]): Promise<Map<string, number>> {
    if (!collectionIds.length) return new Map();
    const rows = await this.topics
      .createQueryBuilder('t')
      .select('t.collection_id', 'id')
      .addSelect('count(*)::int', 'n')
      .where('t.collection_id IN (:...ids)', { ids: collectionIds })
      .groupBy('t.collection_id')
      .getRawMany<{ id: string; n: number }>();
    return new Map(rows.map((r) => [r.id, r.n]));
  }
}
