import { Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { JOB_TYPE_VIDEO_RENDER, QUEUE_RENDER } from '../common/constants';
import type { AppEnv } from '../config/env.schema';
import { JobsService, QueuePayload } from '../jobs/jobs.service';
import { WORKER_ID } from '../jobs/worker-id';
import { ABORT_CANCEL, ABORT_LEASE, RenderCancelledError, RenderLeaseLostError, RenderNonRetryableError, VideoPipeline } from './video.pipeline';

/** How often a running render renews its lease and checks for a cancellation request. */
export const RENDER_POLL_MS = 2000;

/**
 * Worker for the `render` queue. Concurrency is bounded by RENDER_CONCURRENCY (rendering is CPU-bound).
 * Lease-based like every DB-tracked job; a background poll renews the lease and aborts the render (killing
 * FFmpeg) when the user cancels or the lease is lost.
 */
@Processor(QUEUE_RENDER, { concurrency: 1 })
export class VideoProcessor extends WorkerHost implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(VideoProcessor.name);
  private readonly leaseMs: number;
  private readonly concurrency: number;
  private readonly reconcileMs: number;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly jobs: JobsService,
    private readonly pipeline: VideoPipeline,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
    config: ConfigService<AppEnv, true>,
  ) {
    super();
    this.leaseMs = config.get('JOB_LEASE_MS', { infer: true });
    this.concurrency = config.get('RENDER_CONCURRENCY', { infer: true });
    this.reconcileMs = config.get('JOB_RECONCILE_INTERVAL_MS', { infer: true });
  }

  onApplicationBootstrap(): void {
    this.worker.concurrency = this.concurrency;
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), this.reconcileMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Productions whose render job ended without the worker recording it (e.g. the job's lease expired on its final
   * attempt, or it was failed before being claimed) are marked failed so they never stay "rendering". Exposed for tests.
   */
  async reconcile(): Promise<number> {
    try {
      const [, affected] = await this.dataSource.query<[unknown[], number]>(
        `UPDATE video_production p SET status = CASE WHEN j.status = 'cancelled' THEN 'cancelled' ELSE 'failed' END,
                error = COALESCE(j.error, 'Render job ended without a result'), updated_at = now()
           FROM job j
          WHERE p.job_id = j.id AND p.status IN ('queued', 'rendering') AND j.status IN ('failed', 'cancelled')`,
      );
      return affected ?? 0;
    } catch (err) {
      this.logger.error({ err }, 'Production reconciliation failed');
      return 0;
    }
  }

  async process(job: Job<QueuePayload>): Promise<Record<string, unknown>> {
    const claimed = await this.jobs.claim(job.data.jobId, WORKER_ID, this.leaseMs);
    if (!claimed) return { skipped: true };
    if (claimed.type !== JOB_TYPE_VIDEO_RENDER) throw new UnrecoverableError(`Unsupported job type: ${claimed.type}`);
    const productionId = String(claimed.input.productionId);
    const ac = new AbortController();
    let progress = 0;
    const poll = setInterval(() => {
      void (async () => {
        if (ac.signal.aborted) return;
        if (!(await this.jobs.heartbeat(claimed.id, WORKER_ID, this.leaseMs, progress))) ac.abort(ABORT_LEASE);
        else if (await this.cancelRequested(productionId)) ac.abort(ABORT_CANCEL);
      })().catch((err: unknown) => this.logger.warn({ err }, 'Render poll failed'));
    }, RENDER_POLL_MS);
    try {
      const out = await this.pipeline.render(productionId, {
        jobId: claimed.id,
        workerId: WORKER_ID,
        workspaceId: claimed.workspaceId,
        signal: ac.signal,
        heartbeat: async (p) => {
          progress = p;
          return this.jobs.heartbeat(claimed.id, WORKER_ID, this.leaseMs, p);
        },
      });
      if (out.status === 'cancelled') {
        await this.jobs.cancelRunning(claimed.id, WORKER_ID, 'Cancelled by user');
      } else if (await this.jobs.complete(claimed.id, WORKER_ID, { ...out })) {
        await this.audit.record({ actorType: 'worker', workspaceId: claimed.workspaceId, action: 'job.completed', subjectType: 'job', subjectId: claimed.id, outcome: 'success', details: { type: claimed.type, status: out.status } });
      }
      return { ...out };
    } catch (err) {
      if (err instanceof RenderCancelledError) {
        await this.pipeline.markCancelled(productionId, { jobId: claimed.id });
        await this.jobs.cancelRunning(claimed.id, WORKER_ID, 'Cancelled by user');
        return { productionId, status: 'cancelled' };
      }
      if (err instanceof RenderLeaseLostError) {
        // Another worker owns the job now: record nothing; its run decides the outcome.
        this.logger.warn({ jobId: claimed.id }, 'Render lease lost; abandoning this attempt');
        return { leaseLost: true };
      }
      if (err instanceof RenderNonRetryableError) throw new UnrecoverableError(err.message);
      throw err;
    } finally {
      clearInterval(poll);
    }
  }

  private async cancelRequested(productionId: string): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ cancel_requested: boolean }>>(`SELECT cancel_requested FROM video_production WHERE id = $1`, [productionId]);
    return rows[0]?.cancel_requested === true;
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<QueuePayload> | undefined, err: Error): Promise<void> {
    if (!job?.data?.jobId) return;
    const final = err instanceof UnrecoverableError || err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
    const stillOwner = await this.jobs.fail(job.data.jobId, WORKER_ID, err.message, final);
    if (!stillOwner) return;
    const row = await this.jobs.getUnscoped(job.data.jobId);
    const productionId = typeof row?.input.productionId === 'string' ? row.input.productionId : null;
    if (!productionId) return;
    if (final) {
      await this.pipeline.markFailed(productionId, job.data.jobId, err.message);
      await this.audit.record({ actorType: 'worker', workspaceId: row?.workspaceId, action: 'job.failed', subjectType: 'job', subjectId: job.data.jobId, outcome: 'failure', details: { type: row?.type, productionId, error: err.message.slice(0, 200) } });
    } else {
      await this.pipeline.markRetrying(productionId, job.data.jobId, err.message);
    }
  }
}
