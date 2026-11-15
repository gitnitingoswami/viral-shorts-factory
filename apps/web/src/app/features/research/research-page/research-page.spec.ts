import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { TrendCollectionDto } from '@vsf/contracts';
import { NotificationService } from '../../../core/http/notification.service';
import { makeCollection, makeNiche, makeSource, signInAs } from '../../../testing/fixtures';
import { COLLECTION_POLL_INTERVAL_MS, ResearchPage } from './research-page';

const COLLECTIONS = '/api/research/collections';

describe('ResearchPage', () => {
  let fixture: ComponentFixture<ResearchPage>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;
  let visibility: DocumentVisibilityState;

  const page = (items: TrendCollectionDto[]) => ({ items, total: items.length, limit: 20, offset: 0 });
  const pollUrl = (id: string) => `${COLLECTIONS}/${id}`;
  const isPolling = (): boolean => (fixture.componentInstance as unknown as { polling: boolean }).polling;

  function create(collections: TrendCollectionDto[]): void {
    fixture = TestBed.createComponent(ResearchPage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    httpMock.expectOne('/api/niches').flush([makeNiche()]);
    httpMock.expectOne('/api/research/sources').flush([
      makeSource(),
      makeSource({ key: 'youtube', name: 'YouTube', configured: false }),
    ]);
    const req = httpMock.expectOne((r) => r.url === COLLECTIONS);
    expect(req.request.params.get('nicheId')).toBe('n1');
    req.flush(page(collections));
    fixture.detectChanges();
  }

  beforeEach(() => {
    visibility = 'visible';
    TestBed.configureTestingModule({
      imports: [ResearchPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    const doc = TestBed.inject(DOCUMENT);
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => visibility });
    vi.useFakeTimers();
  });

  afterEach(() => {
    fixture?.destroy();
    httpMock.verify();
    vi.useRealTimers();
    Reflect.deleteProperty(TestBed.inject(DOCUMENT), 'visibilityState');
  });

  it('shows the source registry including unconfigured YouTube', () => {
    signInAs('reviewer');
    create([makeCollection()]);
    expect(el.querySelector('[data-source="youtube"] [data-testid="source-state"]')?.textContent).toContain(
      'Not configured — competition signal unavailable',
    );
    expect(el.querySelector('[data-testid="run-now"]')).toBeNull();
    expect(el.querySelector('[data-testid="source-results"]')?.textContent).toContain('API key not configured');
  });

  it('polls a running collection every 5 s and stops at a terminal status', () => {
    create([makeCollection({ status: 'running', finishedAt: null })]);
    expect(isPolling()).toBe(true);

    vi.advanceTimersByTime(COLLECTION_POLL_INTERVAL_MS);
    httpMock.expectOne(pollUrl('c1')).flush(makeCollection({ status: 'running', finishedAt: null }));
    vi.advanceTimersByTime(COLLECTION_POLL_INTERVAL_MS);
    httpMock.expectOne(pollUrl('c1')).flush(makeCollection({ status: 'partial' }));
    fixture.detectChanges();

    expect(isPolling()).toBe(false);
    expect(el.querySelector('[data-testid="collection-status"]')?.textContent).toBe('partial');
    expect(el.querySelector('[data-testid="status-announcement"]')?.textContent).toContain('partial');
    vi.advanceTimersByTime(COLLECTION_POLL_INTERVAL_MS * 3);
    httpMock.expectNone(pollUrl('c1'));
  });

  it('does not poll completed collections', () => {
    create([makeCollection({ status: 'completed' })]);
    expect(isPolling()).toBe(false);
    vi.advanceTimersByTime(COLLECTION_POLL_INTERVAL_MS * 2);
    httpMock.expectNone(pollUrl('c1'));
  });

  it('stops polling when the tab is hidden and resumes when visible', () => {
    create([makeCollection({ status: 'queued', startedAt: null, finishedAt: null })]);
    const doc = TestBed.inject(DOCUMENT);
    visibility = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(isPolling()).toBe(false);
    vi.advanceTimersByTime(COLLECTION_POLL_INTERVAL_MS * 2);
    httpMock.expectNone(pollUrl('c1'));

    visibility = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    httpMock.expectOne(pollUrl('c1')).flush(makeCollection({ status: 'completed' }));
    expect(isPolling()).toBe(false);
  });

  it('stops polling on destroy', () => {
    create([makeCollection({ status: 'running', finishedAt: null })]);
    fixture.destroy();
    vi.advanceTimersByTime(COLLECTION_POLL_INTERVAL_MS * 2);
    httpMock.expectNone(pollUrl('c1'));
  });

  it('owner runs research now, shows the new collection and polls it', () => {
    signInAs('owner');
    create([makeCollection()]);
    (el.querySelector('[data-testid="run-now"]') as HTMLButtonElement).click();
    const req = httpMock.expectOne('/api/research/runs');
    expect(req.request.body.nicheId).toBe('n1');
    expect(req.request.body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    req.flush(makeCollection({ id: 'c2', status: 'queued', startedAt: null, finishedAt: null, sourceResults: [] }), {
      status: 202,
      statusText: 'Accepted',
    });
    fixture.detectChanges();
    const rows = el.querySelectorAll('[data-testid="collections-table"] tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('data-collection')).toBe('c2');
    expect(isPolling()).toBe(true);
    vi.advanceTimersByTime(COLLECTION_POLL_INTERVAL_MS);
    httpMock.expectOne(pollUrl('c2')).flush(makeCollection({ id: 'c2', status: 'completed' }));
    expect(isPolling()).toBe(false);
  });
});
