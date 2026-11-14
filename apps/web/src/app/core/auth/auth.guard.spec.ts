import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import type { UserRole } from '@vsf/contracts';
import { makeTokenResponse } from '../../testing/fixtures';
import { authGuard, guestGuard, roleGuard, safeReturnUrl } from './auth.guard';
import { AUTH_URLS, AuthService } from './auth.service';

describe('auth guards', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    router = TestBed.inject(Router);
  });

  function signIn(role: UserRole): void {
    TestBed.inject(AuthService).login('x@example.test', 'pw').subscribe();
    TestBed.inject(HttpTestingController).expectOne(AUTH_URLS.login).flush(makeTokenResponse('t', role));
  }

  function routeWith(data: Record<string, unknown>): ActivatedRouteSnapshot {
    return { data } as unknown as ActivatedRouteSnapshot;
  }
  const state = (url: string): RouterStateSnapshot => ({ url }) as RouterStateSnapshot;

  describe('authGuard', () => {
    it('redirects anonymous users to /login with a returnUrl', () => {
      const result = TestBed.runInInjectionContext(() => authGuard(routeWith({}), state('/jobs')));
      expect(result).toBeInstanceOf(UrlTree);
      expect(router.serializeUrl(result as UrlTree)).toBe('/login?returnUrl=%2Fjobs');
    });

    it('allows authenticated users', () => {
      signIn('reviewer');
      expect(TestBed.runInInjectionContext(() => authGuard(routeWith({}), state('/jobs')))).toBe(true);
    });
  });

  describe('roleGuard', () => {
    const ownerOnly = routeWith({ roles: ['owner'] });

    it('allows owners on owner-only routes', () => {
      signIn('owner');
      expect(TestBed.runInInjectionContext(() => roleGuard(ownerOnly, state('/audit')))).toBe(true);
    });

    it('redirects reviewers to the dashboard', () => {
      signIn('reviewer');
      const result = TestBed.runInInjectionContext(() => roleGuard(ownerOnly, state('/audit')));
      expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
    });

    it('denies by default when no roles are configured', () => {
      signIn('owner');
      const result = TestBed.runInInjectionContext(() => roleGuard(routeWith({}), state('/audit')));
      expect(result).toBeInstanceOf(UrlTree);
    });

    it('redirects anonymous users to /login', () => {
      const result = TestBed.runInInjectionContext(() => roleGuard(ownerOnly, state('/audit')));
      expect(router.serializeUrl(result as UrlTree)).toBe('/login?returnUrl=%2Faudit');
    });
  });

  describe('guestGuard', () => {
    it('sends signed-in users away from /login', () => {
      signIn('owner');
      const result = TestBed.runInInjectionContext(() => guestGuard(routeWith({}), state('/login')));
      expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
    });
  });

  describe('safeReturnUrl', () => {
    it.each([
      [undefined, '/dashboard'],
      ['/jobs?x=1', '/jobs?x=1'],
      ['https://evil.test', '/dashboard'],
      ['//evil.test', '/dashboard'],
      ['/\\evil.test', '/dashboard'],
      ['/login', '/dashboard'],
    ])('%s -> %s', (input, expected) => {
      expect(safeReturnUrl(input)).toBe(expected);
    });
  });
});
