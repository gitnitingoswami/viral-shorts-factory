import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { makeTokenResponse } from '../../testing/fixtures';
import { authInterceptor } from './auth.interceptor';
import { AUTH_URLS, AuthService } from './auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);

    auth.login('owner@example.test', 'pw').subscribe();
    httpMock.expectOne(AUTH_URLS.login).flush(makeTokenResponse('old-token'));
  });

  afterEach(() => httpMock.verify());

  const unauthorized = { status: 401, statusText: 'Unauthorized' };

  it('adds the bearer token to /api requests', () => {
    http.get('/api/channels').subscribe();
    const req = httpMock.expectOne('/api/channels');
    expect(req.request.headers.get('Authorization')).toBe('Bearer old-token');
    req.flush([]);
  });

  it('does not add the token to login/refresh or non-API URLs', () => {
    http.post(AUTH_URLS.login, {}).subscribe();
    http.post(AUTH_URLS.refresh, {}).subscribe();
    http.get('https://example.test/api/channels').subscribe();
    http.get('/assets/x.json').subscribe();
    for (const url of [AUTH_URLS.login, AUTH_URLS.refresh, 'https://example.test/api/channels', '/assets/x.json']) {
      const req = httpMock.expectOne(url);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
    }
  });

  it('on 401 refreshes once and retries the original request with the new token', () => {
    let body: unknown;
    http.get('/api/jobs').subscribe((b) => (body = b));

    httpMock.expectOne('/api/jobs').flush(null, unauthorized);
    httpMock.expectOne(AUTH_URLS.refresh).flush(makeTokenResponse('new-token'));

    const retry = httpMock.expectOne('/api/jobs');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new-token');
    retry.flush({ items: [], total: 0, limit: 20, offset: 0 });

    expect(body).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
    expect(auth.accessToken()).toBe('new-token');
  });

  it('logs out and navigates to /login when the refresh fails', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    let error: unknown;
    http.get('/api/jobs').subscribe({ error: (e: unknown) => (error = e) });

    httpMock.expectOne('/api/jobs').flush(null, unauthorized);
    httpMock.expectOne(AUTH_URLS.refresh).flush(null, unauthorized);

    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect((error as HttpErrorResponse).status).toBe(401);
    expect(auth.accessToken()).toBeNull();
    expect(auth.currentUser()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], expect.anything());
  });

  it('shares one refresh between concurrent 401 responses (single-flight)', () => {
    const results: unknown[] = [];
    http.get('/api/jobs').subscribe((b) => results.push(b));
    http.get('/api/channels').subscribe((b) => results.push(b));

    httpMock.expectOne('/api/jobs').flush(null, unauthorized);
    httpMock.expectOne('/api/channels').flush(null, unauthorized);

    const refreshes = httpMock.match(AUTH_URLS.refresh);
    expect(refreshes.length).toBe(1);
    refreshes[0]?.flush(makeTokenResponse('shared-token'));

    const jobs = httpMock.expectOne('/api/jobs');
    const channels = httpMock.expectOne('/api/channels');
    expect(jobs.request.headers.get('Authorization')).toBe('Bearer shared-token');
    expect(channels.request.headers.get('Authorization')).toBe('Bearer shared-token');
    jobs.flush('jobs');
    channels.flush('channels');
    expect(results).toEqual(['jobs', 'channels']);
  });

  it('does not retry more than once if the retried request is also 401', () => {
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    let status = 0;
    http.get('/api/jobs').subscribe({ error: (e: HttpErrorResponse) => (status = e.status) });
    httpMock.expectOne('/api/jobs').flush(null, unauthorized);
    httpMock.expectOne(AUTH_URLS.refresh).flush(makeTokenResponse('new-token'));
    httpMock.expectOne('/api/jobs').flush(null, unauthorized);
    httpMock.expectNone(AUTH_URLS.refresh);
    httpMock.expectNone('/api/jobs');
    expect(status).toBe(401);
  });

  it('clears the session and redirects to /login with returnUrl when the retry is still 401', () => {
    vi.spyOn(router, 'url', 'get').mockReturnValue('/research/topics/t1?x=1');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    let error: unknown;
    http.get('/api/jobs').subscribe({ error: (e: unknown) => (error = e) });

    httpMock.expectOne('/api/jobs').flush(null, unauthorized);
    httpMock.expectOne(AUTH_URLS.refresh).flush(makeTokenResponse('new-token'));
    const retry = httpMock.expectOne('/api/jobs');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new-token');
    retry.flush(null, unauthorized);

    httpMock.expectNone(AUTH_URLS.refresh);
    expect((error as HttpErrorResponse).status).toBe(401);
    expect(auth.accessToken()).toBeNull();
    expect(auth.currentUser()).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/research/topics/t1?x=1' },
    });
  });

  it('does not redirect when the retry fails with a non-401 error', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    let status = 0;
    http.get('/api/jobs').subscribe({ error: (e: HttpErrorResponse) => (status = e.status) });
    httpMock.expectOne('/api/jobs').flush(null, unauthorized);
    httpMock.expectOne(AUTH_URLS.refresh).flush(makeTokenResponse('new-token'));
    httpMock.expectOne('/api/jobs').flush(null, { status: 500, statusText: 'Server Error' });
    expect(status).toBe(500);
    expect(auth.accessToken()).toBe('new-token');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('passes non-401 errors through untouched', () => {
    let status = 0;
    http.get('/api/jobs').subscribe({ error: (e: HttpErrorResponse) => (status = e.status) });
    httpMock.expectOne('/api/jobs').flush(null, { status: 500, statusText: 'Server Error' });
    httpMock.expectNone(AUTH_URLS.refresh);
    expect(status).toBe(500);
  });
});
