import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { makeTopicDetail } from '../../../testing/fixtures';
import { TopicCompare, isValidCompareCount, parseCompareIds } from './compare';

describe('TopicCompare', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TopicCompare],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  async function create(ids: string | undefined): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(TopicCompare);
    fixture.componentRef.setInput('ids', ids);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('parses and validates ids', () => {
    expect(parseCompareIds(' a, b ,,a ')).toEqual(['a', 'b']);
    expect([1, 2, 3, 4, 5].map(isValidCompareCount)).toEqual([false, true, true, true, false]);
  });

  it.each([undefined, 'a', 'a,b,c,d,e'])('rejects %s without calling the API', async (ids) => {
    const el = await create(ids);
    expect(el.querySelector('[data-testid="compare-invalid"]')).not.toBeNull();
    httpMock.expectNone(() => true);
  });

  it('renders a side-by-side breakdown with missing values', async () => {
    const fixture = TestBed.createComponent(TopicCompare);
    fixture.componentRef.setInput('ids', 't1,t2');
    await fixture.whenStable();
    const req = httpMock.expectOne((r) => r.url === '/api/research/topics/compare');
    expect(req.request.params.get('ids')).toBe('t1,t2');
    req.flush([
      makeTopicDetail({ id: 't1', title: 'A' }),
      makeTopicDetail({
        id: 't2',
        title: 'B',
        missingComponents: [],
        breakdown: [{ component: 'competition', weight: 0.2, value: 0.4, explanation: 'ok' }],
      }),
    ]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const cells = el.querySelectorAll('tr[data-component="competition"] td');
    expect(cells.length).toBe(2);
    expect(cells[0].textContent).toContain('missing');
    expect(cells[1].textContent).toContain('0.40');
    expect(el.querySelectorAll('thead th').length).toBe(3);
  });
});
