import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BudgetCard } from './budget-card';

describe('BudgetCard', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BudgetCard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('shows spent vs limit with a text status', async () => {
    const fixture = TestBed.createComponent(BudgetCard);
    await fixture.whenStable();
    httpMock.expectOne('/api/budget/summary').flush({
      period: '2026-11',
      currency: 'USD',
      limitMinor: 5000,
      spentMinor: 4100,
      warnPct: 80,
      status: 'warning',
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="budget-amounts"]')?.textContent).toContain('$41.00 of $50.00');
    expect(el.querySelector('[data-testid="budget-status"]')?.textContent).toContain('Approaching limit');
    expect(el.textContent).toContain('82% used');
  });

  it('shows an error state', async () => {
    const fixture = TestBed.createComponent(BudgetCard);
    await fixture.whenStable();
    httpMock
      .expectOne('/api/budget/summary')
      .flush({ statusCode: 403, error: 'Forbidden', message: 'Owner only' }, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="budget-error"]')?.textContent).toContain(
      'Owner only',
    );
  });
});
