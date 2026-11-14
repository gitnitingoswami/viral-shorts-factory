import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AppLoggerModule } from './common/logging';
import { AppConfigModule } from './config/config';
import { DatabaseModule } from './database/database.module';
import { JobsCoreModule, QueueRootModule } from './jobs/jobs.module';
import { MaintenanceProcessor } from './jobs/maintenance.processor';

/** Background worker process: queue processors only, no HTTP server. */
@Module({
  imports: [AppConfigModule, AppLoggerModule, DatabaseModule, QueueRootModule, AuditModule, JobsCoreModule],
  providers: [MaintenanceProcessor],
})
export class WorkerModule {}
