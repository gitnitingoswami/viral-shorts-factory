import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuditEventDto, Page } from '@vsf/contracts';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Roles('owner')
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<Page<AuditEventDto>> {
    return this.audit.list(user.workspaceId, clamp(limit, 1, 200), Math.max(0, offset));
  }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
