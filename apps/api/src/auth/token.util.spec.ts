import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from '../common/constants';
import { hashToken, isLocked, newRefreshToken, nextLockState, refreshCookieOptions } from './token.util';

describe('token utilities', () => {
  it('creates high-entropy unique refresh tokens', () => {
    const a = newRefreshToken();
    const b = newRefreshToken();
    expect(a).not.toEqual(b);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
  });

  it('hashes tokens deterministically to 64 hex chars', () => {
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc')).toEqual(hashToken('abc'));
    expect(hashToken('abc')).not.toEqual(hashToken('abd'));
  });

  it('builds a strict HttpOnly cookie scoped to the auth path', () => {
    const o = refreshCookieOptions(true, 7);
    expect(o).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', path: '/api/auth' });
    expect(o.maxAge).toBe(7 * 86_400_000);
  });
});

describe('lockout policy', () => {
  const now = new Date('2026-11-14T12:00:00Z');

  it('increments the failure count below the threshold', () => {
    expect(nextLockState(0, now)).toEqual({ failedLoginCount: 1, lockedUntil: null });
    expect(nextLockState(MAX_FAILED_LOGINS - 2, now).lockedUntil).toBeNull();
  });

  it('locks at the threshold and resets the counter', () => {
    const s = nextLockState(MAX_FAILED_LOGINS - 1, now);
    expect(s.failedLoginCount).toBe(0);
    expect(s.lockedUntil?.getTime()).toBe(now.getTime() + LOCKOUT_MINUTES * 60_000);
  });

  it('reports locked only while the lock is in the future', () => {
    expect(isLocked(null, now)).toBe(false);
    expect(isLocked(new Date(now.getTime() + 1000), now)).toBe(true);
    expect(isLocked(new Date(now.getTime() - 1000), now)).toBe(false);
  });
});
