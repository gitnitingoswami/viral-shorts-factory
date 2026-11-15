import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type {
  NicheDto,
  Page,
  ResearchSourceDto,
  StartResearchRunRequest,
  TopicDecisionRequest,
  TrendCollectionDto,
  TrendTopicDetailDto,
  TrendTopicDto,
  UpsertNicheRequest,
  WeeklyTrendReportDto,
} from '@vsf/contracts';
import { clamp } from '../audit/audit.controller';
import { AuthedRequest, AuthUser, correlationIdOf, CurrentUser, Roles } from '../common/auth-user';
import { ResearchService } from './research.service';

const KEYWORD = /^[a-z0-9.+#][a-z0-9.+# -]{0,39}$/i;

export class CreateNicheBody implements UpsertNicheRequest {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsString({ each: true }) @Matches(KEYWORD, { each: true, message: 'invalid keyword' })
  keywords: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Matches(KEYWORD, { each: true, message: 'invalid keyword' })
  excludeKeywords?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateNicheBody implements Partial<UpsertNicheRequest> {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsString({ each: true }) @Matches(KEYWORD, { each: true, message: 'invalid keyword' })
  keywords?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Matches(KEYWORD, { each: true, message: 'invalid keyword' })
  excludeKeywords?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

export class StartRunBody implements StartResearchRunRequest {
  @IsUUID() nicheId: string;
  @IsString() @Matches(/^[A-Za-z0-9._:-]{8,120}$/) idempotencyKey: string;
}

export class DecisionBody implements TopicDecisionRequest {
  @IsIn(['approved', 'rejected']) decision: 'approved' | 'rejected';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@ApiTags('research')
@ApiBearerAuth()
@Controller()
export class ResearchController {
  constructor(private readonly research: ResearchService) {}

  @Get('research/sources')
  sources(): Promise<ResearchSourceDto[]> {
    return this.research.listSources();
  }

  @Get('niches')
  niches(@CurrentUser() user: AuthUser): Promise<NicheDto[]> {
    return this.research.listNiches(user.workspaceId);
  }

  @Roles('owner')
  @Post('niches')
  createNiche(@CurrentUser() user: AuthUser, @Body() body: CreateNicheBody, @Req() req: AuthedRequest): Promise<NicheDto> {
    return this.research.createNiche(user.workspaceId, body, { userId: user.id, correlationId: correlationIdOf(req) });
  }

  @Roles('owner')
  @Patch('niches/:id')
  updateNiche(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateNicheBody,
    @Req() req: AuthedRequest,
  ): Promise<NicheDto> {
    return this.research.updateNiche(user.workspaceId, id, body, { userId: user.id, correlationId: correlationIdOf(req) });
  }

  @Roles('owner')
  // Each run can spend YouTube quota; the daily cap is the hard limit, this throttle stops runaway clients.
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post('research/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  startRun(@CurrentUser() user: AuthUser, @Body() body: StartRunBody, @Req() req: AuthedRequest): Promise<TrendCollectionDto> {
    return this.research.startRun({
      workspaceId: user.workspaceId,
      nicheId: body.nicheId,
      trigger: 'manual',
      runKey: `manual:${user.workspaceId}:${body.idempotencyKey}`,
      createdBy: user.id,
      correlationId: correlationIdOf(req),
    });
  }

  @Get('research/collections')
  collections(
    @CurrentUser() user: AuthUser,
    @Query('nicheId', new ParseUUIDPipe({ optional: true })) nicheId: string | undefined,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<Page<TrendCollectionDto>> {
    return this.research.listCollections(user.workspaceId, nicheId, clamp(limit, 1, 100), Math.max(0, offset));
  }

  @Get('research/collections/:id')
  collection(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TrendCollectionDto> {
    return this.research.getCollection(user.workspaceId, id);
  }

  @Get('research/collections/:id/report')
  report(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<WeeklyTrendReportDto> {
    return this.research.getReport(user.workspaceId, id);
  }

  @Get('research/collections/:id/topics')
  topics(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status') status: string | undefined,
    @Query('minScore') minScore: string | undefined,
    @Query('q') q: string | undefined,
    @Query('sort') sort: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<Page<TrendTopicDto>> {
    if (status !== undefined && !['new', 'approved', 'rejected'].includes(status)) throw new BadRequestException('invalid status');
    if (sort !== undefined && !['score', 'freshness', 'confidence'].includes(sort)) throw new BadRequestException('invalid sort');
    const min = minScore === undefined || minScore === '' ? undefined : Number(minScore);
    if (min !== undefined && (!Number.isFinite(min) || min < 0 || min > 1)) throw new BadRequestException('minScore must be 0..1');
    if (q !== undefined && q.length > 100) throw new BadRequestException('q too long');
    return this.research.listTopics(user.workspaceId, id, {
      status: status as 'new' | 'approved' | 'rejected' | undefined,
      minScore: min,
      q: q || undefined,
      sort: sort as 'score' | 'freshness' | 'confidence' | undefined,
      limit: clamp(limit, 1, 200),
      offset: Math.max(0, offset),
    });
  }

  // Declared before research/topics/:id so "compare" is not parsed as an id.
  @Get('research/topics/compare')
  compare(@CurrentUser() user: AuthUser, @Query('ids') ids: string | undefined): Promise<TrendTopicDetailDto[]> {
    const list = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (list.some((i) => !UUID.test(i))) throw new BadRequestException('ids must be UUIDs');
    return this.research.compare(user.workspaceId, list);
  }

  @Get('research/topics/:id')
  topic(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TrendTopicDetailDto> {
    return this.research.getTopic(user.workspaceId, id);
  }

  @Roles('owner', 'reviewer')
  @Post('research/topics/:id/decision')
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DecisionBody,
    @Req() req: AuthedRequest,
  ): Promise<TrendTopicDto> {
    return this.research.decide(user.workspaceId, id, user.id, body, correlationIdOf(req));
  }
}
