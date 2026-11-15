import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard, RolesGuard } from './auth/guards';
import { ChannelsModule } from './channels/channels.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { AppLoggerModule } from './common/logging';
import { AppConfigModule, AppConfigService } from './config/config';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { InfraModule } from './infra/infra.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { JobsModule, QueueRootModule } from './jobs/jobs.module';
import { UsersModule } from './users/users.module';
import { BudgetModule } from './budget/budget.module';
import { ResearchModule } from './research/research.module';
import { ContentModule } from './content/content.module';

/** HTTP API process. */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    DatabaseModule,
    QueueRootModule,
    InfraModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) => {
        const enabled = config.get('THROTTLE_ENABLED', { infer: true });
        return { throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }], skipIf: () => !enabled };
      },
    }),
    AuditModule,
    UsersModule,
    AuthModule,
    ChannelsModule,
    IntegrationsModule,
    JobsModule,
    BudgetModule,
    ResearchModule,
    ContentModule,
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    // Guard order matters: rate limit → authenticate → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
