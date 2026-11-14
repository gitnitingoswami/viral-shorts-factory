import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './options';

/** DataSource used by the TypeORM CLI (`npm run migration:run`). Reads the repo-root .env if present. */
function cliDataSource(): DataSource {
  const rootEnv = join(__dirname, '..', '..', '..', '..', '.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const e = process.env;
  const missing = ['DB_USER', 'DB_PASSWORD', 'DB_NAME'].filter((k) => !e[k]);
  if (missing.length) throw new Error(`Missing env for migrations: ${missing.join(', ')}`);
  return new DataSource(
    dataSourceOptions({
      host: e.DB_HOST ?? 'localhost',
      port: Number(e.DB_PORT ?? 55432),
      username: e.DB_USER!,
      password: e.DB_PASSWORD!,
      database: e.DB_NAME!,
    }),
  );
}

export default cliDataSource();
