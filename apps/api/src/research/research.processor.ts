import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import { JOB_NAME_RESEARCH_SCHEDULE, JOB_TYPE_RESEARCH_COLLECT, QUEUE_RESEARCH } from '../common/constants';
import type { AppEnv } from '../config/env.schema';
import { JobsService, QueuePayload } from '../jobs/jobs.service';
import { WORKER_ID } from '../jobs/worker-id';
import { ResearchPipeline } from './research.pipeline';
import { ResearchService } from './research.service';

export const JOB_NAME_RESEARCH_PURGE = 'research.purge';

/**
 * Worker for the `research` queue:
 * - `research.collect`: a DB-tracked job (lease-based claim) that runs one collection;
 * - `research.schedule`: cron tick that enqueues this week's run for every active niche (idempotent);
 * - `research.purge`: hourly deletion/redaction of YouTube-derived data past its 30-day retention.
 */
@Processor(QUEUE_RESEARCH, { concurrency: 1 })
export class ResearchProcessor extends WorkerHost {
  private readonly logger = new Logger(ResearchProcessor.name);
  private readonly leaseMs: number;

  constructor(
    private readonly jobs: JobsService,
    private readonly pipeline: ResearchPipeline,
    private readonly research: ResearchService,
    private readonly audit: AuditService,
    config: ConfigService<AppEnv, true>,
  ) {
    super();
    this.leaseMs = config.get('JOB_LEASE_MS', { infer: true });
  }

  async process(job: Job<QueuePayload | Record<string, never>>): Promise<Record<string, unknown>> {
    if (job.name === JOB_NAME_RESEARCH_SCHEDULE) return { niches: await this.research.scheduleWeekly() };
    if (job.name === JOB_NAME_RESEARCH_PURGE) return { purged: await this.pipeline.purgeExpired() };

    const { jobId } = job.data as QueuePayload;
    const claimed = await this.jobs.claim(jobId, WORKER_ID, this.leaseMs);
    if (!claimed) {
      // Attempts may be exhausted (claim marks the job failed): make sure its collection doesn't stay running.
      await this.pipeline.failOrphanedCollections();
      return { skipped: true };
    }
    if (claimed.type !== JOB_TYPE_RESEARCH_COLLECT) throw new Error(`Unsupported job type: ${claimed.type}`);

    const collectionId = String(claimed.input.collectionId);
    const result = await this.pipeline.run(
      collectionId,
      (progress) => this.jobs.heartbeat(claimed.id, WORKER_ID, this.leaseMs, progress),
      claimed.id,
    );
    if (await this.jobs.complete(claimed.id, WORKER_ID, { collectionId, ...result })) {
      await this.audit.record({
        actorType: 'worker',
        workspaceId: claimed.workspaceId,
        action: 'research.collection_finished',
        subjectType: 'trend_collection',
        subjectId: collectionId,
        outcome: result.status === 'failed' ? 'failure' : 'success',
        details: { status: result.status, topics: result.topics },
      });
    }
    return { collectionId, ...result };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<QueuePayload> | undefined, err: Error): Promise<void> {
    if (!job || job.name !== JOB_TYPE_RESEARCH_COLLECT || !job.data?.jobId) {
      if (job) this.logger.error({ name: job.name, err: err.message }, 'Research scheduler job failed');
      return;
    }
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    await this.jobs.fail(job.data.jobId, WORKER_ID, err.message, final);
    if (final) {
      const row = await this.jobs.getUnscoped(job.data.jobId);
      const collectionId = row?.input?.collectionId;
      if (typeof collectionId === 'string') await this.pipeline.markFailed(collectionId);
      await this.audit.record({ actorType: 'worker', workspaceId: row?.workspaceId, action: 'job.failed', subjectType: 'job', subjectId: job.data.jobId, outcome: 'failure', details: { type: JOB_TYPE_RESEARCH_COLLECT } });
    }
  }
}

/**
 * Registers the repeatable weekly research and daily purge schedules (idempotent upserts), and periodically
 * fails collections whose jobs failed outside the processor (lease sweeper, exhausted attempts).
 */
@Injectable()
export class ResearchScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ResearchScheduler.name);
  private readonly cron: string;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectQueue(QUEUE_RESEARCH) private readonly queue: Queue,
    private readonly pipeline: ResearchPipeline,
    config: ConfigService<AppEnv, true>,
  ) {
    this.cron = config.get('RESEARCH_CRON', { infer: true });
    this.intervalMs = config.get('JOB_RECONCILE_INTERVAL_MS', { infer: true });
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async onApplicationBootstrap(): Promise<void> {
    this.timer = setInterval(() => {
      this.pipeline.failOrphanedCollections().catch((err: unknown) => this.logger.error({ err }, 'Collection reconcile failed'));
    }, this.intervalMs);
    this.timer.unref();
    await this.queue.upsertJobScheduler('research-weekly', { pattern: this.cron, tz: 'UTC' }, { name: JOB_NAME_RESEARCH_SCHEDULE, data: {} });
    await this.queue.removeJobScheduler('research-purge-daily'); // replaced by the hourly schedule
    await this.queue.upsertJobScheduler('research-purge-hourly', { pattern: '7 * * * *', tz: 'UTC' }, { name: JOB_NAME_RESEARCH_PURGE, data: {} });
    this.logger.log(`Research schedule registered: "${this.cron}" (UTC); purge hourly`);
  }
}
