import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { makeLlmStatus, makeScriptDetail } from '../../../testing/fixtures';
import { ScriptList } from './scripts';

describe('ScriptList', () => {
  let fixture: ComponentFixture<ScriptList>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ScriptList],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ScriptList);
    el = fixture.nativeElement as HTMLElement;
    await settle();
    httpMock.expectOne('/api/content/llm-status').flush(makeLlmStatus('mock'));
  });

  afterEach(() => {
    fixture.destroy();
    httpMock.verify();
  });

  it('lists scripts, shows the mock banner and filters by status', async () => {
    const first = httpMock.expectOne((r) => r.url === '/api/content/scripts');
    expect(first.request.params.toString()).toBe('limit=25&offset=0');
    first.flush({ items: [makeScriptDetail()], total: 1, limit: 25, offset: 0 });
    await settle();
    expect(el.querySelector('[data-testid="mock-banner"]')).not.toBeNull();
    const row = el.querySelector('[data-script="sc1"]') as HTMLElement;
    expect(row.textContent).toContain('In review');
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/content/scripts/sc1');

    const select = el.querySelector('[data-testid="script-status"]') as HTMLSelectElement;
    select.value = 'approved';
    select.dispatchEvent(new Event('change'));
    await settle();
    const filtered = httpMock.expectOne((r) => r.url === '/api/content/scripts');
    expect(filtered.request.params.get('status')).toBe('approved');
    filtered.flush({ items: [], total: 0, limit: 25, offset: 0 });
    await settle();
    expect(el.querySelector('[data-testid="scripts-empty"]')).not.toBeNull();
  });
});
