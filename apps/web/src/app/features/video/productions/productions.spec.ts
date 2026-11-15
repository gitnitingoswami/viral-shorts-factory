import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { UserRole, VideoProductionDto } from '@vsf/contracts';
import { NotificationService } from '../../../core/http/notification.service';
import { makeProduction, signInAs } from '../../../testing/fixtures';
import { PRODUCTION_POLL_INTERVAL_MS } from '../video-labels';
import { ProductionQueue } from './productions';

const LIST = '/api/video/productions';

describe('ProductionQueue', () => {
  let fixture: ComponentFixture<ProductionQueue>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;

  const q = <T extends Element = HTMLElement>(sel: string): T | null => el.querySelector<T>(sel);
  const isPolling = (): boolean => (fixture.componentInstance as unknown as { polling: boolean }).polling;
  const page = (items: VideoProductionDto[], total = items.length) => ({ items, total, limit: 25, offset: 0 });

  function create(role: UserRole, items: VideoProductionDto[], total?: number): void {
    signInAs(role);
    fixture = TestBed.createComponent(ProductionQueue);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    const req = httpMock.expectOne((r) => r.url === LIST);
    expect(req.request.params.toString()).toBe('limit=25&offset=0');
    req.flush(page(items, total));
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ProductionQueue],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(NotificationService), 'success').mockImplementation(() => undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    fixture?.destroy();
    httpMock.verify();
    vi.useRealTimers();
  });

  it('renders rows with status text, stage, progress, version and error', () => {
    create('reviewer', [
      makeProduction(),
      makeProduction({ id: 'p2', status: 'failed', stage: 'compose', progress: 60, error: 'ffmpeg exited 1', latestVersion: null }),
    ]);
    const ready = q('[data-production="p1"]') as HTMLElement;
    expect(ready.textContent).toContain('Ready');
    expect(ready.textContent).toContain('v1');
    expect(ready.querySelector('a')?.getAttribute('href')).toBe('/video/p1');
    const failed = q('[data-production="p2"]') as HTMLElement;
    expect(failed.textContent).toContain('Failed');
    expect(failed.textContent).toContain('Composing video');
    expect(failed.textContent).toContain('60%');
    expect(failed.querySelector('[data-testid="production-error"]')?.textContent).toContain('ffmpeg exited 1');
    expect(isPolling()).toBe(false);
  });

  it('reviewers see no owner actions', () => {
    create('reviewer', [makeProduction({ status: 'rendering', stage: 'frames', progress: 40 }), makeProduction({ id: 'p2', status: 'failed' })]);
    expect(q('[data-testid="cancel-production"]')).toBeNull();
    expect(q('[data-testid="retry-production"]')).toBeNull();
    expect(q('[data-testid="open-start-render"]')).toBeNull();
  });

  it('polls while any production is active and stops when all are terminal', () => {
    create('owner', [makeProduction({ status: 'rendering', stage: 'frames', progress: 40 })]);
    expect(isPolling()).toBe(true);
    vi.advanceTimersByTime(PRODUCTION_POLL_INTERVAL_MS);
    httpMock
      .expectOne((r) => r.url === LIST)
      .flush(page([makeProduction({ status: 'rendering', stage: 'compose', progress: 80 })]));
    fixture.detectChanges();
    expect(q('[data-production="p1"]')?.textContent).toContain('80%');
    expect(isPolling()).toBe(true);

    vi.advanceTimersByTime(PRODUCTION_POLL_INTERVAL_MS);
    httpMock.expectOne((r) => r.url === LIST).flush(page([makeProduction()]));
    fixture.detectChanges();
    expect(isPolling()).toBe(false);
    expect(q('[data-testid="queue-announcement"]')?.textContent).toContain('Lock down fs access: Ready');
    vi.advanceTimersByTime(PRODUCTION_POLL_INTERVAL_MS * 3);
    httpMock.expectNone((r) => r.url === LIST);
  });

  it('stops polling on destroy', () => {
    create('owner', [makeProduction({ status: 'queued', stage: 'queued', progress: 0 })]);
    expect(isPolling()).toBe(true);
    fixture.destroy();
    vi.advanceTimersByTime(PRODUCTION_POLL_INTERVAL_MS * 3);
    httpMock.expectNone((r) => r.url === LIST);
  });

  it('owner cancels an active production', () => {
    create('owner', [makeProduction({ status: 'queued', stage: 'queued', progress: 0 })]);
    expect(q('[data-testid="retry-production"]')).toBeNull();
    (q('[data-testid="cancel-production"]') as HTMLButtonElement).click();
    const req = httpMock.expectOne(`${LIST}/p1/cancel`);
    expect(req.request.method).toBe('POST');
    req.flush(makeProduction({ status: 'cancelled', stage: 'queued', progress: 0 }));
    fixture.detectChanges();
    expect(q('[data-production="p1"]')?.textContent).toContain('Cancelled');
    expect(isPolling()).toBe(false);
  });

  it('owner retries a failed production and the list reloads', () => {
    create('owner', [makeProduction({ status: 'quality_failed' })]);
    expect(q('[data-testid="cancel-production"]')).toBeNull();
    (q('[data-testid="retry-production"]') as HTMLButtonElement).click();
    const req = httpMock.expectOne(`${LIST}/p1/retry`);
    expect(req.request.method).toBe('POST');
    req.flush({ production: makeProduction({ status: 'queued' }), job: null, created: true });
    httpMock.expectOne((r) => r.url === LIST).flush(page([makeProduction({ status: 'queued', stage: 'queued', progress: 0 })]));
    fixture.detectChanges();
    expect(q('[data-production="p1"]')?.textContent).toContain('Queued');
    expect(TestBed.inject(NotificationService).success).toHaveBeenCalledWith('Render re-queued.');
  });

  it('filters by status and paginates', () => {
    create('owner', [makeProduction()], 30);
    const select = q('[data-testid="production-status"]') as HTMLSelectElement;
    select.value = 'failed';
    select.dispatchEvent(new Event('change'));
    const filtered = httpMock.expectOne((r) => r.url === LIST);
    expect(filtered.request.params.toString()).toBe('status=failed&limit=25&offset=0');
    filtered.flush(page([makeProduction({ status: 'failed' })], 30));
    fixture.detectChanges();
    (q('[data-testid="next-page"]') as HTMLButtonElement).click();
    const next = httpMock.expectOne((r) => r.url === LIST);
    expect(next.request.params.toString()).toBe('status=failed&limit=25&offset=25');
    next.flush({ items: [], total: 0, limit: 25, offset: 25 });
    fixture.detectChanges();
    expect(q('[data-testid="productions-empty"]')).not.toBeNull();
  });
});
