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
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type {
  CodeLanguage,
  CodeVerificationDto,
  ContentIdeaDto,
  CreateScriptVersionRequest,
  GenerateIdeasRequest,
  JobDto,
  LlmStatusDto,
  OverrideRequest,
  Page,
  ScriptClaimDto,
  ScriptDecisionRequest,
  ScriptDetailDto,
  ScriptDto,
  ScriptVersionDto,
  SelectIdeaResponse,
} from '@vsf/contracts';
import { randomUUID } from 'node:crypto';
import { clamp } from '../audit/audit.controller';
import { AuthedRequest, AuthUser, correlationIdOf, CurrentUser, Roles } from '../common/auth-user';
import { LlmService } from '../llm/llm.service';
import { CODE_LANGUAGES, TRANSITIONS } from './schemas';
import { Actor, ContentService } from './content.service';

class SceneCodeBody {
  @IsIn(CODE_LANGUAGES) language: CodeLanguage;
  @IsString() @MinLength(1) @MaxLength(1200) source: string;
  @IsArray() @ArrayMaxSize(12) @IsInt({ each: true }) @Min(1, { each: true }) @Max(12, { each: true }) highlightLines: number[];
}

class SceneBody {
  @IsInt() @Min(1) @Max(30) durationSec: number;
  @IsString() @MinLength(1) @MaxLength(400) narration: string;
  @IsString() @MaxLength(80) onScreenText: string;
  @IsString() @MinLength(1) @MaxLength(300) visualConcept: string;
  @IsOptional() @ValidateNested() @Type(() => SceneCodeBody) code: SceneCodeBody | null;
  @IsIn(TRANSITIONS) transition: 'cut' | 'fade' | 'slide' | 'zoom';
  @IsString() @MinLength(1) @MaxLength(300) assetBrief: string;
}

export class CreateVersionBody implements CreateScriptVersionRequest {
  @IsInt() @Min(1) baseVersion: number;
  @IsString() @MinLength(5) @MaxLength(100) title: string;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SceneBody) scenes: SceneBody[];
}

export class IdeasBody implements GenerateIdeasRequest {
  @IsString() @Matches(/^[A-Za-z0-9._:-]{8,120}$/) idempotencyKey: string;
}

export class OverrideBody implements OverrideRequest {
  @IsString() @MinLength(10) @MaxLength(1000) reason: string;
}

export class DecisionBody implements ScriptDecisionRequest {
  @IsInt() @Min(1) version: number;
  @IsIn(['approved', 'rejected', 'changes_requested']) decision: 'approved' | 'rejected' | 'changes_requested';
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

const actorOf = (user: AuthUser, req: AuthedRequest): Actor => ({ userId: user.id, workspaceId: user.workspaceId, correlationId: correlationIdOf(req) });

@ApiTags('content')
@ApiBearerAuth()
@Controller()
export class ContentController {
  constructor(
    private readonly content: ContentService,
    private readonly llm: LlmService,
  ) {}

  @Get('content/llm-status')
  llmStatus(): LlmStatusDto {
    return this.llm.status();
  }

  @Roles('owner')
  // Each request spends LLM tokens; the budget guard is the hard limit, this throttle stops runaway clients.
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Post('research/topics/:id/ideas')
  @HttpCode(HttpStatus.ACCEPTED)
  ideas(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: IdeasBody, @Req() req: AuthedRequest): Promise<JobDto> {
    return this.content.requestIdeas(id, body.idempotencyKey, actorOf(user, req));
  }

  @Get('content/ideas')
  listIdeas(
    @CurrentUser() user: AuthUser,
    @Query('topicId', new ParseUUIDPipe({ optional: true })) topicId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<Page<ContentIdeaDto>> {
    if (status !== undefined && !['proposed', 'selected', 'discarded'].includes(status)) throw new BadRequestException('invalid status');
    return this.content.listIdeas(user.workspaceId, { topicId, status, limit: clamp(limit, 1, 200), offset: Math.max(0, offset) });
  }

  @Roles('owner')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Post('content/ideas/:id/select')
  @HttpCode(HttpStatus.ACCEPTED)
  select(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest): Promise<SelectIdeaResponse> {
    return this.content.selectIdea(id, actorOf(user, req));
  }

  @Roles('owner')
  @Post('content/ideas/:id/discard')
  @HttpCode(HttpStatus.OK)
  discard(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest): Promise<ContentIdeaDto> {
    return this.content.discardIdea(id, actorOf(user, req));
  }

  @Get('content/scripts')
  scripts(
    @CurrentUser() user: AuthUser,
    @Query('status') status: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<Page<ScriptDto>> {
    if (status !== undefined && !['drafting', 'in_review', 'approved', 'rejected'].includes(status)) throw new BadRequestException('invalid status');
    return this.content.listScripts(user.workspaceId, { status, limit: clamp(limit, 1, 200), offset: Math.max(0, offset) });
  }

  @Get('content/scripts/:id')
  script(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ScriptDetailDto> {
    return this.content.getScript(user.workspaceId, id);
  }

  @Get('content/scripts/:id/versions/:version')
  version(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<ScriptVersionDto> {
    return this.content.getVersion(user.workspaceId, id, version);
  }

  @Roles('owner', 'reviewer')
  @Post('content/scripts/:id/versions')
  createVersion(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateVersionBody, @Req() req: AuthedRequest): Promise<ScriptVersionDto> {
    return this.content.createVersion(id, { ...body, scenes: body.scenes.map((s) => ({ ...s, code: s.code ?? null })) }, actorOf(user, req));
  }

  @Roles('owner')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @Post('content/scripts/:id/versions/:version/checks')
  @HttpCode(HttpStatus.ACCEPTED)
  rerun(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('version', ParseIntPipe) version: number, @Req() req: AuthedRequest): Promise<JobDto> {
    return this.content.rerunChecks(id, version, randomUUID(), actorOf(user, req));
  }

  @Roles('owner')
  @Post('content/claims/:id/override')
  @HttpCode(HttpStatus.OK)
  overrideClaim(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: OverrideBody, @Req() req: AuthedRequest): Promise<ScriptClaimDto> {
    return this.content.overrideClaim(id, body.reason, actorOf(user, req));
  }

  @Roles('owner')
  @Post('content/code-checks/:id/override')
  @HttpCode(HttpStatus.OK)
  overrideCode(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: OverrideBody, @Req() req: AuthedRequest): Promise<CodeVerificationDto> {
    return this.content.overrideCode(id, body.reason, actorOf(user, req));
  }

  @Roles('owner', 'reviewer')
  @Post('content/scripts/:id/decision')
  @HttpCode(HttpStatus.OK)
  decide(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionBody, @Req() req: AuthedRequest): Promise<ScriptDto> {
    return this.content.decide(id, body, actorOf(user, req));
  }
}
