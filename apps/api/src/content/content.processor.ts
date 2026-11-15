import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import { JOB_TYPE_CONTENT_CHECKS, JOB_TYPE_CONTENT_IDEAS, JOB_TYPE_CONTENT_SCRIPT, QUEUE_CONTENT } from '../common/constants';
import type { AppEnv } from '../config/env.schema';
import { JobsService, QueuePayload } from '../jobs/jobs.service';
import { WORKER_ID } from '../jobs/worker-id';
import { LlmNonRetryableError } from '../llm/llm.types';
import { ContentPipeline } from './content.pipeline';

/**
 * Worker for the `content` queue (ideas, script generation, checks). Lease-based like every DB-tracked job.
 * Non-retryable LLM failures (refusal, malformed output, truncation, auth, budget) fail the job immediately
 * instead of burning retries and tokens.
 */
@Processor(QUEUE_CONTENT, { concurrency: 1 })
export class ContentProcessor extends WorkerHost {
  private readonly logger = new Logger(ContentProcessor.name);
  private readonly leaseMs: number;

  constructor(
    private readonly jobs: JobsService,
    private readonly pipeline: ContentPipeline,
    private readonly audit: AuditService,
    config: ConfigService<AppEnv, true>,
  ) {
    super();
    this.leaseMs = config.get('JOB_LEASE_MS', { infer: true });
  }

  async process(job: Job<QueuePayload>): Promise<Record<string, unknown>> {
    const claimed = await this.jobs.claim(job.data.jobId, WORKER_ID, this.leaseMs);
    if (!claimed) return { skipped: true };
    const heartbeat = (p: number) => this.jobs.heartbeat(claimed.id, WORKER_ID, this.leaseMs, p);
    const ws = claimed.workspaceId;
    try {
      let output: Record<string, unknown>;
      switch (claimed.type) {
        case JOB_TYPE_CONTENT_IDEAS:
          output = await this.pipeline.generateIdeas(String(claimed.input.topicId), ws, claimed.id);
          break;
        case JOB_TYPE_CONTENT_SCRIPT:
          output = await this.pipeline.generateScript(String(claimed.input.scriptId), ws, claimed.id);
          break;
        case JOB_TYPE_CONTENT_CHECKS:
          output = await this.pipeline.runChecks(String(claimed.input.versionId), ws, claimed.id, heartbeat);
          break;
        default:
          throw new UnrecoverableError(`Unsupported job type: ${claimed.type}`);
      }
      if (await this.jobs.complete(claimed.id, WORKER_ID, output)) {
        await this.audit.record({ actorType: 'worker', workspaceId: ws, action: 'job.completed', subjectType: 'job', subjectId: claimed.id, outcome: 'success', details: { type: claimed.type } });
      }
      return output;
    } catch (err) {
      if (err instanceof LlmNonRetryableError) {
        this.logger.warn({ jobId: claimed.id, kind: err.kind }, 'Non-retryable LLM failure');
        throw new UnrecoverableError(`${err.kind}: ${err.message}`);
      }
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<QueuePayload> | undefined, err: Error): Promise<void> {
    if (!job?.data?.jobId) return;
    const final = err instanceof UnrecoverableError || err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
    await this.jobs.fail(job.data.jobId, WORKER_ID, err.message, final);
    if (!final) return;
    const row = await this.jobs.getUnscoped(job.data.jobId);
    if (row?.type === JOB_TYPE_CONTENT_CHECKS && typeof row.input.versionId === 'string') {
      await this.pipeline.markChecksFailed(row.input.versionId);
    }
    await this.audit.record({ actorType: 'worker', workspaceId: row?.workspaceId, action: 'job.failed', subjectType: 'job', subjectId: job.data.jobId, outcome: 'failure', details: { type: row?.type, error: err.message.slice(0, 200) } });
  }
}
