import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../common/auth-user';
import { AuthService } from './auth.service';
import { CsrfHeaderGuard, JwtAuthGuard, RolesGuard } from './guards';

function ctxFor(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function reflectorWith(meta: Record<string, unknown>): Reflector {
  return { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
}

describe('JwtAuthGuard', () => {
  const auth = {
    verifyAccessToken: jest.fn((t: string) =>
      t === 'good' ? Promise.resolve({ sub: 'u1', role: 'owner', ws: 'w1' }) : Promise.reject(new Error('bad')),
    ),
  } as unknown as AuthService;

  it('allows @Public routes without a token', async () => {
    await expect(new JwtAuthGuard(reflectorWith({ [IS_PUBLIC_KEY]: true }), auth).canActivate(ctxFor({ headers: {} }))).resolves.toBe(true);
  });

  it('rejects a missing bearer token', async () => {
    await expect(new JwtAuthGuard(reflectorWith({}), auth).canActivate(ctxFor({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid token', async () => {
    const req = { headers: { authorization: 'Bearer nope' } };
    await expect(new JwtAuthGuard(reflectorWith({}), auth).canActivate(ctxFor(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the principal for a valid token', async () => {
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer good' } };
    await expect(new JwtAuthGuard(reflectorWith({}), auth).canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.user).toEqual({ id: 'u1', role: 'owner', workspaceId: 'w1' });
  });
});

describe('RolesGuard', () => {
  it('allows any authenticated user when no roles are required', () => {
    expect(new RolesGuard(reflectorWith({})).canActivate(ctxFor({ user: { role: 'reviewer' } }))).toBe(true);
  });

  it('allows a matching role', () => {
    expect(new RolesGuard(reflectorWith({ [ROLES_KEY]: ['owner'] })).canActivate(ctxFor({ user: { role: 'owner' } }))).toBe(true);
  });

  it('forbids a non-matching role', () => {
    expect(() => new RolesGuard(reflectorWith({ [ROLES_KEY]: ['owner'] })).canActivate(ctxFor({ user: { role: 'reviewer' } }))).toThrow(ForbiddenException);
  });

  it('forbids when no user is present', () => {
    expect(() => new RolesGuard(reflectorWith({ [ROLES_KEY]: ['owner'] })).canActivate(ctxFor({}))).toThrow(ForbiddenException);
  });
});

describe('CsrfHeaderGuard', () => {
  const guard = new CsrfHeaderGuard();
  const req = (value?: string) => ({ get: (h: string) => (h === 'X-Requested-With' ? value : undefined) });

  it('requires the exact header value', () => {
    expect(guard.canActivate(ctxFor(req('vsf-web')))).toBe(true);
    expect(() => guard.canActivate(ctxFor(req()))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctxFor(req('XMLHttpRequest')))).toThrow(ForbiddenException);
  });
});
