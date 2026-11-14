import { hashToken, isLocked, lockoutMinutes, newRefreshToken, refreshCookieOptions } from './token.util';

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

  it('doubles the lock duration per successive lockout, capped at 24 h', () => {
    expect([0, 1, 2, 3].map(lockoutMinutes)).toEqual([15, 30, 60, 120]);
    expect(lockoutMinutes(20)).toBe(24 * 60);
  });

  it('reports locked only while the lock is in the future', () => {
    expect(isLocked(null, now)).toBe(false);
    expect(isLocked(new Date(now.getTime() + 1000), now)).toBe(true);
    expect(isLocked(new Date(now.getTime() - 1000), now)).toBe(false);
  });
});
