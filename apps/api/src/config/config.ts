import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { AppEnv, validateEnv } from './env.schema';

/** Typed ConfigService: `config.get('DB_HOST', { infer: true })`. */
export type AppConfigService = ConfigService<AppEnv, true>;

export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  // Repo-root .env first, then a package-local .env (both git-ignored).
  envFilePath: [join(__dirname, '..', '..', '..', '..', '.env'), join(process.cwd(), '.env')],
  validate: validateEnv,
});
