import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NotificationService } from '../../../core/http/notification.service';
import { makeNiche, signInAs } from '../../../testing/fixtures';
import { Niches, normalizeKeywords } from './niches';

describe('Niches', () => {
  let fixture: ComponentFixture<Niches>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function type(selector: string, value: string): Promise<void> {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle();
  }

  async function submit(): Promise<void> {
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Niches],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    signInAs('owner');
    fixture = TestBed.createComponent(Niches);
    el = fixture.nativeElement as HTMLElement;
    await settle();
    httpMock.expectOne('/api/niches').flush([makeNiche()]);
    await settle();
  });

  afterEach(() => httpMock.verify());

  it('normalizes keywords', () => {
    expect(normalizeKeywords(' TypeScript, ,Node.js ')).toEqual(['typescript', 'node.js']);
  });

  it('requires a name and at least one keyword', async () => {
    await submit();
    expect(el.textContent).toContain('Name is required.');
    expect(el.textContent).toContain('Add at least one keyword.');
    httpMock.expectNone((r) => r.method === 'POST');

    await type('[data-testid="niche-name"]', 'Git tricks');
    await submit();
    expect(el.textContent).toContain('Add at least one keyword.');
    httpMock.expectNone((r) => r.method === 'POST');
  });

  it('creates a niche with keyword chips', async () => {
    await type('[data-testid="niche-name"]', 'Git tricks');
    await type('[data-testid="keyword-input"]', 'Git, rebase');
    await type('[data-testid="exclude-input"]', 'github');
    expect(el.querySelectorAll('mat-chip-row').length).toBe(3);
    await submit();
    const req = httpMock.expectOne((r) => r.url === '/api/niches' && r.method === 'POST');
    expect(req.request.body).toEqual({
      name: 'Git tricks',
      description: '',
      keywords: ['git', 'rebase'],
      excludeKeywords: ['github'],
      active: true,
    });
    req.flush(makeNiche({ id: 'n2', name: 'Git tricks', keywords: ['git', 'rebase'] }));
    await settle();
    expect(el.querySelectorAll('[data-testid="niches-table"] tbody tr').length).toBe(2);
  });

  it('edits an existing niche with PATCH', async () => {
    (el.querySelector('tr[data-niche="n1"] button') as HTMLButtonElement).click();
    await settle();
    expect((el.querySelector('[data-testid="niche-name"]') as HTMLInputElement).value).toBe('TypeScript tips');
    await type('[data-testid="niche-name"]', 'TS tips');
    await submit();
    const req = httpMock.expectOne('/api/niches/n1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.name).toBe('TS tips');
    expect(req.request.body.keywords).toEqual(['typescript', 'node.js']);
    req.flush(makeNiche({ name: 'TS tips' }));
    await settle();
    expect(el.querySelector('tr[data-niche="n1"]')?.textContent).toContain('TS tips');
  });
});
