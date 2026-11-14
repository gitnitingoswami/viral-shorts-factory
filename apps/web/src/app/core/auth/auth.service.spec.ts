import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@vsf/contracts';
import { makeTokenResponse } from '../../testing/fixtures';
import { AUTH_URLS, AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  function login(): void {
    service.login('owner@example.test', 'pw').subscribe();
    http.expectOne(AUTH_URLS.login).flush(makeTokenResponse('tok-1'));
  }

  it('login posts credentials with cookies and keeps the token in memory only', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    let user: unknown;
    service.login('owner@example.test', 'secret').subscribe((u) => (user = u));

    const req = http.expectOne(AUTH_URLS.login);
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.body).toEqual({ email: 'owner@example.test', password: 'secret' });
    req.flush(makeTokenResponse('tok-1'));

    expect(service.accessToken()).toBe('tok-1');
    expect(service.currentUser()?.email).toBe('owner@example.test');
    expect(service.isAuthenticated()).toBe(true);
    expect(service.isOwner()).toBe(true);
    expect(user).toEqual(makeTokenResponse().user);
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('failed login leaves the session empty', () => {
    let failed = false;
    service.login('a@b.test', 'bad').subscribe({ error: () => (failed = true) });
    http
      .expectOne(AUTH_URLS.login)
      .flush({ statusCode: 401, error: 'Unauthorized', message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });
    expect(failed).toBe(true);
    expect(service.accessToken()).toBeNull();
    expect(service.currentUser()).toBeNull();
  });

  it('logout posts with the CSRF header and clears the session', () => {
    login();
    service.logout().subscribe();
    const req = http.expectOne(AUTH_URLS.logout);
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.get(CSRF_HEADER_NAME)).toBe(CSRF_HEADER_VALUE);
    req.flush(null);
    expect(service.accessToken()).toBeNull();
    expect(service.currentUser()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('logout clears the session even when the server call fails', () => {
    login();
    let completed = false;
    service.logout().subscribe({ complete: () => (completed = true) });
    http.expectOne(AUTH_URLS.logout).flush(null, { status: 500, statusText: 'Server Error' });
    expect(completed).toBe(true);
    expect(service.accessToken()).toBeNull();
  });

  it('refresh sends the CSRF header with credentials and stores the new token', () => {
    service.refresh().subscribe();
    const req = http.expectOne(AUTH_URLS.refresh);
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.get(CSRF_HEADER_NAME)).toBe(CSRF_HEADER_VALUE);
    req.flush(makeTokenResponse('tok-2', 'reviewer'));
    expect(service.accessToken()).toBe('tok-2');
    expect(service.isOwner()).toBe(false);
    expect(service.hasRole(['reviewer'])).toBe(true);
  });

  it('concurrent refresh calls share a single request', () => {
    const results: string[] = [];
    service.refresh().subscribe((r) => results.push(r.accessToken));
    service.refresh().subscribe((r) => results.push(r.accessToken));
    http.expectOne(AUTH_URLS.refresh).flush(makeTokenResponse('tok-3'));
    expect(results).toEqual(['tok-3', 'tok-3']);
  });

  it('restoreSession resolves without a session when refresh fails', async () => {
    const done = service.restoreSession();
    http.expectOne(AUTH_URLS.refresh).flush(null, { status: 401, statusText: 'Unauthorized' });
    await expect(done).resolves.toBeUndefined();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('restoreSession restores the session from the refresh cookie', async () => {
    const done = service.restoreSession();
    http.expectOne(AUTH_URLS.refresh).flush(makeTokenResponse('tok-4'));
    await done;
    expect(service.accessToken()).toBe('tok-4');
  });
});
