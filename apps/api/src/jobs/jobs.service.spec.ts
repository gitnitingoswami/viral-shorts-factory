import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { QUEUE_MAINTENANCE } from '../common/constants';
import { JobEntity } from '../database/entities';
import { JobsService } from './jobs.service';

function jobRow(id = 'j1'): JobEntity {
  const now = new Date();
  return Object.assign(new JobEntity(), {
    id,
    workspaceId: 'w',
    type: 'maintenance.ping',
    queue: QUEUE_MAINTENANCE,
    idempotencyKey: 'k1',
    status: 'queued',
    attempt: 0,
    maxAttempts: 3,
    progress: 0,
    input: {},
    output: null,
    error: null,
    correlationId: null,
    createdBy: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

function setup(insertedRows: unknown[], addImpl?: () => Promise<unknown>) {
  const execute = jest.fn().mockResolvedValue({ raw: insertedRows });
  const qb = { insert: () => qb, into: () => qb, values: () => qb, orIgnore: () => qb, returning: () => qb, execute };
  const repo = {
    createQueryBuilder: () => qb,
    findOneOrFail: jest.fn().mockResolvedValue(jobRow()),
    find: jest.fn().mockResolvedValue([jobRow('a'), jobRow('b')]),
  } as unknown as Repository<JobEntity>;
  const queue = { add: jest.fn(addImpl ?? (() => Promise.resolve({}))) } as unknown as Queue;
  return { service: new JobsService(repo, queue), queue };
}

describe('JobsService.enqueue', () => {
  it('dispatches a newly created job with jobId = DB id and retry policy', async () => {
    const { service, queue } = setup([{ id: 'j1' }]);
    const r = await service.enqueue({ type: 'maintenance.ping', queue: QUEUE_MAINTENANCE, idempotencyKey: 'k1' });
    expect(r.created).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      'maintenance.ping',
      { jobId: 'j1' },
      expect.objectContaining({ jobId: 'j1', attempts: 3, backoff: { type: 'exponential', delay: 2000 } }),
    );
  });

  it('returns the existing job and does not dispatch again for a duplicate key', async () => {
    const { service, queue } = setup([]);
    const r = await service.enqueue({ type: 'maintenance.ping', queue: QUEUE_MAINTENANCE, idempotencyKey: 'k1' });
    expect(r.created).toBe(false);
    expect(r.job.id).toBe('j1');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('keeps the job queued (no throw) when the queue is unavailable', async () => {
    const { service } = setup([{ id: 'j1' }], () => Promise.reject(new Error('redis down')));
    await expect(service.enqueue({ type: 'maintenance.ping', queue: QUEUE_MAINTENANCE, idempotencyKey: 'k1' })).resolves.toMatchObject({ created: true });
  });

  it('rejects an unknown queue', async () => {
    const { service } = setup([]);
    await expect(service.enqueue({ type: 't', queue: 'nope', idempotencyKey: 'k' })).rejects.toThrow(/Unknown queue/);
  });
});

describe('JobsService.reconcileQueued', () => {
  it('re-dispatches stale queued jobs', async () => {
    const { service, queue } = setup([]);
    await expect(service.reconcileQueued(0)).resolves.toBe(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });
});
