import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BudgetCoreModule } from '../budget/budget.module';
import { NicheEntity, TrendCollectionEntity, TrendTopicEntity } from '../database/research.entities';
import { JobsCoreModule } from '../jobs/jobs.module';
import { researchAdaptersProvider, researchHttpProvider } from './adapters.provider';
import { ResearchController } from './research.controller';
import { ResearchPipeline } from './research.pipeline';
import { ResearchProcessor, ResearchScheduler } from './research.processor';
import { ResearchService } from './research.service';

/** Shared research services (API + worker). */
@Module({
  imports: [TypeOrmModule.forFeature([NicheEntity, TrendCollectionEntity, TrendTopicEntity]), JobsCoreModule, BudgetCoreModule],
  providers: [researchHttpProvider, researchAdaptersProvider, ResearchService, ResearchPipeline],
  exports: [ResearchService, ResearchPipeline],
})
export class ResearchCoreModule {}

/** HTTP API side. */
@Module({ imports: [ResearchCoreModule], controllers: [ResearchController] })
export class ResearchModule {}

/** Worker side: queue processor and repeatable schedules. */
@Module({ imports: [ResearchCoreModule, JobsCoreModule], providers: [ResearchProcessor, ResearchScheduler] })
export class ResearchWorkerModule {}
