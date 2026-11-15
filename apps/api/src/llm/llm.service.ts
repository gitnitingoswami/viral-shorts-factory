import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmStatusDto } from '@vsf/contracts';
import { BudgetExceededError, BudgetService } from '../budget/budget.service';
import type { AppEnv } from '../config/env.schema';
import { ClaudeProvider } from './claude.provider';
import { LlmNonRetryableError, LlmProvider, LlmRequest, LlmResponse, LlmUsage, userMessage } from './llm.types';
import { MockLlmProvider } from './mock.provider';
import { costMinor, estimateMinor, PRICING_VERSION } from './pricing';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export const llmProviderFactory = {
  provide: LLM_PROVIDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppEnv, true>): LlmProvider => {
    const key = config.get('ANTHROPIC_API_KEY', { infer: true });
    if (!key || config.get('LLM_FORCE_MOCK', { infer: true })) return new MockLlmProvider();
    return new ClaudeProvider(key, config.get('LLM_MODEL', { infer: true }));
  },
};

export interface MeteringContext {
  workspaceId: string;
  relatedType: string;
  relatedId: string;
  jobId?: string | null;
}

/**
 * Single entry point for LLM calls: budget guard before the call (upper-bound estimate), cost metering into the
 * expense ledger after it (including failed calls that consumed tokens), never logging prompt contents.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    private readonly budget: BudgetService,
  ) {}

  status(): LlmStatusDto {
    return { provider: this.provider.name, model: this.provider.model, configured: this.provider.name === 'claude' };
  }

  async generate<T>(req: LlmRequest<T>, ctx: MeteringContext): Promise<LlmResponse<T>> {
    const estimate = this.provider.name === 'mock' ? 0 : estimateMinor(this.provider.model, req.system.length + userMessage(req.input).length, req.maxTokens);
    try {
      await this.budget.assertCanSpend(ctx.workspaceId, estimate);
    } catch (err) {
      if (err instanceof BudgetExceededError) throw new LlmNonRetryableError('Monthly budget exhausted; AI generation paused', 'budget');
      throw err;
    }
    const started = Date.now();
    try {
      const res = await this.provider.generate(req);
      await this.meter(res.model, res.usage, req, ctx);
      this.logger.log({ task: req.task, promptRef: req.promptRef, model: res.model, mock: res.mock, ms: Date.now() - started, ...res.usage }, 'LLM call');
      return res;
    } catch (err) {
      // Refusals, truncation and schema violations still consumed tokens: record them.
      const e = err as { usage?: LlmUsage; model?: string };
      if (e.usage) await this.meter(e.model ?? this.provider.model, e.usage, req, ctx);
      throw err;
    }
  }

  private async meter(model: string, usage: LlmUsage, req: LlmRequest<unknown>, ctx: MeteringContext): Promise<void> {
    if (this.provider.name === 'mock') return;
    const tokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    await this.budget.record({
      workspaceId: ctx.workspaceId,
      provider: 'anthropic',
      category: 'llm',
      units: tokens,
      unit: `tokens:${model}:${req.promptRef}:pricing@${PRICING_VERSION}`,
      amountMinor: costMinor(model, usage),
      relatedType: ctx.relatedType,
      relatedId: ctx.relatedId,
      jobId: ctx.jobId ?? null,
    });
  }
}
