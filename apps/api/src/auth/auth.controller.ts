import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import type { AuthTokenResponse, LoginRequest, UserDto } from '@vsf/contracts';
import { AuthedRequest, AuthUser, correlationIdOf, CurrentUser, Public } from '../common/auth-user';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../common/constants';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.schema';
import { toUserDto, UsersService } from '../users/users.service';
import { AuthService, ClientInfo } from './auth.service';
import { CsrfHeaderGuard } from './guards';
import { refreshCookieOptions } from './token.util';

export class LoginBody implements LoginRequest {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(1) @MaxLength(128) password: string;
}

function clientInfo(req: AuthedRequest): ClientInfo {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null, correlationId: correlationIdOf(req) };
}

function refreshCookie(req: AuthedRequest): string | undefined {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[REFRESH_COOKIE_NAME];
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly cookieSecure: boolean;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    config: ConfigService<AppEnv, true>,
  ) {
    const c = config;
    this.cookieSecure = c.get('COOKIE_SECURE', { infer: true });
    this.refreshTtlDays = c.get('REFRESH_TTL_DAYS', { infer: true });
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginBody,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    const { body: tokens, refreshToken } = await this.auth.login(body.email, body.password, clientInfo(req));
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(this.cookieSecure, this.refreshTtlDays));
    return tokens;
  }

  @Public()
  @UseGuards(CsrfHeaderGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<AuthTokenResponse> {
    try {
      const { body, refreshToken } = await this.auth.refresh(refreshCookie(req), clientInfo(req));
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(this.cookieSecure, this.refreshTtlDays));
      return body;
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      throw err;
    }
  }

  @Public()
  @UseGuards(CsrfHeaderGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(refreshCookie(req), clientInfo(req));
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }

  @ApiBearerAuth()
  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<UserDto> {
    const entity = await this.users.findById(user.id);
    if (!entity) throw new UnauthorizedException();
    return toUserDto(entity);
  }
}
