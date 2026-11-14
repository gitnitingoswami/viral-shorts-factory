import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ReadinessResponse } from '@vsf/contracts';
import { HEALTH_REFRESH_INTERVAL_MS, HealthStatus } from './health-status';

const URL = '/api/health/ready';

const healthy: ReadinessResponse = {
  status: 'ok',
  version: '0.1.0',
  timestamp: '2026-11-14T10:00:00.000Z',
  checks: {
    database: { status: 'up', latencyMs: 3 },
    redis: { status: 'up', latencyMs: 1 },
    storage: { status: 'up', latencyMs: 12 },
  },
};

const degraded: ReadinessResponse = {
  ...healthy,
  status: 'degraded',
  checks: {
    database: { status: 'up', latencyMs: 4 },
    redis: { status: 'down', error: 'ECONNREFUSED 127.0.0.1:6379' },
    storage: { status: 'up', latencyMs: 9 },
  },
};

describe('HealthStatus', () => {
  let fixture: ComponentFixture<HealthStatus>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;

  async function create(compact = false): Promise<void> {
    fixture = TestBed.createComponent(HealthStatus);
    fixture.componentRef.setInput('compact', compact);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const statusOf = (name: string): string | undefined =>
    el.querySelector(`tr[data-dependency="${name}"] [data-testid="dependency-status"]`)?.textContent?.trim();

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HealthStatus],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture?.destroy();
    httpMock.verify();
    vi.useRealTimers();
  });

  it('shows a loading state, then all dependencies up', async () => {
    await create();
    expect(el.textContent).toContain('Loading system health');

    httpMock.expectOne(URL).flush(healthy);
    await settle();

    expect(el.querySelector('[data-testid="health-overall"]')?.textContent).toContain('Operational');
    expect(statusOf('database')).toBe('Up');
    expect(statusOf('redis')).toBe('Up');
    expect(statusOf('storage')).toBe('Up');
    expect(el.querySelector('tr[data-dependency="storage"]')?.textContent).toContain('12 ms');
  });

  it('renders the 503 degraded body as data, with the failing dependency and its error', async () => {
    await create();
    httpMock.expectOne(URL).flush(degraded, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    expect(el.querySelector('[data-testid="health-error"]')).toBeNull();
    expect(el.querySelector('[data-testid="health-overall"]')?.textContent).toContain('Degraded');
    expect(statusOf('database')).toBe('Up');
    expect(statusOf('redis')).toBe('Down');
    expect(el.querySelector('tr[data-dependency="redis"]')?.textContent).toContain('ECONNREFUSED 127.0.0.1:6379');
  });

  it('shows an error state for non-readiness failures', async () => {
    await create();
    httpMock
      .expectOne(URL)
      .flush({ statusCode: 500, error: 'Internal', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(el.querySelector('[data-testid="health-error"]')?.textContent).toContain('boom');
  });

  it('shows an empty state when no checks are reported', async () => {
    await create();
    httpMock.expectOne(URL).flush({ ...healthy, checks: {} });
    await settle();
    expect(el.querySelector('[data-testid="health-empty"]')).not.toBeNull();
  });

  it('refresh button re-fetches', async () => {
    await create();
    httpMock.expectOne(URL).flush(healthy);
    await settle();
    (el.querySelector('button') as HTMLButtonElement).click();
    httpMock.expectOne(URL).flush(degraded, { status: 503, statusText: 'Service Unavailable' });
    await settle();
    expect(el.querySelector('[data-testid="health-overall"]')?.textContent).toContain('Degraded');
  });

  it('auto-refreshes every 15 seconds while visible', async () => {
    vi.useFakeTimers();
    await create();
    httpMock.expectOne(URL).flush(healthy);
    vi.advanceTimersByTime(HEALTH_REFRESH_INTERVAL_MS);
    httpMock.expectOne(URL).flush(healthy);
  });

  it('compact mode summarises the down count', async () => {
    await create(true);
    httpMock.expectOne(URL).flush(degraded, { status: 503, statusText: 'Service Unavailable' });
    await settle();
    expect(el.textContent).toContain('1 of 3 dependencies down');
    expect(el.querySelector('[data-testid="health-checks"]')).toBeNull();
  });
});
