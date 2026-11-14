import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/config';
import { dataSourceOptions } from './options';

export const DatabaseModule = TypeOrmModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: AppConfigService) => ({
    ...dataSourceOptions({
      host: config.get('DB_HOST', { infer: true }),
      port: config.get('DB_PORT', { infer: true }),
      username: config.get('DB_USER', { infer: true }),
      password: config.get('DB_PASSWORD', { infer: true }),
      database: config.get('DB_NAME', { infer: true }),
    }),
    // Migrations are run explicitly (npm run migration:run), never on boot.
    migrationsRun: false,
    retryAttempts: 3,
  }),
});
