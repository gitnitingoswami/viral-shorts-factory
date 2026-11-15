import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { S3ServiceException } from '@aws-sdk/client-s3';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import type {
  CreateProductionRequest,
  CreateProductionResponse,
  MediaAssetDto,
  Page,
  RenderCapabilityDto,
  RenderSettings,
  SignedMediaUrlDto,
  VideoProductionDetailDto,
  VideoProductionDto,
  VoiceProfileDto,
} from '@vsf/contracts';
import { clamp } from '../audit/audit.controller';
import { AuthedRequest, AuthUser, correlationIdOf, CurrentUser, Public, Roles } from '../common/auth-user';
import { ALLOWED_FPS } from './settings';
import { Actor, MEDIA_KINDS, PRODUCTION_STATUSES, VideoService } from './video.service';

class SettingsBody implements Partial<RenderSettings> {
  @IsOptional() @IsInt() width?: number;
  @IsOptional() @IsInt() height?: number;
  @IsOptional() @IsIn(ALLOWED_FPS) fps?: RenderSettings['fps'];
  @IsOptional() @IsIn(['h264']) codec?: 'h264';
  @IsOptional() @IsInt() @Min(500) @Max(20_000) videoBitrateKbps?: number;
  @IsOptional() @IsInt() @Min(64) @Max(320) audioBitrateKbps?: number;
  @IsOptional() @IsInt() @Min(1) @Max(179) minDurationSec?: number;
  @IsOptional() @IsInt() @Min(2) @Max(180) maxDurationSec?: number;
  @IsOptional() @IsBoolean() burnCaptions?: boolean;
}

export class CreateProductionBody implements CreateProductionRequest {
  @IsUUID() scriptId: string;
  @IsOptional() @IsUUID() voiceProfileId?: string;
  @IsOptional() @ValidateNested() @Type(() => SettingsBody) settings?: SettingsBody;
}

const actorOf = (user: AuthUser, req: AuthedRequest): Actor => ({ userId: user.id, workspaceId: user.workspaceId, correlationId: correlationIdOf(req) });

/** Strips undefined keys so class-transformer's empty optionals don't count as overrides. */
function defined<T extends object>(o: T | undefined): Partial<T> | undefined {
  if (!o) return undefined;
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

@ApiTags('video')
@ApiBearerAuth()
@Controller('video')
export class VideoController {
  constructor(private readonly video: VideoService) {}

  @Get('status')
  status(): Promise<RenderCapabilityDto> {
    return this.video.capability();
  }

  @Get('voices')
  voices(@CurrentUser() user: AuthUser): Promise<VoiceProfileDto[]> {
    return this.video.voices(user.workspaceId);
  }

  @Roles('owner')
  // Rendering is CPU-heavy; this stops runaway clients (identical requests are deduplicated anyway).
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @Post('productions')
  @HttpCode(HttpStatus.ACCEPTED)
  create(@CurrentUser() user: AuthUser, @Body() body: CreateProductionBody, @Req() req: AuthedRequest): Promise<CreateProductionResponse> {
    return this.video.create({ scriptId: body.scriptId, voiceProfileId: body.voiceProfileId, settings: defined(body.settings) }, actorOf(user, req));
  }

  @Get('productions')
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<Page<VideoProductionDto>> {
    if (status !== undefined && !(PRODUCTION_STATUSES as string[]).includes(status)) throw new BadRequestException('invalid status');
    return this.video.list(user.workspaceId, { status, limit: clamp(limit, 1, 200), offset: Math.max(0, offset) });
  }

  @Get('productions/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<VideoProductionDetailDto> {
    return this.video.detail(user.workspaceId, id);
  }

  @Roles('owner')
  @Post('productions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest): Promise<VideoProductionDto> {
    return this.video.cancel(user.workspaceId, id, actorOf(user, req));
  }

  @Roles('owner')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @Post('productions/:id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest): Promise<CreateProductionResponse> {
    return this.video.retry(user.workspaceId, id, actorOf(user, req));
  }

  @Get('assets')
  assets(
    @CurrentUser() user: AuthUser,
    @Query('kind') kind: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<Page<MediaAssetDto>> {
    if (kind !== undefined && !(MEDIA_KINDS as string[]).includes(kind)) throw new BadRequestException('invalid kind');
    return this.video.listAssets(user.workspaceId, { kind, limit: clamp(limit, 1, 200), offset: Math.max(0, offset) });
  }

  @Get('assets/:id/url')
  url(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<SignedMediaUrlDto> {
    return this.video.signedUrl(user.workspaceId, id);
  }

  /**
   * Signed, expiring media download with HTTP Range support (video seeking). Public route: the HMAC signature in
   * the query authorizes it, because <video>/<img>/<track> elements cannot send an Authorization header.
   */
  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Get('media/:id')
  async media(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('exp', ParseIntPipe) exp: number,
    @Query('sig') sig: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!sig || sig.length > 128) throw new BadRequestException('sig is required');
    let media;
    try {
      media = await this.video.openMedia(id, exp, sig, range);
    } catch (err) {
      if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 416) throw new HttpException('Range not satisfiable', HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      throw err;
    }
    res.status(media.partial ? 206 : 200);
    res.setHeader('Content-Type', media.asset.mime);
    res.setHeader('Content-Length', String(media.contentLength));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', 'inline');
    if (media.partial && media.contentRange) res.setHeader('Content-Range', media.contentRange);
    // pipeline() destroys the storage stream when the client aborts (seeking players abort often), so S3 sockets
    // are released instead of leaking from the shared pool.
    await pipeline(media.body, res).catch(() => media.body.destroy());
  }
}
