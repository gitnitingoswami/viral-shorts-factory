import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { LivenessResponse, ReadinessResponse } from '@vsf/contracts';
import { Public } from '../common/auth-user';
import { HealthService } from './health.service';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Process is alive (no dependency checks). */
  @Get('live')
  live(): LivenessResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** All dependencies reachable: 200 when ok, 503 (same body) when degraded. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const body = await this.health.readiness();
    res.status(body.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
