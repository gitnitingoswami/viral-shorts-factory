import { DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from './entities';
import { InitialSchema1763150000000 } from './migrations/1763150000000-InitialSchema';

/** Ordered list of migrations. Add new migrations here (explicit list, no glob, so builds and tests agree). */
export const MIGRATIONS = [InitialSchema1763150000000];

export interface DbSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export function dataSourceOptions(db: DbSettings): DataSourceOptions {
  return {
    type: 'postgres',
    ...db,
    entities: ALL_ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: 'schema_migrations',
    synchronize: false,
    logging: ['error', 'warn'],
  };
}
