import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { VoiceProfileDto } from '@vsf/contracts';
import { NotificationService } from '../../../core/http/notification.service';
import {
  makeApprovedScript,
  makeProduction,
  makeRenderCapability,
  makeVoice,
} from '../../../testing/fixtures';
import { EXISTING_PRODUCTION_MESSAGE, StartRenderForm } from './start-render-form';

const VOICES: VoiceProfileDto[] = [
  makeVoice({ id: 'vo-mock', name: 'Mock tone', provider: 'mock', quality: 'mock', isDefault: false }),
  makeVoice(),
  makeVoice({ id: 'vo-off', name: 'Offline voice', quality: 'production', isDefault: false, available: false }),
];

describe('StartRenderForm', () => {
  let fixture: ComponentFixture<StartRenderForm>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;
  let navigate: ReturnType<typeof vi.spyOn>;

  const q = <T extends Element = HTMLElement>(sel: string): T | null => el.querySelector<T>(sel);
  const radio = (id: string): HTMLInputElement => q<HTMLInputElement>(`[data-voice="${id}"] input`) as HTMLInputElement;

  function create(preselect?: string): void {
    fixture = TestBed.createComponent(StartRenderForm);
    if (preselect) {
      fixture.componentRef.setInput('scriptId', preselect);
    }
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    const scripts = httpMock.expectOne((r) => r.url === '/api/content/scripts');
    expect(scripts.request.params.get('status')).toBe('approved');
    scripts.flush({ items: [makeApprovedScript(), makeApprovedScript({ id: 'sc2', title: 'Other' })], total: 2, limit: 200, offset: 0 });
    httpMock.expectOne('/api/video/voices').flush(VOICES);
    httpMock.expectOne('/api/video/status').flush(makeRenderCapability());
    fixture.detectChanges();
  }

  function submit(): void {
    (q('[data-testid="render-submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StartRenderForm],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    vi.spyOn(TestBed.inject(NotificationService), 'success').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fixture?.destroy();
    httpMock.verify();
  });

  it('selects the default voice, shows quality badges and disables unavailable voices', () => {
    create();
    expect(radio('vo1').checked).toBe(true);
    expect(radio('vo-off').disabled).toBe(true);
    expect(q('[data-voice="vo-off"]')?.textContent).toContain('Unavailable');
    expect(q('[data-voice="vo-mock"] [data-testid="voice-quality"]')?.textContent).toContain('Mock');
    expect(q('[data-testid="voice-warning"]')?.textContent).toContain('Robotic placeholder voice, replace before publishing');
  });

  it('shows the mock voice warning when a mock voice is chosen', () => {
    create();
    radio('vo-mock').click();
    fixture.detectChanges();
    expect(q('[data-testid="voice-warning"]')?.textContent).toContain('Test tone, not publishable');
  });

  it('requires a script before submitting', () => {
    create();
    submit();
    expect(el.textContent).toContain('Select an approved script.');
    httpMock.expectNone('/api/video/productions');
  });

  it('submits the chosen settings and opens the new production', () => {
    create('sc1');
    expect((q('[data-testid="render-script"]') as HTMLSelectElement).value).toBe('sc1');
    const size = q('[data-testid="render-size"]') as HTMLSelectElement;
    size.value = '720x1280';
    size.dispatchEvent(new Event('change'));
    const fps = q('[data-testid="render-fps"]') as HTMLSelectElement;
    fps.value = '60';
    fps.dispatchEvent(new Event('change'));
    (q('[data-testid="render-captions"]') as HTMLInputElement).click();
    submit();
    const req = httpMock.expectOne('/api/video/productions');
    expect(req.request.body).toEqual({
      scriptId: 'sc1',
      voiceProfileId: 'vo1',
      settings: { width: 720, height: 1280, fps: 60, burnCaptions: false },
    });
    req.flush({ production: makeProduction({ id: 'p9', status: 'queued' }), job: null, created: true });
    expect(navigate).toHaveBeenCalledWith(['/video', 'p9']);
  });

  it('reports an existing identical production (created: false)', () => {
    create('sc1');
    submit();
    httpMock
      .expectOne('/api/video/productions')
      .flush({ production: makeProduction({ id: 'p1' }), job: null, created: false });
    fixture.detectChanges();
    expect(q('[data-testid="render-result"]')?.textContent).toContain(EXISTING_PRODUCTION_MESSAGE);
    expect(TestBed.inject(NotificationService).success).toHaveBeenCalledWith(EXISTING_PRODUCTION_MESSAGE);
    expect(navigate).toHaveBeenCalledWith(['/video', 'p1']);
  });

  it('shows a 409 (script not approved) inline', () => {
    create('sc1');
    submit();
    httpMock
      .expectOne('/api/video/productions')
      .flush({ statusCode: 409, error: 'Conflict', message: 'Script is not approved' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    const errors = q('[data-testid="render-errors"]') as HTMLElement;
    expect(errors.getAttribute('role')).toBe('alert');
    expect(errors.textContent).toContain('Cannot render: Script is not approved');
    expect(navigate).not.toHaveBeenCalled();
  });
});
