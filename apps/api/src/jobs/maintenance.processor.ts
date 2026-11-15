import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { JOB_TYPE_PING, QUEUE_MAINTENANCE } from '../common/constants';
import type { AppEnv } from '../config/env.schema';
import { JobsService, QueuePayload } from './jobs.service';
import { WORKER_ID } from './worker-id';

/**
 * Worker for the `maintenance` queue. The Postgres job row is the source of truth; work happens only under a
 * lease held by this worker (claim → work → complete/fail). Only registered in the worker process.
 */
@Processor(QUEUE_MAINTENANCE, { concurrency: 2 })
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);
  private readonly leaseMs: number;

  constructor(
    private readonly jobs: JobsService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    config: ConfigService<AppEnv, true>,
  ) {
    super();
    this.leaseMs = config.get('JOB_LEASE_MS', { infer: true });
  }

  async process(job: Job<QueuePayload>): Promise<Record<string, unknown>> {
    const claimed = await this.jobs.claim(job.data.jobId, WORKER_ID, this.leaseMs);
    if (!claimed) {
      this.logger.warn({ jobId: job.data.jobId }, 'Job not claimable (finished, leased elsewhere, or out of attempts)');
      return { skipped: true };
    }

    switch (claimed.type) {
      case JOB_TYPE_PING: {
        const started = Date.now();
        await this.dataSource.query('SELECT 1');
        const output = { pong: true, dbLatencyMs: Date.now() - started };
        if (await this.jobs.complete(claimed.id, WORKER_ID, output)) {
          await this.audit.record({ actorType: 'worker', workspaceId: claimed.workspaceId, action: 'job.completed', subjectType: 'job', subjectId: claimed.id, outcome: 'success', details: { type: claimed.type } });
        }
        return output;
      }
      default:
        throw new Error(`Unsupported job type: ${claimed.type}`);
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<QueuePayload> | undefined, err: Error): Promise<void> {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    await this.jobs.fail(job.data.jobId, WORKER_ID, err.message, final);
    if (final) {
      await this.audit.record({ actorType: 'worker', action: 'job.failed', subjectType: 'job', subjectId: job.data.jobId, outcome: 'failure', details: { error: err.message.slice(0, 200) } });
    }
  }
}
