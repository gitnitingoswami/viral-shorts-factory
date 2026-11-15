import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SILENT_LOADING, SUPPRESS_ERROR_NOTIFICATION } from '../http/http-context';
import { BudgetApiService } from './budget-api.service';
import { NichesApiService } from './niches-api.service';
import { ResearchApiService, topicQueryParams } from './research-api.service';

describe('research API services', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('ResearchApiService', () => {
    let api: ResearchApiService;
    beforeEach(() => (api = TestBed.inject(ResearchApiService)));

    it('lists sources', () => {
      api.listSources().subscribe();
      const req = httpMock.expectOne('/api/research/sources');
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('starts a run with nicheId and idempotency key', () => {
      api.startRun('n1', 'key-1').subscribe();
      const req = httpMock.expectOne('/api/research/runs');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ nicheId: 'n1', idempotencyKey: 'key-1' });
      // Run errors surface through the global notification.
      expect(req.request.context.get(SUPPRESS_ERROR_NOTIFICATION)).toBe(false);
      req.flush({});
    });

    it('lists collections with niche and paging params', () => {
      api.listCollections({ nicheId: 'n1', limit: 20, offset: 40 }).subscribe();
      const req = httpMock.expectOne((r) => r.url === '/api/research/collections');
      expect(req.request.params.get('nicheId')).toBe('n1');
      expect(req.request.params.get('limit')).toBe('20');
      expect(req.request.params.get('offset')).toBe('40');
      req.flush({ items: [], total: 0, limit: 20, offset: 40 });
    });

    it('gets a collection; background polling is silent', () => {
      api.getCollection('c 1', { background: true }).subscribe();
      const req = httpMock.expectOne('/api/research/collections/c%201');
      expect(req.request.context.get(SILENT_LOADING)).toBe(true);
      req.flush({});
    });

    it('lists topics with filters', () => {
      api.listTopics('c1', { status: 'new', minScore: 0.5, q: ' node ', sort: 'freshness', limit: 25, offset: 0 }).subscribe();
      const req = httpMock.expectOne((r) => r.url === '/api/research/collections/c1/topics');
      expect(req.request.params.toString()).toBe('status=new&minScore=0.5&q=node&sort=freshness&limit=25&offset=0');
      req.flush({ items: [], total: 0, limit: 25, offset: 0 });
    });

    it('gets report, topic, and compare', () => {
      api.getReport('c1').subscribe();
      httpMock.expectOne('/api/research/collections/c1/report').flush({});
      api.getTopic('t1').subscribe();
      httpMock.expectOne('/api/research/topics/t1').flush({});
      api.compareTopics(['a', 'b', 'c']).subscribe();
      const req = httpMock.expectOne((r) => r.url === '/api/research/topics/compare');
      expect(req.request.params.get('ids')).toBe('a,b,c');
      req.flush([]);
    });

    it('posts a decision', () => {
      api.decide('t1', { decision: 'approved', note: 'good' }).subscribe();
      const req = httpMock.expectOne('/api/research/topics/t1/decision');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ decision: 'approved', note: 'good' });
      req.flush({});
    });
  });

  describe('topicQueryParams', () => {
    it('omits empty filters', () => {
      expect(topicQueryParams({ status: null, minScore: 0, q: '   ', sort: null }).keys()).toEqual([]);
    });

    it('clamps minScore to 1', () => {
      expect(topicQueryParams({ minScore: 3 }).get('minScore')).toBe('1');
    });
  });

  it('NichesApiService lists, creates and patches', () => {
    const api = TestBed.inject(NichesApiService);
    api.list().subscribe();
    expect(httpMock.expectOne('/api/niches').request.method).toBe('GET');
    api.create({ name: 'A', keywords: ['a'] }).subscribe();
    const create = httpMock.expectOne('/api/niches');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ name: 'A', keywords: ['a'] });
    api.update('n1', { active: false }).subscribe();
    const patch = httpMock.expectOne('/api/niches/n1');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ active: false });
    httpMock.match(() => true).forEach((r) => r.flush({}));
  });

  it('BudgetApiService gets the summary', () => {
    TestBed.inject(BudgetApiService).summary().subscribe();
    const req = httpMock.expectOne('/api/budget/summary');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });
});
