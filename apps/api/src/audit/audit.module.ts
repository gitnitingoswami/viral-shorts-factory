import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditEventEntity } from '../database/entities';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditEventEntity])],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
