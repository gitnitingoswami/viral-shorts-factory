import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions } from 'express';
import { LOCKOUT_MINUTES, MAX_LOCKOUT_MINUTES, REFRESH_COOKIE_PATH } from '../common/constants';

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

/**
 * Lock duration for the n-th lockout (0-based): 15, 30, 60, ... minutes, capped at 24 h.
 * Mirrors the SQL in AuthService.recordFailedAttempt (documentation + unit-tested reference).
 */
export function lockoutMinutes(previousLockouts: number): number {
  return Math.min(LOCKOUT_MINUTES * 2 ** previousLockouts, MAX_LOCKOUT_MINUTES);
}

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}
