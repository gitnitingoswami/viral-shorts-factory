import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import type { Response } from 'express';
import type { EnqueuePingRequest, JobDto, Page } from '@vsf/contracts';
import { clamp } from '../audit/audit.controller';
import { AuthedRequest, AuthUser, correlationIdOf, CurrentUser, Roles } from '../common/auth-user';
import { JOB_TYPE_PING, QUEUE_MAINTENANCE } from '../common/constants';
import { JobsService } from './jobs.service';

export class EnqueuePingBody implements EnqueuePingRequest {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,120}$/, { message: 'idempotencyKey must be 8-120 chars of [A-Za-z0-9._:-]' })
  idempotencyKey: string;
}

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<Page<JobDto>> {
    return this.jobs.list(user.workspaceId, clamp(limit, 1, 200), Math.max(0, offset));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<JobDto> {
    return this.jobs.get(id, user.workspaceId);
  }

  /** Smoke-test job proving the API → queue → worker → DB path. 201 when created, 200 when the key already exists. */
  @Roles('owner')
  @Post('maintenance/ping')
  async ping(
    @CurrentUser() user: AuthUser,
    @Body() body: EnqueuePingBody,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<JobDto> {
    const { job, created } = await this.jobs.enqueue({
      type: JOB_TYPE_PING,
      queue: QUEUE_MAINTENANCE,
      idempotencyKey: `${JOB_TYPE_PING}:${user.workspaceId}:${body.idempotencyKey}`,
      createdBy: user.id,
      correlationId: correlationIdOf(req),
      workspaceId: user.workspaceId,
    });
    res.status(created ? 201 : 200);
    return job;
  }
}
