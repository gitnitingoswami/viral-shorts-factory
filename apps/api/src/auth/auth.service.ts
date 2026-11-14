import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import type { AuthTokenResponse } from '@vsf/contracts';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.schema';
import { RefreshSessionEntity, UserAccountEntity } from '../database/entities';
import { ARGON2_OPTIONS, toUserDto, UsersService } from '../users/users.service';
import { hashToken, isLocked, newRefreshToken, nextLockState } from './token.util';

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
}

export interface IssuedTokens {
  body: AuthTokenResponse;
  refreshToken: string;
}

export interface AccessTokenPayload {
  sub: string;
  role: 'owner' | 'reviewer';
  ws: string;
}

const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  private readonly accessTtl: number;
  private readonly refreshTtlDays: number;
  /** Verified against when the email is unknown, so response time doesn't reveal which emails exist. */
  private dummyHash: Promise<string>;

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @InjectRepository(UserAccountEntity) private readonly userRepo: Repository<UserAccountEntity>,
    @InjectRepository(RefreshSessionEntity) private readonly sessions: Repository<RefreshSessionEntity>,
    config: ConfigService<AppEnv, true>,
  ) {
    const c = config;
    this.accessTtl = c.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.refreshTtlDays = c.get('REFRESH_TTL_DAYS', { infer: true });
    this.dummyHash = argon2.hash(randomUUID(), ARGON2_OPTIONS);
  }

  async login(email: string, password: string, client: ClientInfo): Promise<IssuedTokens> {
    const now = new Date();
    const user = await this.users.findForLogin(email);
    const auditBase = { actorType: 'user' as const, correlationId: client.correlationId, ip: client.ip };

    if (!user) {
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      await this.audit.record({ ...auditBase, action: 'auth.login', outcome: 'failure', details: { reason: 'unknown_user' } });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (isLocked(user.lockedUntil, now)) {
      await this.audit.record({ ...auditBase, actorId: user.id, action: 'auth.login', subjectType: 'user', subjectId: user.id, outcome: 'failure', details: { reason: 'locked' } });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const lock = nextLockState(user.failedLoginCount, now);
      await this.userRepo.update(user.id, lock);
      await this.audit.record({
        ...auditBase,
        actorId: user.id,
        action: lock.lockedUntil ? 'auth.lockout' : 'auth.login',
        subjectType: 'user',
        subjectId: user.id,
        outcome: 'failure',
        details: { reason: 'bad_password' },
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.userRepo.update(user.id, { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now });
    const tokens = await this.issue(user, randomUUID(), client);
    await this.audit.record({ ...auditBase, actorId: user.id, action: 'auth.login', subjectType: 'user', subjectId: user.id, outcome: 'success' });
    return tokens;
  }

  /**
   * Rotates a refresh token. Each token is single-use: it is claimed atomically, and presenting an
   * already-used token (reuse) revokes the whole session family.
   */
  async refresh(rawToken: string | undefined, client: ClientInfo): Promise<IssuedTokens> {
    if (!rawToken) throw new UnauthorizedException('Missing refresh token');
    const tokenHash = hashToken(rawToken);
    const session = await this.sessions.findOne({ where: { tokenHash } });
    if (!session) throw new UnauthorizedException('Invalid refresh token');

    const claimed = await this.sessions
      .createQueryBuilder()
      .update()
      .set({ revokedAt: () => 'now()' })
      .where('id = :id AND revoked_at IS NULL AND expires_at > now()', { id: session.id })
      .execute();

    if (!claimed.affected) {
      if (session.revokedAt) {
        await this.revokeFamily(session.familyId);
        await this.audit.record({
          actorType: 'user',
          actorId: session.userId,
          action: 'auth.refresh_reuse_detected',
          subjectType: 'session_family',
          subjectId: session.familyId,
          outcome: 'failure',
          correlationId: client.correlationId,
          ip: client.ip,
        });
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.users.findById(session.userId);
    if (!user) throw new UnauthorizedException('Invalid refresh token');
    const tokens = await this.issue(user, session.familyId, client);
    await this.sessions.update(session.id, { replacedBy: tokens.sessionId });
    return tokens;
  }

  async logout(rawToken: string | undefined, client: ClientInfo): Promise<void> {
    if (!rawToken) return;
    const session = await this.sessions.findOne({ where: { tokenHash: hashToken(rawToken) } });
    if (!session) return;
    await this.revokeFamily(session.familyId);
    await this.audit.record({
      actorType: 'user',
      actorId: session.userId,
      action: 'auth.logout',
      subjectType: 'session_family',
      subjectId: session.familyId,
      outcome: 'success',
      correlationId: client.correlationId,
      ip: client.ip,
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, { algorithms: ['HS256'] });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.sessions.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  private async issue(
    user: UserAccountEntity,
    familyId: string,
    client: ClientInfo,
  ): Promise<IssuedTokens & { sessionId: string }> {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role, ws: user.workspaceId };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.accessTtl, algorithm: 'HS256' });
    const refreshToken = newRefreshToken();
    const session = await this.sessions.save(
      this.sessions.create({
        userId: user.id,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlDays * 86_400_000),
        userAgent: client.userAgent?.slice(0, 300) ?? null,
        ip: client.ip,
      }),
    );
    return {
      body: { accessToken, expiresIn: this.accessTtl, user: toUserDto(user) },
      refreshToken,
      sessionId: session.id,
    };
  }
}
