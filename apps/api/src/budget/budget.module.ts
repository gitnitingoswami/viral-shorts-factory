import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { BudgetSummaryDto } from '@vsf/contracts';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { BudgetEntity, ExpenseRecordEntity } from '../database/research.entities';
import { BudgetService } from './budget.service';

@ApiTags('budget')
@ApiBearerAuth()
@Controller('budget')
export class BudgetController {
  constructor(private readonly budget: BudgetService) {}

  @Roles('owner')
  @Get('summary')
  summary(@CurrentUser() user: AuthUser): Promise<BudgetSummaryDto> {
    return this.budget.summary(user.workspaceId);
  }
}

/** Ledger + guard, shared by the API (summary endpoint) and the worker (guard before billable work). */
@Module({
  imports: [TypeOrmModule.forFeature([BudgetEntity, ExpenseRecordEntity])],
  providers: [BudgetService],
  exports: [BudgetService],
})
export class BudgetCoreModule {}

@Module({ imports: [BudgetCoreModule], controllers: [BudgetController] })
export class BudgetModule {}
