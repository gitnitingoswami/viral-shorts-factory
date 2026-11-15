import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { makeJob, makeTopic, signInAs } from '../../testing/fixtures';
import { JOB_POLL_INTERVAL_MS } from './content-labels';
import { GenerateIdeas } from './generate-ideas';

describe('GenerateIdeas', () => {
  let fixture: ComponentFixture<GenerateIdeas>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [GenerateIdeas],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    vi.useFakeTimers();
  });

  afterEach(() => {
    fixture?.destroy();
    httpMock.verify();
    vi.useRealTimers();
  });

  function create(status: 'approved' | 'new'): void {
    fixture = TestBed.createComponent(GenerateIdeas);
    fixture.componentRef.setInput('topic', makeTopic({ status }));
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  it('is hidden for reviewers and for topics that are not approved', () => {
    signInAs('reviewer');
    create('approved');
    expect(el.querySelector('[data-testid="generate-ideas-btn"]')).toBeNull();
  });

  it('is hidden for owners on unapproved topics', () => {
    signInAs('owner');
    create('new');
    expect(el.querySelector('[data-testid="generate-ideas-btn"]')).toBeNull();
  });

  it('starts the job, polls until completed, then links to the ideas', () => {
    signInAs('owner');
    create('approved');
    (el.querySelector('[data-testid="generate-ideas-btn"]') as HTMLButtonElement).click();
    const req = httpMock.expectOne('/api/research/topics/t1/ideas');
    expect(req.request.method).toBe('POST');
    expect(typeof req.request.body.idempotencyKey).toBe('string');
    req.flush(makeJob({ status: 'queued' }));
    fixture.detectChanges();
    expect((el.querySelector('[data-testid="generate-ideas-btn"]') as HTMLButtonElement).disabled).toBe(true);

    vi.advanceTimersByTime(JOB_POLL_INTERVAL_MS);
    httpMock.expectOne('/api/jobs/j1').flush(makeJob({ status: 'running', progress: 50 }));
    fixture.detectChanges();
    expect(el.textContent).toContain('Running (50%)');

    vi.advanceTimersByTime(JOB_POLL_INTERVAL_MS);
    httpMock.expectOne('/api/jobs/j1').flush(makeJob({ status: 'completed', progress: 100 }));
    fixture.detectChanges();
    const link = el.querySelector('[data-testid="ideas-link"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/content/ideas?topicId=t1');

    vi.advanceTimersByTime(JOB_POLL_INTERVAL_MS * 3);
    httpMock.expectNone('/api/jobs/j1');
  });

  it('shows the job error when generation fails', () => {
    signInAs('owner');
    create('approved');
    (el.querySelector('[data-testid="generate-ideas-btn"]') as HTMLButtonElement).click();
    httpMock.expectOne('/api/research/topics/t1/ideas').flush(makeJob({ status: 'running' }));
    vi.advanceTimersByTime(JOB_POLL_INTERVAL_MS);
    httpMock.expectOne('/api/jobs/j1').flush(makeJob({ status: 'failed', error: 'LLM timeout' }));
    fixture.detectChanges();
    expect(el.textContent).toContain('Idea generation failed: LLM timeout');
    expect((el.querySelector('[data-testid="generate-ideas-btn"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
