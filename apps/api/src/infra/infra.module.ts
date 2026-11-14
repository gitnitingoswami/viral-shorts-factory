import { Global, Module } from '@nestjs/common';
import { RedisHealthService } from './redis-health.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [StorageService, RedisHealthService],
  exports: [StorageService, RedisHealthService],
})
export class InfraModule {}
