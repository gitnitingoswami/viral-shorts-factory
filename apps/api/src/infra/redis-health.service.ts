import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.schema';

/** Dedicated, fail-fast Redis connection for readiness checks (separate from BullMQ's connections). */
@Injectable()
export class RedisHealthService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: ConfigService<AppEnv, true>) {
    const c = config;
    this.client = new Redis({
      host: c.get('REDIS_HOST', { infer: true }),
      port: c.get('REDIS_PORT', { infer: true }),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    this.client.on('error', () => {
      /* surfaced through ping(); avoid unhandled error events */
    });
  }

  async ping(): Promise<void> {
    if (this.client.status === 'wait') await this.client.connect();
    const reply = await this.client.ping();
    if (reply !== 'PONG') throw new Error(`Unexpected PING reply: ${String(reply)}`);
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
