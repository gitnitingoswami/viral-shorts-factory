import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { ContentIdeaDto, LlmStatusDto } from '@vsf/contracts';
import { makeIdea, makeJob, makeLlmStatus, signInAs } from '../../../testing/fixtures';
import { ContentIdeas } from './ideas';

const IDEAS = '/api/content/ideas';

describe('ContentIdeas', () => {
  let fixture: ComponentFixture<ContentIdeas>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;

  const page = (items: ContentIdeaDto[]) => ({ items, total: items.length, limit: 20, offset: 0 });
  const expectIdeas = (): TestRequest => httpMock.expectOne((r) => r.url === IDEAS);

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function create(items: ContentIdeaDto[], llm: LlmStatusDto = makeLlmStatus()): Promise<void> {
    fixture = TestBed.createComponent(ContentIdeas);
    fixture.componentRef.setInput('topicId', 't1');
    el = fixture.nativeElement as HTMLElement;
    await settle();
    httpMock.expectOne('/api/content/llm-status').flush(llm);
    const req = expectIdeas();
    expect(req.request.params.toString()).toBe('topicId=t1&limit=20&offset=0');
    req.flush(page(items));
    await settle();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ContentIdeas],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture?.destroy();
    httpMock.verify();
  });

  const card = (id: string): HTMLElement => el.querySelector(`[data-idea="${id}"]`) as HTMLElement;

  it('renders idea details, provenance and safe source links', async () => {
    signInAs('reviewer');
    await create([
      makeIdea({
        sourceRefs: [
          { signalId: 's1', url: 'https://nodejs.org/api/permissions.html', title: 'Node docs' },
          { signalId: null, url: 'javascript:alert(1)', title: 'Evil' },
        ],
      }),
    ]);
    const c = card('i1');
    expect(c.textContent).toContain('Lock down fs access in 30 seconds');
    expect(c.textContent).toContain('Your script can read ~/.ssh');
    expect(c.textContent).toContain('Quick tip');
    expect(c.textContent).toContain('40 s');
    expect(c.querySelector('[data-testid="llm-provenance"]')?.textContent).toContain('ideas@1');
    const links = c.querySelectorAll('[data-testid="idea-sources"] a');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(c.querySelector('[data-testid="idea-sources"]')?.textContent).toContain('Evil');
    // Reviewers cannot select or discard.
    expect(c.querySelector('[data-testid="select-idea"]')).toBeNull();
    expect(el.querySelector('[data-testid="mock-banner"]')).toBeNull();
  });

  it('shows the mock banner and badge when the provider is mock', async () => {
    signInAs('reviewer');
    await create([makeIdea({ llm: { model: 'mock-1', promptRef: 'ideas@1', mock: true } })], makeLlmStatus('mock'));
    expect(el.querySelector('[data-testid="mock-banner"]')?.textContent).toContain(
      'AI provider not configured — showing mock outputs',
    );
    expect(card('i1').querySelector('[data-testid="mock-badge"]')).not.toBeNull();
  });

  it('flags similar ideas (≥ 0.6) with a link to the earlier idea', async () => {
    signInAs('reviewer');
    await create([
      makeIdea({ id: 'i1', similarityScore: 0.59 }),
      makeIdea({ id: 'i2', similarityScore: 0.6, duplicateOfId: 'i1' }),
    ]);
    expect(card('i1').querySelector('[data-testid="similarity-flag"]')).toBeNull();
    const flag = card('i2').querySelector('[data-testid="similarity-flag"]');
    expect(flag?.textContent).toContain('Similar to an earlier idea');
    expect(flag?.querySelector('[data-testid="similar-link"]')?.getAttribute('href')).toContain('#idea-i1');
  });

  it('owner selects an idea and navigates to the new script with its job', async () => {
    signInAs('owner');
    await create([makeIdea()]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (card('i1').querySelector('[data-testid="select-idea"]') as HTMLButtonElement).click();
    const req = httpMock.expectOne(`${IDEAS}/i1/select`);
    expect(req.request.method).toBe('POST');
    req.flush({ scriptId: 'sc9', job: makeJob({ id: 'j9' }) });
    expect(navigate).toHaveBeenCalledWith(['/content/scripts', 'sc9'], { queryParams: { job: 'j9' } });
  });

  it('owner discards an idea', async () => {
    signInAs('owner');
    await create([makeIdea()]);
    (card('i1').querySelector('[data-testid="discard-idea"]') as HTMLButtonElement).click();
    httpMock.expectOne(`${IDEAS}/i1/discard`).flush(makeIdea({ status: 'discarded' }));
    await settle();
    expect(card('i1').querySelector('[data-testid="idea-status-chip"]')?.textContent?.trim()).toBe('discarded');
    expect(card('i1').querySelector('[data-testid="select-idea"]')).toBeNull();
  });

  it('filters by status and shows the empty state', async () => {
    signInAs('reviewer');
    await create([makeIdea()]);
    const select = el.querySelector('[data-testid="idea-status"]') as HTMLSelectElement;
    select.value = 'discarded';
    select.dispatchEvent(new Event('change'));
    await settle();
    const req = expectIdeas();
    expect(req.request.params.get('status')).toBe('discarded');
    req.flush(page([]));
    await settle();
    expect(el.querySelector('[data-testid="ideas-empty"]')).not.toBeNull();
  });

  it('shows an inline error with retry', async () => {
    signInAs('reviewer');
    fixture = TestBed.createComponent(ContentIdeas);
    el = fixture.nativeElement as HTMLElement;
    await settle();
    httpMock.expectOne('/api/content/llm-status').flush(makeLlmStatus());
    expectIdeas().flush({ statusCode: 500, error: 'x', message: 'Database down' }, { status: 500, statusText: 'Error' });
    await settle();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Database down');
  });
});
