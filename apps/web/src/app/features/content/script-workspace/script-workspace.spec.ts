import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ScriptDetailDto, ScriptVersionDto, UserRole } from '@vsf/contracts';
import {
  makeJob,
  makeLlmStatus,
  makeScriptDetail,
  makeVersion,
  signInAs,
} from '../../../testing/fixtures';
import { CHECKS_POLL_INTERVAL_MS, JOB_POLL_INTERVAL_MS } from '../content-labels';
import { ScriptWorkspace } from './script-workspace';

const SCRIPT = '/api/content/scripts/sc1';
const V2 = `${SCRIPT}/versions/2`;

describe('ScriptWorkspace', () => {
  let fixture: ComponentFixture<ScriptWorkspace>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;

  const isPolling = (): boolean =>
    (fixture.componentInstance as unknown as { pollingChecks: boolean }).pollingChecks;
  const q = <T extends Element = HTMLElement>(sel: string): T | null => el.querySelector<T>(sel);
  const click = (sel: string): void => {
    (q(sel) as HTMLElement).click();
    fixture.detectChanges();
  };
  const type = (target: Element | null, value: string): void => {
    const input = target as HTMLInputElement | HTMLTextAreaElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  function create(
    role: UserRole,
    version: ScriptVersionDto = makeVersion(),
    script: ScriptDetailDto = makeScriptDetail(),
    job?: string,
  ): void {
    signInAs(role);
    fixture = TestBed.createComponent(ScriptWorkspace);
    fixture.componentRef.setInput('id', 'sc1');
    if (job) {
      fixture.componentRef.setInput('job', job);
    }
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    httpMock.expectOne('/api/content/llm-status').flush(makeLlmStatus());
    httpMock.expectOne(SCRIPT).flush(script);
    if (script.versions.length) {
      httpMock.expectOne(`${SCRIPT}/versions/${script.currentVersion}`).flush(version);
    }
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ScriptWorkspace],
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

  it('renders the storyboard, code as text, stats and the AI review', () => {
    const base = makeVersion();
    create(
      'reviewer',
      makeVersion({
        estDurationSec: 75,
        scenes: [
          base.scenes[0],
          { ...base.scenes[1], code: { language: 'javascript', source: '<script>alert(1)</script>', highlightLines: [1] } },
        ],
      }),
    );
    const board = q('[data-testid="storyboard"]') as HTMLElement;
    expect(board.querySelectorAll('[data-scene]').length).toBe(2);
    expect(board.textContent).toContain('Your script can read your SSH keys.');
    expect(board.querySelector('script')).toBeNull();
    expect(q('[data-testid="code-block"]')?.textContent).toContain('<script>alert(1)</script>');
    expect(q('[data-testid="word-count"]')?.textContent).toContain('80 words');
    expect(q('[data-testid="duration-warning"]')?.textContent).toContain('exceeds the 60 s maximum');
    expect(q('[data-testid="quality-scores"]')?.textContent).toContain('Pacing');
    expect(q('[data-testid="quality-issues"]')?.textContent).toContain('Pacing dips in scene 2');
    expect(q('[data-testid="no-blockers"]')).not.toBeNull();
    expect(q('[data-testid="claim-source"]')?.getAttribute('rel')).toBe('noopener noreferrer');
    // Reviewers cannot override or re-run checks.
    expect(q('[data-testid="override-open"]')).toBeNull();
    expect(q('[data-testid="rerun-checks"]')).toBeNull();
  });

  it('lists blockers prominently and disables Approve with a tooltip', () => {
    create('reviewer', makeVersion({ approvalBlockers: ['Claim in scene 2 is unsupported', 'Quality check pending'] }));
    expect(q('[data-testid="blockers"]')?.textContent).toContain('Claim in scene 2 is unsupported');
    const approve = q<HTMLButtonElement>('[data-testid="approve-script"]') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(approve.getAttribute('aria-describedby')).toBe('approval-blockers');
    expect(q('#approval-blockers')).not.toBeNull();
    const wrapper = q('[data-testid="approve-wrapper"]') as HTMLElement;
    expect(wrapper.getAttribute('tabindex')).toBe('0');
    expect(wrapper.classList.contains('mat-mdc-tooltip-trigger')).toBe(true);
  });

  it('shows server blocker messages on a 409 approval', () => {
    create('reviewer');
    click('[data-testid="approve-script"]');
    const req = httpMock.expectOne(`${SCRIPT}/decision`);
    expect(req.request.body).toEqual({ version: 2, decision: 'approved' });
    req.flush(
      { statusCode: 409, error: 'Conflict', message: ['Claim cl1 is unsupported', 'Code check cc1 failed'] },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    const errors = q('[data-testid="decision-errors"]') as HTMLElement;
    expect(errors.getAttribute('role')).toBe('alert');
    expect(errors.querySelectorAll('li').length).toBe(2);
    expect(errors.textContent).toContain('Code check cc1 failed');
  });

  it('requires a note to request changes, then records the decision', () => {
    create('reviewer');
    click('[data-testid="request-changes"]');
    expect(q('[data-testid="note-error"]')).not.toBeNull();
    httpMock.expectNone(`${SCRIPT}/decision`);
    type(q('[data-testid="script-decision-note"]'), 'Tighten scene 2');
    click('[data-testid="request-changes"]');
    const req = httpMock.expectOne(`${SCRIPT}/decision`);
    expect(req.request.body).toEqual({ version: 2, decision: 'changes_requested', note: 'Tighten scene 2' });
    req.flush({ ...makeScriptDetail(), status: 'drafting' });
    httpMock.expectOne(V2).flush(makeVersion());
    fixture.detectChanges();
    expect(q('[data-testid="script-status"]')?.textContent).toContain('Drafting');
  });

  it('polls while checks are pending/running and stops when done', () => {
    create('owner', makeVersion({ checks: { factCheck: 'running', quality: 'pending', code: 'done' } }));
    expect(isPolling()).toBe(true);
    vi.advanceTimersByTime(CHECKS_POLL_INTERVAL_MS);
    httpMock.expectOne(V2).flush(makeVersion({ checks: { factCheck: 'done', quality: 'running', code: 'done' } }));
    fixture.detectChanges();
    expect(q('[data-check-state="quality"]')?.textContent).toBe('running');
    expect(isPolling()).toBe(true);

    vi.advanceTimersByTime(CHECKS_POLL_INTERVAL_MS);
    httpMock.expectOne(V2).flush(makeVersion());
    fixture.detectChanges();
    expect(isPolling()).toBe(false);
    expect(q('[data-check-state="quality"]')?.textContent).toBe('done');
    vi.advanceTimersByTime(CHECKS_POLL_INTERVAL_MS * 3);
    httpMock.expectNone(V2);
  });

  it('does not poll when all checks are done', () => {
    create('owner');
    expect(isPolling()).toBe(false);
    vi.advanceTimersByTime(CHECKS_POLL_INTERVAL_MS * 2);
    httpMock.expectNone(V2);
  });

  it('owner re-runs checks and polling resumes', () => {
    create('owner');
    click('[data-testid="rerun-checks"]');
    const req = httpMock.expectOne(`${V2}/checks`);
    expect(req.request.method).toBe('POST');
    req.flush(makeJob({ id: 'j5' }));
    fixture.detectChanges();
    expect(isPolling()).toBe(true);
    expect(q('[data-check-state="factCheck"]')?.textContent).toBe('pending');
    vi.advanceTimersByTime(CHECKS_POLL_INTERVAL_MS);
    httpMock.expectOne(V2).flush(makeVersion());
    expect(isPolling()).toBe(false);
  });

  it('claim override requires a reason of at least 10 characters', () => {
    create('owner');
    click('[data-claim="cl1"] [data-testid="override-open"]');
    type(q('[data-testid="override-reason"]'), '  too short ');
    click('[data-testid="override-submit"]');
    expect(q('[data-testid="override-error"]')?.textContent).toContain('at least 10 characters');
    httpMock.expectNone('/api/content/claims/cl1/override');

    type(q('[data-testid="override-reason"]'), 'Confirmed in Node 24 changelog');
    click('[data-testid="override-submit"]');
    const req = httpMock.expectOne('/api/content/claims/cl1/override');
    expect(req.request.body).toEqual({ reason: 'Confirmed in Node 24 changelog' });
    req.flush({ ...makeVersion().claims[0], verdict: 'overridden', overrideReason: 'Confirmed in Node 24 changelog' });
    httpMock.expectOne(V2).flush(makeVersion());
    fixture.detectChanges();
  });

  it('code check override is offered to owners for failed/unavailable checks with stderr in a pre', () => {
    const v = makeVersion();
    create(
      'owner',
      makeVersion({ codeChecks: [{ ...v.codeChecks[0], status: 'failed', stderr: 'SyntaxError: <b>x</b>' }] }),
    );
    const check = q('[data-check="cc1"]') as HTMLElement;
    expect(check.querySelector('[data-testid="stderr"]')?.textContent).toBe('SyntaxError: <b>x</b>');
    expect(check.querySelector('b')).toBeNull();
    (check.querySelector('[data-testid="override-open"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    type(check.querySelector('[data-testid="override-reason"]'), 'Ran locally on Node 24, works');
    (check.querySelector('[data-testid="override-submit"]') as HTMLButtonElement).click();
    const req = httpMock.expectOne('/api/content/code-checks/cc1/override');
    expect(req.request.body).toEqual({ reason: 'Ran locally on Node 24, works' });
    req.flush({ ...v.codeChecks[0], status: 'overridden' });
    httpMock.expectOne(V2).flush(makeVersion());
  });

  it('switches versions; older versions hide decision and edit controls', () => {
    create('reviewer');
    expect((q('[data-testid="version-picker"]') as HTMLSelectElement).value).toBe('2');
    const picker = q('[data-testid="version-picker"]') as HTMLSelectElement;
    picker.value = '1';
    picker.dispatchEvent(new Event('change'));
    httpMock.expectOne(`${SCRIPT}/versions/1`).flush(makeVersion({ id: 'v1', version: 1, authorType: 'ai' }));
    fixture.detectChanges();
    expect(q('[data-testid="old-version"]')).not.toBeNull();
    expect(q('[data-testid="approve-script"]')).toBeNull();
    expect(q('[data-testid="edit-script"]')).toBeNull();
  });

  it('tracks the generation job after selecting an idea and loads the draft when done', () => {
    create('owner', makeVersion(), makeScriptDetail({ currentVersion: 0, versions: [], status: 'drafting' }), 'j9');
    httpMock.expectOne('/api/jobs/j9').flush(makeJob({ id: 'j9', status: 'running', progress: 20 }));
    fixture.detectChanges();
    expect(q('[data-testid="generation-status"]')?.textContent).toContain('Drafting script');
    expect(q('[data-testid="no-versions"]')).not.toBeNull();

    vi.advanceTimersByTime(JOB_POLL_INTERVAL_MS);
    httpMock.expectOne('/api/jobs/j9').flush(makeJob({ id: 'j9', status: 'completed', progress: 100 }));
    httpMock.expectOne(SCRIPT).flush(makeScriptDetail({ currentVersion: 1, versions: [makeScriptDetail().versions[0]] }));
    httpMock.expectOne(`${SCRIPT}/versions/1`).flush(makeVersion({ version: 1 }));
    fixture.detectChanges();
    expect(q('[data-testid="generation-status"]')).toBeNull();
    expect(q('[data-testid="storyboard"]')).not.toBeNull();
    vi.advanceTimersByTime(JOB_POLL_INTERVAL_MS * 2);
    httpMock.expectNone('/api/jobs/j9');
  });

  it('opens the editor and applies a saved version', () => {
    create('reviewer');
    click('[data-testid="edit-script"]');
    expect(q('[data-testid="script-editor"]')).not.toBeNull();
    type(q('[data-testid="edit-title"]'), 'New title');
    click('[data-testid="save-version"]');
    const req = httpMock.expectOne(`${SCRIPT}/versions`);
    expect(req.request.body.baseVersion).toBe(2);
    req.flush(makeVersion({ id: 'v3', version: 3, title: 'New title' }));
    fixture.detectChanges();
    expect(q('[data-testid="script-editor"]')).toBeNull();
    expect(q('h1')?.textContent).toContain('New title');
    expect((q('[data-testid="version-picker"]') as HTMLSelectElement).options.length).toBe(3);
  });
});
