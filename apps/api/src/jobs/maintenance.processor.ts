import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { JOB_TYPE_PING, QUEUE_MAINTENANCE } from '../common/constants';
import { JobEntity } from '../database/entities';
import type { QueuePayload } from './jobs.service';

/**
 * Worker for the `maintenance` queue. Each step updates the Postgres job row, which is the source of
 * truth for status, attempts and progress. Only registered in the worker process (src/worker.ts).
 */
@Processor(QUEUE_MAINTENANCE, { concurrency: 2 })
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    @InjectRepository(JobEntity) private readonly repo: Repository<JobEntity>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job<QueuePayload>): Promise<Record<string, unknown>> {
    const { jobId } = job.data;
    // Claim: only unfinished rows with attempts left can move to running (see follow-up F-01 for leases).
    const claimed = await this.repo
      .createQueryBuilder()
      .update()
      .set({ status: 'running', attempt: () => 'attempt + 1', startedAt: () => 'now()', error: null })
      .where('id = :jobId AND status IN (:...statuses) AND attempt < max_attempts', { jobId, statuses: ['queued', 'running'] })
      .returning(['id', 'type', 'workspace_id'])
      .execute();
    const row = (claimed.raw as Array<{ id: string; type: string; workspace_id: string }>)[0];
    if (!row) {
      // Attempts exhausted (e.g. the job kept crashing the worker): fail it instead of retrying forever.
      await this.repo
        .createQueryBuilder()
        .update()
        .set({ status: 'failed', error: 'Max attempts exhausted', finishedAt: () => 'now()' })
        .where(`id = :jobId AND status IN ('queued', 'running') AND attempt >= max_attempts`, { jobId })
        .execute();
      this.logger.warn({ jobId }, 'Job finished, cancelled or out of attempts; skipping');
      return { skipped: true };
    }

    switch (row.type) {
      case JOB_TYPE_PING: {
        const started = Date.now();
        await this.dataSource.query('SELECT 1');
        const output = { pong: true, dbLatencyMs: Date.now() - started };
        await this.repo.update(jobId, { status: 'completed', progress: 100, output, finishedAt: new Date() });
        await this.audit.record({ actorType: 'worker', workspaceId: row.workspace_id, action: 'job.completed', subjectType: 'job', subjectId: jobId, outcome: 'success', details: { type: row.type } });
        return output;
      }
      default:
        throw new Error(`Unsupported job type: ${row.type}`);
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<QueuePayload> | undefined, err: Error): Promise<void> {
    if (!job) return;
    const finalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
    await this.repo.update(
      { id: job.data.jobId, status: In(['running', 'queued']) },
      finalAttempt
        ? { status: 'failed', error: err.message.slice(0, 500), finishedAt: new Date() }
        : { status: 'queued', error: err.message.slice(0, 500) },
    );
    if (finalAttempt) {
      const owner = await this.repo.findOne({ where: { id: job.data.jobId }, select: { id: true, workspaceId: true } });
      await this.audit.record({ actorType: 'worker', workspaceId: owner?.workspaceId, action: 'job.failed', subjectType: 'job', subjectId: job.data.jobId, outcome: 'failure', details: { error: err.message.slice(0, 200) } });
    }
  }
}
