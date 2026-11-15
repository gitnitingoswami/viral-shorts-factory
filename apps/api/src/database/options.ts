import { DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from './entities';
import { InitialSchema1763150000000 } from './migrations/1763150000000-InitialSchema';
import { AuthAndAuditHardening1763240000000 } from './migrations/1763240000000-AuthAndAuditHardening';
import { TrendResearch1763330000000 } from './migrations/1763330000000-TrendResearch';
import { ResearchReviewFixes1763340000000 } from './migrations/1763340000000-ResearchReviewFixes';

/** Ordered list of migrations. Add new migrations here (explicit list, no glob, so builds and tests agree). */
export const MIGRATIONS = [InitialSchema1763150000000, AuthAndAuditHardening1763240000000, TrendResearch1763330000000, ResearchReviewFixes1763340000000];

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
