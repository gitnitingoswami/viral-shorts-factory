import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import type { AuthTokenResponse } from '@vsf/contracts';
import { AuditService } from '../audit/audit.service';
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS, MAX_LOCKOUT_MINUTES } from '../common/constants';
import type { AppEnv } from '../config/env.schema';
import { RefreshSessionEntity, UserAccountEntity } from '../database/entities';
import { ARGON2_OPTIONS, toUserDto, UsersService } from '../users/users.service';
import { hashToken, isLocked, newRefreshToken } from './token.util';

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
const INVALID_REFRESH = 'Invalid refresh token';

type RefreshOutcome =
  | { kind: 'ok'; tokens: IssuedTokens }
  | { kind: 'reuse'; userId: string; familyId: string }
  | { kind: 'invalid' };

@Injectable()
export class AuthService {
  private readonly accessTtl: number;
  private readonly refreshTtlDays: number;
  /** Verified against when the email is unknown or locked, so response time reveals nothing about accounts. */
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
    @InjectRepository(UserAccountEntity) private readonly userRepo: Repository<UserAccountEntity>,
    @InjectRepository(RefreshSessionEntity) private readonly sessions: Repository<RefreshSessionEntity>,
    config: ConfigService<AppEnv, true>,
  ) {
    this.accessTtl = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.refreshTtlDays = config.get('REFRESH_TTL_DAYS', { infer: true });
    this.dummyHash = argon2.hash(randomUUID(), ARGON2_OPTIONS);
  }

  async login(email: string, password: string, client: ClientInfo): Promise<IssuedTokens> {
    const user = await this.users.findForLogin(email);
    const auditBase = { actorType: 'user' as const, correlationId: client.correlationId, ip: client.ip };

    if (!user) {
      await this.burnTime(password);
      await this.audit.record({ ...auditBase, action: 'auth.login', outcome: 'failure', details: { reason: 'unknown_user' } });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    const userAudit = { ...auditBase, actorId: user.id, subjectType: 'user', subjectId: user.id };

    if (isLocked(user.lockedUntil, new Date())) {
      await this.burnTime(password);
      await this.audit.record({ ...userAudit, action: 'auth.login', outcome: 'failure', details: { reason: 'locked' } });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const lockedNow = await this.recordFailedAttempt(user.id);
      await this.audit.record({
        ...userAudit,
        action: lockedNow ? 'auth.lockout' : 'auth.login',
        outcome: 'failure',
        details: { reason: 'bad_password' },
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.userRepo.update(user.id, { failedLoginCount: 0, lockoutCount: 0, lockedUntil: null, lastLoginAt: new Date() });
    const tokens = await this.issue(this.dataSource.manager, user, randomUUID(), client);
    await this.audit.record({ ...userAudit, action: 'auth.login', outcome: 'success' });
    return tokens;
  }

  /**
   * Atomically counts a failed attempt. After MAX_FAILED_LOGINS consecutive failures the account is
   * locked; each successive lockout doubles in length (backoff), capped at MAX_LOCKOUT_MINUTES.
   * Concurrent failures are all counted because the increment happens in a single UPDATE.
   * Returns true when this attempt triggered a lock.
   */
  private async recordFailedAttempt(userId: string): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE user_account SET
         failed_login_count = CASE WHEN failed_login_count + 1 >= $1 THEN 0 ELSE failed_login_count + 1 END,
         lockout_count      = CASE WHEN failed_login_count + 1 >= $1 THEN lockout_count + 1 ELSE lockout_count END,
         locked_until       = CASE WHEN failed_login_count + 1 >= $1
                                THEN now() + make_interval(mins => LEAST($2 * power(2, lockout_count), $3)::int)
                                ELSE locked_until END,
         updated_at = now()
       WHERE id = $4
       RETURNING (failed_login_count = 0) AS locked`,
      [MAX_FAILED_LOGINS, LOCKOUT_MINUTES, MAX_LOCKOUT_MINUTES, userId],
    );
    // TypeORM's postgres driver returns [rows, affectedCount] for UPDATE ... RETURNING.
    const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as Array<{ locked: boolean }>;
    return rows[0]?.locked ?? false;
  }

  /**
   * Rotates a refresh token. All rows of the token's session family are locked for the duration of the
   * transaction, so concurrent presentations of the same token are serialized: exactly one wins, and any
   * later presentation of a used token (reuse) revokes the whole family, including the winner's new token.
   */
  async refresh(rawToken: string | undefined, client: ClientInfo): Promise<IssuedTokens> {
    if (!rawToken) throw new UnauthorizedException('Missing refresh token');
    const tokenHash = hashToken(rawToken);

    const outcome = await this.dataSource.transaction(async (m): Promise<RefreshOutcome> => {
      const found = await m.findOne(RefreshSessionEntity, { where: { tokenHash } });
      if (!found) return { kind: 'invalid' };

      await m.query('SELECT id FROM refresh_session WHERE family_id = $1 ORDER BY id FOR UPDATE', [found.familyId]);
      const session = await m.findOneOrFail(RefreshSessionEntity, { where: { id: found.id } });

      if (session.revokedAt) {
        await m.update(RefreshSessionEntity, { familyId: session.familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
        return { kind: 'reuse', userId: session.userId, familyId: session.familyId };
      }
      if (session.expiresAt.getTime() <= Date.now()) return { kind: 'invalid' };

      const user = await m.findOne(UserAccountEntity, { where: { id: session.userId } });
      if (!user) return { kind: 'invalid' };

      const tokens = await this.issue(m, user, session.familyId, client);
      await m.update(RefreshSessionEntity, { id: session.id }, { revokedAt: new Date(), replacedBy: tokens.sessionId });
      return { kind: 'ok', tokens };
    });

    if (outcome.kind === 'ok') return outcome.tokens;
    if (outcome.kind === 'reuse') {
      await this.audit.record({
        actorType: 'user',
        actorId: outcome.userId,
        action: 'auth.refresh_reuse_detected',
        subjectType: 'session_family',
        subjectId: outcome.familyId,
        outcome: 'failure',
        correlationId: client.correlationId,
        ip: client.ip,
      });
    }
    throw new UnauthorizedException(INVALID_REFRESH);
  }

  async logout(rawToken: string | undefined, client: ClientInfo): Promise<void> {
    if (!rawToken) return;
    const session = await this.sessions.findOne({ where: { tokenHash: hashToken(rawToken) } });
    if (!session || session.revokedAt) return;
    await this.sessions.update({ familyId: session.familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
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

  private async burnTime(password: string): Promise<void> {
    await argon2.verify(await this.dummyHash, password).catch(() => false);
  }

  private async issue(
    m: EntityManager,
    user: UserAccountEntity,
    familyId: string,
    client: ClientInfo,
  ): Promise<IssuedTokens & { sessionId: string }> {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role, ws: user.workspaceId };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.accessTtl, algorithm: 'HS256' });
    const refreshToken = newRefreshToken();
    const session = await m.save(
      m.create(RefreshSessionEntity, {
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
