import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STALE_QUEUED_MS, STALE_RUNNING_MS } from '../common/constants';
import type { AppEnv } from '../config/env.schema';
import { JobsService } from './jobs.service';

/**
 * Worker-side safety net that makes jobs recoverable without a restart:
 * - re-dispatches `queued` rows whose queue message was lost (e.g. Redis was down at enqueue time);
 * - recovers `running` rows abandoned by a crashed worker.
 * Runs once at startup and then every JOB_RECONCILE_INTERVAL_MS. Safe to run concurrently in several
 * workers: dispatch is deduplicated by BullMQ jobId and the sweeps are single UPDATE statements.
 */
@Injectable()
export class JobsReconciler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobsReconciler.name);
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly jobs: JobsService,
    config: ConfigService<AppEnv, true>,
  ) {
    this.intervalMs = config.get('JOB_RECONCILE_INTERVAL_MS', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.tick(0);
    this.timer = setInterval(() => void this.tick(STALE_QUEUED_MS), this.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One reconciliation pass. Exposed for tests. */
  async tick(staleQueuedMs: number): Promise<{ recovered: number; dispatched: number }> {
    if (this.running) return { recovered: 0, dispatched: 0 };
    this.running = true;
    try {
      const recovered = await this.jobs.sweepStaleRunning(STALE_RUNNING_MS);
      const dispatched = await this.jobs.reconcileQueued(recovered > 0 ? 0 : staleQueuedMs);
      if (recovered || dispatched) this.logger.log({ recovered, dispatched }, 'Reconciled jobs');
      return { recovered, dispatched };
    } catch (err) {
      this.logger.error({ err }, 'Job reconciliation failed');
      return { recovered: 0, dispatched: 0 };
    } finally {
      this.running = false;
    }
  }
}
