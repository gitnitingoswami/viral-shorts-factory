import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUE_MAINTENANCE } from '../common/constants';
import { AppConfigService } from '../config/config';
import { JobEntity } from '../database/entities';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

/** Shared BullMQ connection (API and worker). */
export const QueueRootModule = BullModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: AppConfigService) => {
    const host: string = config.get('REDIS_HOST', { infer: true });
    const port: number = config.get('REDIS_PORT', { infer: true });
    return {
      connection: { host, port, maxRetriesPerRequest: null },
      prefix: config.get('QUEUE_PREFIX', { infer: true }),
    };
  },
});

@Module({
  imports: [TypeOrmModule.forFeature([JobEntity]), BullModule.registerQueue({ name: QUEUE_MAINTENANCE })],
  providers: [JobsService],
  exports: [JobsService, TypeOrmModule],
})
export class JobsCoreModule {}

@Module({
  imports: [JobsCoreModule],
  controllers: [JobsController],
})
export class JobsModule {}
