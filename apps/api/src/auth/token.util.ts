import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions } from 'express';
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS, REFRESH_COOKIE_PATH } from '../common/constants';

/** 256-bit opaque refresh token (only its SHA-256 hash is stored). */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function refreshCookieOptions(secure: boolean, ttlDays: number): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: ttlDays * 24 * 60 * 60 * 1000,
  };
}

/** Lockout policy: after MAX_FAILED_LOGINS consecutive failures, lock for LOCKOUT_MINUTES. */
export function nextLockState(
  failedCount: number,
  now: Date,
): { failedLoginCount: number; lockedUntil: Date | null } {
  const next = failedCount + 1;
  if (next >= MAX_FAILED_LOGINS) {
    return { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) };
  }
  return { failedLoginCount: next, lockedUntil: null };
}

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}
