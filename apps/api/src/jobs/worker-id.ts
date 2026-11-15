import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

/** Unique identity of this worker process, recorded as the job lease owner. */
export const WORKER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
