import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SILENT_LOADING, SUPPRESS_ERROR_NOTIFICATION } from '../http/http-context';
import { VideoApiService } from './video-api.service';

describe('VideoApiService', () => {
  let httpMock: HttpTestingController;
  let api: VideoApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
    api = TestBed.inject(VideoApiService);
  });

  afterEach(() => httpMock.verify());

  it('gets render status silently and voices', () => {
    api.status().subscribe();
    const status = httpMock.expectOne('/api/video/status');
    expect(status.request.method).toBe('GET');
    expect(status.request.context.get(SILENT_LOADING)).toBe(true);
    status.flush({});
    api.voices().subscribe();
    httpMock.expectOne('/api/video/voices').flush([]);
  });

  it('creates a production with inline-handled errors', () => {
    const body = { scriptId: 'sc1', voiceProfileId: 'vo1', settings: { fps: 30 as const } };
    api.createProduction(body).subscribe();
    const req = httpMock.expectOne('/api/video/productions');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    expect(req.request.context.get(SUPPRESS_ERROR_NOTIFICATION)).toBe(true);
    req.flush({});
  });

  it('lists productions with status and paging; omits empty filters; background polling is silent', () => {
    api.listProductions({ status: 'rendering', limit: 25, offset: 50 }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/video/productions');
    expect(req.request.params.toString()).toBe('status=rendering&limit=25&offset=50');
    expect(req.request.context.get(SILENT_LOADING)).toBe(false);
    req.flush({ items: [], total: 0, limit: 25, offset: 50 });
    api.listProductions({ status: null }, { background: true }).subscribe();
    const bg = httpMock.expectOne((r) => r.url === '/api/video/productions');
    expect(bg.request.params.keys()).toEqual([]);
    expect(bg.request.context.get(SILENT_LOADING)).toBe(true);
    bg.flush({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it('gets, cancels and retries a production (ids encoded)', () => {
    api.getProduction('p 1').subscribe();
    httpMock.expectOne('/api/video/productions/p%201').flush({});
    api.cancelProduction('p1').subscribe();
    const cancel = httpMock.expectOne('/api/video/productions/p1/cancel');
    expect(cancel.request.method).toBe('POST');
    expect(cancel.request.context.get(SUPPRESS_ERROR_NOTIFICATION)).toBe(false);
    cancel.flush({});
    api.retryProduction('p1').subscribe();
    const retry = httpMock.expectOne('/api/video/productions/p1/retry');
    expect(retry.request.method).toBe('POST');
    retry.flush({});
  });

  it('lists assets by kind and gets a signed url silently', () => {
    api.listAssets({ kind: 'audio', limit: 25, offset: 0 }).subscribe();
    const list = httpMock.expectOne((r) => r.url === '/api/video/assets');
    expect(list.request.params.toString()).toBe('kind=audio&limit=25&offset=0');
    list.flush({ items: [], total: 0, limit: 25, offset: 0 });
    api.assetUrl('a1').subscribe();
    const url = httpMock.expectOne('/api/video/assets/a1/url');
    expect(url.request.method).toBe('GET');
    expect(url.request.context.get(SILENT_LOADING)).toBe(true);
    url.flush({ url: '/api/video/media/a1?exp=1&sig=x', expiresAt: '2026-11-15T03:00:00.000Z' });
  });
});
