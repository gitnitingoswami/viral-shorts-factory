import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { makeVersion } from '../../../testing/fixtures';
import { ScriptEditor } from './script-editor';

const VERSIONS = '/api/content/scripts/sc1/versions';

describe('ScriptEditor', () => {
  let fixture: ComponentFixture<ScriptEditor>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;

  const q = <T extends Element = HTMLElement>(sel: string): T => el.querySelector<T>(sel) as T;
  const all = (sel: string): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>(sel));
  const set = (target: Element, value: string): void => {
    const input = target as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const save = (): void => {
    q<HTMLButtonElement>('[data-testid="save-version"]').click();
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ScriptEditor],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ScriptEditor);
    fixture.componentRef.setInput('base', makeVersion());
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('prefills title and scenes from the base version', () => {
    expect(q<HTMLInputElement>('[data-testid="edit-title"]').value).toBe('Lock down fs access');
    expect(all('[data-edit-scene]').length).toBe(2);
    expect(q<HTMLSelectElement>('[data-edit-scene="1"] [data-testid="edit-language"]').value).toBe('shell');
    expect(q<HTMLInputElement>('[data-edit-scene="1"] [data-testid="edit-highlight"]').value).toBe('1');
  });

  it('validates narration, duration range, code length and highlight lines', () => {
    set(q('[data-edit-scene="0"] [data-testid="edit-narration"]'), '   ');
    set(q('[data-edit-scene="0"] [data-testid="edit-duration"]'), '31');
    set(q('[data-edit-scene="1"] [data-testid="edit-source"]'), Array.from({ length: 13 }, (_, i) => `l${i}`).join('\n'));
    set(q('[data-edit-scene="1"] [data-testid="edit-highlight"]'), '1-2');
    save();
    httpMock.expectNone(VERSIONS);
    expect(q('[data-testid="form-invalid"]')).not.toBeNull();
    expect(q('[data-testid="narration-error"]')).not.toBeNull();
    expect(q('[data-testid="duration-error"]')?.textContent).toContain('1–30');
    expect(q('[data-testid="lines-error"]')?.textContent).toContain('at most 12 lines');
    expect(el.textContent).toContain('Use positive line numbers');

    set(q('[data-edit-scene="0"] [data-testid="edit-duration"]'), '0');
    expect(q('[data-testid="duration-error"]')).not.toBeNull();
  });

  it('adds, reorders and removes scenes, then posts the new version with baseVersion', () => {
    q<HTMLButtonElement>('[data-testid="add-scene"]').click();
    fixture.detectChanges();
    expect(all('[data-edit-scene]').length).toBe(3);
    set(q('[data-edit-scene="2"] [data-testid="edit-narration"]'), 'Recap: one flag.');
    // Move the new scene up, then remove the original first scene.
    (q('[data-edit-scene="2"]').querySelector('button[aria-label="Move scene 3 up"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    q<HTMLButtonElement>('[data-edit-scene="0"] [data-testid="remove-scene"]').click();
    fixture.detectChanges();
    set(q('[data-edit-scene="1"] [data-testid="edit-highlight"]'), '2, 1');
    save();

    const req = httpMock.expectOne(VERSIONS);
    expect(req.request.method).toBe('POST');
    const body = req.request.body;
    expect(body.baseVersion).toBe(2);
    expect(body.scenes.map((s: { narration: string }) => s.narration)).toEqual([
      'Recap: one flag.',
      'Run node with the permission flag.',
    ]);
    expect(body.scenes[0].code).toBeNull();
    expect(body.scenes[1].code).toEqual({
      language: 'shell',
      source: 'node --permission app.js\necho done',
      highlightLines: [1, 2],
    });
    expect('index' in body.scenes[0]).toBe(false);
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);
    req.flush(makeVersion({ version: 3 }));
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));
  });

  it('offers a reload when the base version is stale (409)', () => {
    const reload = vi.fn();
    fixture.componentInstance.reloadRequested.subscribe(reload);
    save();
    httpMock
      .expectOne(VERSIONS)
      .flush({ statusCode: 409, error: 'Conflict', message: 'baseVersion 2 is stale' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(q('[data-testid="stale-alert"]')?.getAttribute('role')).toBe('alert');
    q<HTMLButtonElement>('[data-testid="reload-latest"]').click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows other save errors inline', () => {
    save();
    httpMock
      .expectOne(VERSIONS)
      .flush({ statusCode: 400, error: 'Bad Request', message: 'scenes must not be empty' }, { status: 400, statusText: 'Bad' });
    fixture.detectChanges();
    expect(q('[data-testid="save-error"]')?.textContent).toContain('scenes must not be empty');
    expect(q('[data-testid="stale-alert"]')).toBeNull();
  });
});
