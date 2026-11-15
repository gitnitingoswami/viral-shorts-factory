import { Module } from '@nestjs/common';
import { BudgetCoreModule } from '../budget/budget.module';
import { JobsCoreModule } from '../jobs/jobs.module';
import { LlmService, llmProviderFactory } from '../llm/llm.service';
import { ContentController } from './content.controller';
import { ContentPipeline } from './content.pipeline';
import { ContentProcessor } from './content.processor';
import { ContentService } from './content.service';
import { SandboxService } from './sandbox.service';

/** Shared content services (API + worker). */
@Module({
  imports: [JobsCoreModule, BudgetCoreModule],
  providers: [llmProviderFactory, LlmService, SandboxService, ContentPipeline, ContentService],
  exports: [LlmService, ContentPipeline, ContentService],
})
export class ContentCoreModule {}

@Module({ imports: [ContentCoreModule], controllers: [ContentController] })
export class ContentModule {}

@Module({ imports: [ContentCoreModule, JobsCoreModule], providers: [ContentProcessor] })
export class ContentWorkerModule {}
