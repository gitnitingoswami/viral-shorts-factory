import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import type { UserRole } from '@vsf/contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { dataSourceOptions } from '../src/database/options';
import { RESEARCH_HTTP } from '../src/research/adapters.provider';
import type { HttpGet } from '../src/research/http';
import { UsersService } from '../src/users/users.service';
import { WorkerModule } from '../src/worker.module';

export function testDataSource(): DataSource {
  const e = process.env;
  return new DataSource(
    dataSourceOptions({
      host: e.DB_HOST!,
      port: Number(e.DB_PORT),
      username: e.DB_USER!,
      password: e.DB_PASSWORD!,
      database: e.DB_NAME!,
    }),
  );
}

/**
 * Drops and recreates the schema of the disposable test database, then runs all migrations.
 * Refuses to touch any database whose name does not end in `_test`.
 */
export async function resetTestDatabase(): Promise<void> {
  const name = process.env.DB_NAME ?? '';
  if (!name.endsWith('_test')) throw new Error(`Refusing to reset non-test database "${name}"`);
  const ds = await testDataSource().initialize();
  try {
    await ds.query('DROP SCHEMA IF EXISTS public CASCADE');
    await ds.query('CREATE SCHEMA public');
    await ds.runMigrations({ transaction: 'each' });
  } finally {
    await ds.destroy();
  }
}

/** Research HTTP that never touches the network unless a test provides fixtures. */
const offlineHttp: HttpGet = (url) => Promise.reject(new Error(`network disabled in tests: ${new URL(url).hostname}`));

export async function createTestApp(http: HttpGet = offlineHttp): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(RESEARCH_HTTP).useValue(http).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

export async function createWorker(http: HttpGet = offlineHttp): Promise<INestApplicationContext> {
  const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(RESEARCH_HTTP).useValue(http).compile();
  moduleRef.useLogger(false);
  await moduleRef.init();
  return moduleRef;
}

export async function createUser(app: INestApplication, email: string, password: string, role: UserRole) {
  return app.get(UsersService).create({ email, password, role });
}

export async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('waitFor timed out');
}

/** Extracts `name=value` of a Set-Cookie header for the given cookie. */
export function cookieFrom(setCookie: string[] | string | undefined, name: string): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.find((c) => c.startsWith(`${name}=`))?.split(';')[0];
}
