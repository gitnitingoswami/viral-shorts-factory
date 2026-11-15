import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { TrendTopicDto } from '@vsf/contracts';
import { makeCollection, makeTopic, signInAs } from '../../../testing/fixtures';
import { CollectionTopics } from './topics';

const TOPICS = '/api/research/collections/c1/topics';

describe('CollectionTopics', () => {
  let fixture: ComponentFixture<CollectionTopics>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;

  const topics = [
    makeTopic({ id: 't1', title: 'One' }),
    makeTopic({ id: 't2', title: 'Two', stale: true }),
    makeTopic({ id: 't3', title: 'Three' }),
    makeTopic({ id: 't4', title: 'Four' }),
    makeTopic({ id: 't5', title: 'Five' }),
  ];
  const page = (items: TrendTopicDto[]) => ({ items, total: items.length, limit: 25, offset: 0 });
  const expectTopics = (): TestRequest => httpMock.expectOne((r) => r.url === TOPICS);

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [CollectionTopics],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    signInAs('reviewer');
    fixture = TestBed.createComponent(CollectionTopics);
    fixture.componentRef.setInput('id', 'c1');
    el = fixture.nativeElement as HTMLElement;
    await settle();
    httpMock.expectOne('/api/research/collections/c1').flush(makeCollection());
    const req = expectTopics();
    expect(req.request.params.toString()).toBe('sort=score&limit=25&offset=0');
    req.flush(page(topics));
    await settle();
  });

  afterEach(() => {
    fixture.destroy();
    httpMock.verify();
  });

  const row = (id: string): HTMLElement => el.querySelector(`tr[data-topic="${id}"]`) as HTMLElement;
  const statusOf = (id: string): string | undefined =>
    row(id).querySelector('[data-testid="topic-status"]')?.textContent?.trim();

  it('renders rows with stale badge and score bar', () => {
    expect(el.querySelectorAll('[data-testid="topics-table"] tbody tr').length).toBe(5);
    expect(row('t2').querySelector('[data-testid="stale"]')).not.toBeNull();
    expect(row('t1').querySelector('[data-testid="stale"]')).toBeNull();
    expect(row('t1').textContent).toContain('0.72');
  });

  it('sends status, sort, minScore and search filters', async () => {
    const status = el.querySelector('[data-testid="filter-status"]') as HTMLSelectElement;
    status.value = 'approved';
    status.dispatchEvent(new Event('change'));
    expect(expectTopics().request.params.get('status')).toBe('approved');

    const sort = el.querySelector('[data-testid="filter-sort"]') as HTMLSelectElement;
    sort.value = 'confidence';
    sort.dispatchEvent(new Event('change'));
    expect(expectTopics().request.params.get('sort')).toBe('confidence');

    const slider = el.querySelector('[data-testid="filter-min-score"]') as HTMLInputElement;
    slider.value = '0.6';
    slider.dispatchEvent(new Event('input'));
    slider.dispatchEvent(new Event('change'));
    const matches = httpMock.match((r) => r.url === TOPICS);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[matches.length - 1].request.params.get('minScore')).toBe('0.6');

    const q = el.querySelector('[data-testid="filter-q"]') as HTMLInputElement;
    q.value = 'node';
    q.dispatchEvent(new Event('input'));
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = expectTopics();
    expect(req.request.params.toString()).toBe('status=approved&minScore=0.6&q=node&sort=confidence&limit=25&offset=0');
    req.flush(page([]));
    await settle();
    expect(el.querySelector('[data-testid="topics-empty"]')).not.toBeNull();
    // Debounced search re-applies the same filters once.
    await new Promise((r) => setTimeout(r, 350));
    httpMock.match((r) => r.url === TOPICS).forEach((r) => r.flush(page([])));
  });

  it('enables Compare only for 2–4 selections and navigates with ids', async () => {
    const compare = (): HTMLButtonElement => el.querySelector('[data-testid="compare"]') as HTMLButtonElement;
    const box = (id: string): HTMLInputElement =>
      row(id).querySelector('[data-testid="select-topic"]') as HTMLInputElement;
    const check = async (id: string): Promise<void> => {
      box(id).click();
      await settle();
    };

    expect(compare().disabled).toBe(true);
    await check('t1');
    expect(compare().disabled).toBe(true);
    await check('t2');
    expect(compare().disabled).toBe(false);
    await check('t3');
    await check('t4');
    expect(compare().disabled).toBe(false);
    expect(box('t5').disabled).toBe(true);
    expect(el.querySelector('[data-testid="selection-count"]')?.textContent).toContain('4 selected');

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    compare().click();
    expect(navigate).toHaveBeenCalledWith(['/research/topics/compare'], {
      queryParams: { ids: 't1,t2,t3,t4' },
    });
  });

  it('applies a decision optimistically and keeps the server result', async () => {
    (row('t1').querySelector('[data-testid="approve"]') as HTMLButtonElement).click();
    await settle();
    expect(statusOf('t1')).toBe('approved');
    const req = httpMock.expectOne('/api/research/topics/t1/decision');
    expect(req.request.body).toEqual({ decision: 'approved' });
    req.flush(makeTopic({ id: 't1', title: 'One', status: 'approved', decisionNote: null }));
    await settle();
    expect(statusOf('t1')).toBe('approved');
  });

  it('sends an optional note and rolls back on error', async () => {
    const buttons = row('t3').querySelectorAll('app-decision-controls button');
    (buttons[2] as HTMLButtonElement).click(); // Add note
    await settle();
    const note = row('t3').querySelector('[data-testid="decision-note"]') as HTMLInputElement;
    note.value = 'off-topic';
    note.dispatchEvent(new Event('input'));
    (row('t3').querySelector('[data-testid="reject"]') as HTMLButtonElement).click();
    await settle();
    expect(statusOf('t3')).toBe('rejected');

    const req = httpMock.expectOne('/api/research/topics/t3/decision');
    expect(req.request.body).toEqual({ decision: 'rejected', note: 'off-topic' });
    req.flush({ statusCode: 403, error: 'Forbidden', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(statusOf('t3')).toBe('new');
  });
});
