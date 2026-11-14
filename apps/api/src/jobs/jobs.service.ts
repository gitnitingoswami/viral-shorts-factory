import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { In, LessThan, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { JobDto, Page } from '@vsf/contracts';
import { DEFAULT_WORKSPACE_ID, QUEUE_MAINTENANCE } from '../common/constants';
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
  ) {
    this.queues = new Map([[QUEUE_MAINTENANCE, maintenanceQueue]]);
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

  private async dispatch(queue: Queue, job: JobEntity): Promise<void> {
    try {
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
