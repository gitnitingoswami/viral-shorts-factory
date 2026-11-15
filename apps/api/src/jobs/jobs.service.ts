import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { In, LessThan, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { JobDto, Page } from '@vsf/contracts';
import { DEFAULT_WORKSPACE_ID, QUEUE_MAINTENANCE, QUEUE_RESEARCH } from '../common/constants';
import { JobEntity } from '../database/entities';

export interface EnqueueInput {
  type: string;
  queue: string;
  idempotencyKey: string;
  input?: Record<string, unknown>;
  maxAttempts?: number;
  createdBy?: string | null;
  correlationId?: string | null;
  workspaceId?: string;
}

export interface EnqueueResult {
  job: JobDto;
  created: boolean;
}

/** Payload carried by every BullMQ job: the Postgres row is the source of truth. */
export interface QueuePayload {
  jobId: string;
}

/** A job row claimed by a worker under a lease. */
export interface ClaimedJob {
  id: string;
  type: string;
  workspaceId: string;
  input: Record<string, unknown>;
  attempt: number;
}

export function toJobDto(j: JobEntity): JobDto {
  return {
    id: j.id,
    type: j.type,
    queue: j.queue,
    idempotencyKey: j.idempotencyKey,
    status: j.status,
    attempt: j.attempt,
    maxAttempts: j.maxAttempts,
    progress: j.progress,
    error: j.error,
    correlationId: j.correlationId,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly queues: Map<string, Queue>;

  constructor(
    @InjectRepository(JobEntity) private readonly repo: Repository<JobEntity>,
    @InjectQueue(QUEUE_MAINTENANCE) maintenanceQueue: Queue,
    @InjectQueue(QUEUE_RESEARCH) researchQueue: Queue,
  ) {
    this.queues = new Map([
      [QUEUE_MAINTENANCE, maintenanceQueue],
      [QUEUE_RESEARCH, researchQueue],
    ]);
  }

  /**
   * Claims a job for `workerId` under a lease (follow-up F-01). Succeeds only when the job is queued, or
   * running with an expired lease (its worker died or stalled), and attempts remain. A worker that is still
   * alive keeps its lease via heartbeat(), so the same job is never processed by two workers at once.
   */
  async claim(jobId: string, workerId: string, leaseMs: number): Promise<ClaimedJob | null> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        status: 'running',
        attempt: () => 'attempt + 1',
        startedAt: () => 'now()',
        error: null,
        leaseOwner: workerId,
        leaseUntil: () => `now() + make_interval(secs => ${Math.ceil(leaseMs / 1000)})`,
      })
      .where(
        `id = :jobId AND attempt < max_attempts AND (status = 'queued' OR (status = 'running' AND (lease_until IS NULL OR lease_until < now())))`,
        { jobId },
      )
      .returning(['id', 'type', 'workspace_id', 'input', 'attempt'])
      .execute();
    const row = (result.raw as Array<{ id: string; type: string; workspace_id: string; input: Record<string, unknown>; attempt: number }>)[0];
    if (!row) {
      // Out of attempts: fail it instead of retrying forever.
      await this.repo
        .createQueryBuilder()
        .update()
        .set({ status: 'failed', error: 'Max attempts exhausted', finishedAt: () => 'now()' })
        .where(`id = :jobId AND status IN ('queued', 'running') AND attempt >= max_attempts`, { jobId })
        .execute();
      return null;
    }
    return { id: row.id, type: row.type, workspaceId: row.workspace_id, input: row.input, attempt: row.attempt };
  }

  /** Extends the lease while work is in progress. Returns false if the lease was lost (stop working). */
  async heartbeat(jobId: string, workerId: string, leaseMs: number, progress?: number): Promise<boolean> {
    const res = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        leaseUntil: () => `now() + make_interval(secs => ${Math.ceil(leaseMs / 1000)})`,
        ...(progress === undefined ? {} : { progress: Math.max(0, Math.min(100, Math.round(progress))) }),
      })
      .where(`id = :jobId AND status = 'running' AND lease_owner = :workerId`, { jobId, workerId })
      .execute();
    return (res.affected ?? 0) > 0;
  }

  /** Marks the job completed, only if this worker still holds the lease. */
  async complete(jobId: string, workerId: string, output: Record<string, unknown>): Promise<boolean> {
    const res = await this.repo
      .createQueryBuilder()
      .update()
      .set({ status: 'completed', progress: 100, output, finishedAt: () => 'now()', leaseUntil: null } as QueryDeepPartialEntity<JobEntity>)
      .where(`id = :jobId AND status = 'running' AND lease_owner = :workerId`, { jobId, workerId })
      .execute();
    return (res.affected ?? 0) > 0;
  }

  /** Records a failed attempt: back to queued while attempts remain, otherwise failed. */
  async fail(jobId: string, workerId: string, message: string, final: boolean): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set(
        final
          ? { status: 'failed', error: message.slice(0, 500), finishedAt: () => 'now()', leaseUntil: null }
          : { status: 'queued', error: message.slice(0, 500), leaseUntil: null },
      )
      .where(`id = :jobId AND status = 'running' AND lease_owner = :workerId`, { jobId, workerId })
      .execute();
  }

  /**
   * Idempotent enqueue: the DB unique constraint on idempotency_key guarantees one job record per key,
   * and the BullMQ jobId equals the DB id so the queue also deduplicates.
   */
  async enqueue(e: EnqueueInput): Promise<EnqueueResult> {
    const queue = this.queues.get(e.queue);
    if (!queue) throw new Error(`Unknown queue: ${e.queue}`);

    const inserted = await this.repo
      .createQueryBuilder()
      .insert()
      .into(JobEntity)
      .values({
        workspaceId: e.workspaceId ?? DEFAULT_WORKSPACE_ID,
        type: e.type,
        queue: e.queue,
        idempotencyKey: e.idempotencyKey,
        status: 'queued',
        maxAttempts: e.maxAttempts ?? 3,
        input: e.input ?? {},
        createdBy: e.createdBy ?? null,
        correlationId: e.correlationId ?? null,
      } as QueryDeepPartialEntity<JobEntity>)
      .orIgnore() // ON CONFLICT DO NOTHING
      .returning(['id'])
      .execute();

    const created = (inserted.raw as unknown[]).length > 0;
    const job = await this.repo.findOneOrFail({ where: { idempotencyKey: e.idempotencyKey } });
    if (created) await this.dispatch(queue, job);
    return { job: toJobDto(job), created };
  }

  async get(id: string, workspaceId: string): Promise<JobDto> {
    const job = await this.repo.findOne({ where: { id, workspaceId } });
    if (!job) throw new NotFoundException('Job not found');
    return toJobDto(job);
  }

  /** Internal lookup without workspace scoping (worker use only; never exposed over HTTP). */
  getUnscoped(id: string): Promise<JobEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  async list(workspaceId: string, limit: number, offset: number): Promise<Page<JobDto>> {
    const [rows, total] = await this.repo.findAndCount({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items: rows.map(toJobDto), total, limit, offset };
  }

  /**
   * Re-dispatches jobs stuck in `queued` (e.g. Redis was down at enqueue time or lost data).
   * Safe to run repeatedly: BullMQ ignores a jobId that already exists.
   */
  async reconcileQueued(olderThanMs = 30_000): Promise<number> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ status: 'failed', error: 'Max attempts exhausted', finishedAt: () => 'now()' })
      .where(`status = 'queued' AND attempt >= max_attempts`)
      .execute();
    const stale = await this.repo.find({
      where: { status: In(['queued']), updatedAt: LessThan(new Date(Date.now() - olderThanMs)) },
      take: 500,
    });
    let count = 0;
    for (const job of stale) {
      const queue = this.queues.get(job.queue);
      if (!queue) continue;
      await this.dispatch(queue, job);
      count++;
    }
    return count;
  }

  /**
   * Recovers jobs left `running` past the timeout (e.g. the worker process died before recording the
   * outcome): requeue while attempts remain, otherwise mark failed. Returns the number of rows changed.
   */
  async sweepStaleRunning(timeoutMs: number): Promise<number> {
    // A running job is abandoned when its lease expired (worker died); legacy rows without a lease fall
    // back to the started_at timeout.
    const abandoned = `status = 'running' AND (lease_until < now() OR (lease_until IS NULL AND started_at < now() - make_interval(secs => :secs)))`;
    const requeued = await this.repo
      .createQueryBuilder()
      .update()
      .set({ status: 'queued', error: 'Recovered after worker lease expired', leaseOwner: null, leaseUntil: null })
      .where(`${abandoned} AND attempt < max_attempts`, { secs: timeoutMs / 1000 })
      .execute();
    const failed = await this.repo
      .createQueryBuilder()
      .update()
      .set({ status: 'failed', error: 'Lease expired on final attempt', finishedAt: () => 'now()', leaseUntil: null })
      .where(`${abandoned} AND attempt >= max_attempts`, { secs: timeoutMs / 1000 })
      .execute();
    return (requeued.affected ?? 0) + (failed.affected ?? 0);
  }

  private async dispatch(queue: Queue, job: JobEntity): Promise<void> {
    try {
      // BullMQ ignores add() for a jobId it still holds. A finished entry (e.g. a job recovered after a
      // worker crash) must be removed first; a waiting/active/delayed entry means it is already queued.
      const existing = await queue.getJob(job.id);
      if (existing) {
        const state = await existing.getState();
        if (state !== 'completed' && state !== 'failed') return;
        await existing.remove();
      }
      await queue.add(job.type, { jobId: job.id } satisfies QueuePayload, {
        jobId: job.id,
        attempts: job.maxAttempts,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 86_400, count: 1000 },
        removeOnFail: { age: 7 * 86_400 },
      });
    } catch (err) {
      // The DB row stays `queued`; the worker's reconciler re-dispatches it later.
      this.logger.error({ err, jobId: job.id }, 'Failed to dispatch job to queue');
    }
  }
}
