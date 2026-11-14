import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { DependencyCheck, DependencyName, ReadinessResponse } from '@vsf/contracts';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.schema';
import { RedisHealthService } from '../infra/redis-health.service';
import { StorageService } from '../infra/storage.service';

export const CHECK_TIMEOUT_MS = 2000;

/** Runs a probe with a timeout and turns the outcome into a DependencyCheck. Never throws. */
export async function runCheck(
  probe: () => Promise<unknown>,
  exposeErrors: boolean,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<DependencyCheck> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return { status: 'up', latencyMs: Date.now() - started };
  } catch (err) {
    const detail = err instanceof Error ? err.message || err.name : 'unknown error';
    return {
      status: 'down',
      latencyMs: Date.now() - started,
      error: exposeErrors ? detail.slice(0, 200) : 'unavailable',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  private readonly version: string;
  private readonly exposeErrors: boolean;

  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisHealthService,
    private readonly storage: StorageService,
    config: ConfigService<AppEnv, true>,
  ) {
    const c = config;
    this.version = c.get('APP_VERSION', { infer: true });
    // Detailed error text is useful locally but must not leak infrastructure details in production.
    this.exposeErrors = c.get('NODE_ENV', { infer: true }) !== 'production';
  }

  async readiness(): Promise<ReadinessResponse> {
    const [database, redis, storage] = await Promise.all([
      runCheck(() => this.dataSource.query('SELECT 1'), this.exposeErrors),
      runCheck(() => this.redis.ping(), this.exposeErrors),
      runCheck(() => this.storage.ping(), this.exposeErrors),
    ]);
    const checks: Record<DependencyName, DependencyCheck> = { database, redis, storage };
    const allUp = Object.values(checks).every((c) => c.status === 'up');
    return {
      status: allUp ? 'ok' : 'degraded',
      checks,
      version: this.version,
      timestamp: new Date().toISOString(),
    };
  }
}
