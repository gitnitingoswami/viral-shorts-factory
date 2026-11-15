import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { BudgetSummaryDto } from '@vsf/contracts';
import { DEFAULT_WORKSPACE_ID } from '../common/constants';
import type { AppEnv } from '../config/env.schema';
import { BudgetEntity, ExpenseRecordEntity } from '../database/research.entities';

export class BudgetExceededError extends Error {
  constructor(
    readonly spentMinor: number,
    readonly limitMinor: number,
    readonly estimateMinor: number,
  ) {
    super(`Monthly budget exceeded: spent ${spentMinor} + estimate ${estimateMinor} > limit ${limitMinor} (minor units)`);
    this.name = 'BudgetExceededError';
  }
}

export type ExpenseInput = Pick<ExpenseRecordEntity, 'provider' | 'category' | 'units' | 'unit' | 'amountMinor'> &
  Partial<Pick<ExpenseRecordEntity, 'relatedType' | 'relatedId' | 'jobId' | 'workspaceId'>>;

/** Start of the current calendar month (UTC) and its YYYY-MM label. */
export function monthWindow(now: Date): { start: Date; label: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, label: start.toISOString().slice(0, 7) };
}

export function budgetStatus(spent: number, limit: number, warnPct: number): BudgetSummaryDto['status'] {
  if (spent >= limit) return 'exceeded';
  if (limit > 0 && spent >= (limit * warnPct) / 100) return 'warning';
  return 'ok';
}

/**
 * Cost ledger + monthly budget guard (PRD FR-9). Every billable provider call is recorded; before billable
 * work starts, callers must check the estimate with assertCanSpend(). Zero-cost calls (e.g. API quota) are
 * recorded with amount 0 so usage stays visible.
 */
@Injectable()
export class BudgetService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BudgetService.name);
  private readonly defaultLimitMinor: number;

  constructor(
    @InjectRepository(BudgetEntity) private readonly budgets: Repository<BudgetEntity>,
    @InjectRepository(ExpenseRecordEntity) private readonly expenses: Repository<ExpenseRecordEntity>,
    private readonly dataSource: DataSource,
    config: ConfigService<AppEnv, true>,
  ) {
    this.defaultLimitMinor = Math.round(config.get('MONTHLY_BUDGET_USD', { infer: true }) * 100);
  }

  /** Creates the global monthly budget from MONTHLY_BUDGET_USD if none exists (never overwrites an existing one). */
  async onApplicationBootstrap(): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO budget (workspace_id, scope, scope_key, period, limit_minor)
       SELECT $1, 'global', NULL, 'month', $2
       WHERE NOT EXISTS (SELECT 1 FROM budget WHERE workspace_id = $1 AND scope = 'global' AND period = 'month')
       ON CONFLICT DO NOTHING`,
      [DEFAULT_WORKSPACE_ID, this.defaultLimitMinor],
    );
  }

  async summary(workspaceId: string, now = new Date()): Promise<BudgetSummaryDto> {
    const { start, label } = monthWindow(now);
    const budget = await this.budgets.findOne({ where: { workspaceId, scope: 'global', period: 'month' } });
    const limit = budget?.limitMinor ?? this.defaultLimitMinor;
    const warnPct = budget?.warnPct ?? 80;
    const spent = await this.spentSince(workspaceId, start);
    return { period: label, currency: 'USD', limitMinor: limit, spentMinor: spent, warnPct, status: budgetStatus(spent, limit, warnPct) };
  }

  /** Throws BudgetExceededError when the estimate would push month-to-date spend over the global limit. */
  async assertCanSpend(workspaceId: string, estimateMinor: number, now = new Date()): Promise<void> {
    const s = await this.summary(workspaceId, now);
    // Blocked when the estimate would exceed the limit, or when the budget is already used up.
    if (s.spentMinor + estimateMinor > s.limitMinor || s.spentMinor >= s.limitMinor) {
      this.logger.warn({ workspaceId, ...s, estimateMinor }, 'Budget guard blocked billable work');
      throw new BudgetExceededError(s.spentMinor, s.limitMinor, estimateMinor);
    }
  }

  async record(e: ExpenseInput): Promise<void> {
    await this.expenses.insert({ ...e, workspaceId: e.workspaceId ?? DEFAULT_WORKSPACE_ID, currency: 'USD' });
  }

  private async spentSince(workspaceId: string, start: Date): Promise<number> {
    const rows = await this.dataSource.query<Array<{ total: string | null }>>(
      `SELECT COALESCE(SUM(amount_minor), 0)::text AS total FROM expense_record WHERE workspace_id = $1 AND occurred_at >= $2`,
      [workspaceId, start],
    );
    return Number(rows[0]?.total ?? 0);
  }
}
