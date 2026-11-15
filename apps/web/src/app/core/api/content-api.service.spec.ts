import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { makeLlmStatus } from '../../testing/fixtures';
import { apiErrorMessages, httpStatus } from '../http/api-error';
import { SILENT_LOADING, SUPPRESS_ERROR_NOTIFICATION } from '../http/http-context';
import { ContentApiService } from './content-api.service';
import { JobsApiService } from './jobs-api.service';
import { LlmStatusService } from './llm-status.service';

describe('content API services', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('ContentApiService', () => {
    let api: ContentApiService;
    beforeEach(() => (api = TestBed.inject(ContentApiService)));

    it('gets llm status silently', () => {
      api.llmStatus().subscribe();
      const req = httpMock.expectOne('/api/content/llm-status');
      expect(req.request.method).toBe('GET');
      expect(req.request.context.get(SILENT_LOADING)).toBe(true);
      req.flush(makeLlmStatus());
    });

    it('generates ideas for a topic with an idempotency key', () => {
      api.generateIdeas('t 1', 'key-1').subscribe();
      const req = httpMock.expectOne('/api/research/topics/t%201/ideas');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ idempotencyKey: 'key-1' });
      req.flush({});
    });

    it('lists ideas with topic, status and paging; omits empty filters', () => {
      api.listIdeas({ topicId: 't1', status: 'proposed', limit: 20, offset: 40 }).subscribe();
      const req = httpMock.expectOne((r) => r.url === '/api/content/ideas');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.toString()).toBe('topicId=t1&status=proposed&limit=20&offset=40');
      req.flush({ items: [], total: 0, limit: 20, offset: 40 });
      api.listIdeas({ topicId: null, status: null }).subscribe();
      expect(httpMock.expectOne((r) => r.url === '/api/content/ideas').request.params.keys()).toEqual([]);
    });

    it('selects and discards ideas (errors via global notification)', () => {
      api.selectIdea('i1').subscribe();
      const select = httpMock.expectOne('/api/content/ideas/i1/select');
      expect(select.request.method).toBe('POST');
      expect(select.request.context.get(SUPPRESS_ERROR_NOTIFICATION)).toBe(false);
      select.flush({ scriptId: 'sc1', job: {} });
      api.discardIdea('i1').subscribe();
      const discard = httpMock.expectOne('/api/content/ideas/i1/discard');
      expect(discard.request.method).toBe('POST');
      discard.flush({});
    });

    it('lists scripts, gets detail and versions', () => {
      api.listScripts({ status: 'in_review', limit: 25, offset: 0 }).subscribe();
      const list = httpMock.expectOne((r) => r.url === '/api/content/scripts');
      expect(list.request.params.toString()).toBe('status=in_review&limit=25&offset=0');
      list.flush({ items: [], total: 0, limit: 25, offset: 0 });
      api.getScript('sc1').subscribe();
      httpMock.expectOne('/api/content/scripts/sc1').flush({});
      api.getVersion('sc1', 3, { background: true }).subscribe();
      const v = httpMock.expectOne('/api/content/scripts/sc1/versions/3');
      expect(v.request.method).toBe('GET');
      expect(v.request.context.get(SILENT_LOADING)).toBe(true);
      v.flush({});
    });

    it('creates a version with baseVersion', () => {
      const body = { baseVersion: 2, title: 'T', scenes: [] };
      api.createVersion('sc1', body).subscribe();
      const req = httpMock.expectOne('/api/content/scripts/sc1/versions');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(body);
      expect(req.request.context.get(SUPPRESS_ERROR_NOTIFICATION)).toBe(true);
      req.flush({});
    });

    it('re-runs checks for a version', () => {
      api.rerunChecks('sc1', 2).subscribe();
      const req = httpMock.expectOne('/api/content/scripts/sc1/versions/2/checks');
      expect(req.request.method).toBe('POST');
      req.flush({});
    });

    it('overrides claims and code checks with a reason', () => {
      api.overrideClaim('cl1', 'Verified in docs').subscribe();
      const claim = httpMock.expectOne('/api/content/claims/cl1/override');
      expect(claim.request.method).toBe('POST');
      expect(claim.request.body).toEqual({ reason: 'Verified in docs' });
      claim.flush({});
      api.overrideCodeCheck('cc1', 'Sandbox down; ran locally').subscribe();
      const code = httpMock.expectOne('/api/content/code-checks/cc1/override');
      expect(code.request.body).toEqual({ reason: 'Sandbox down; ran locally' });
      code.flush({});
    });

    it('posts a script decision bound to a version', () => {
      api.decide('sc1', { version: 2, decision: 'approved' }).subscribe();
      const req = httpMock.expectOne('/api/content/scripts/sc1/decision');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ version: 2, decision: 'approved' });
      expect(req.request.context.get(SUPPRESS_ERROR_NOTIFICATION)).toBe(true);
      req.flush({});
    });
  });

  it('JobsApiService gets a job; background polling is silent', () => {
    TestBed.inject(JobsApiService).get('j 1', { background: true }).subscribe();
    const req = httpMock.expectOne('/api/jobs/j%201');
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(SILENT_LOADING)).toBe(true);
    req.flush({});
  });

  it('LlmStatusService loads once and exposes isMock', () => {
    const svc = TestBed.inject(LlmStatusService);
    svc.load();
    svc.load();
    httpMock.expectOne('/api/content/llm-status').flush(makeLlmStatus('mock'));
    expect(svc.isMock()).toBe(true);
    svc.load();
    httpMock.expectNone('/api/content/llm-status');
  });

  it('LlmStatusService retries after a failure and shows no banner meanwhile', () => {
    const svc = TestBed.inject(LlmStatusService);
    svc.load();
    httpMock.expectOne('/api/content/llm-status').flush(null, { status: 500, statusText: 'Error' });
    expect(svc.isMock()).toBe(false);
    svc.load();
    httpMock.expectOne('/api/content/llm-status').flush(makeLlmStatus('claude'));
    expect(svc.isMock()).toBe(false);
  });

  it('apiErrorMessages keeps array messages separate', () => {
    const err = new HttpErrorResponse({
      status: 409,
      error: { statusCode: 409, error: 'Conflict', message: ['Claim unsupported', 'Code failed'] },
    });
    expect(apiErrorMessages(err)).toEqual(['Claim unsupported', 'Code failed']);
    expect(httpStatus(err)).toBe(409);
    expect(apiErrorMessages(new Error('x'), 'fallback')).toEqual(['fallback']);
    expect(httpStatus(new Error('x'))).toBeNull();
  });
});
