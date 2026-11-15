import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  Injector,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import type {
  CreateProductionResponse,
  RenderSettings,
  ScriptDto,
  VoiceProfileDto,
} from '@vsf/contracts';
import { forkJoin } from 'rxjs';
import { ContentApiService } from '../../../core/api/content-api.service';
import { VideoApiService } from '../../../core/api/video-api.service';
import { apiErrorMessage, apiErrorMessages, httpStatus } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/http/notification.service';
import { RENDER_FPS, RENDER_SIZES, VOICE_QUALITY_LABELS, voiceWarning } from '../video-labels';

export const EXISTING_PRODUCTION_MESSAGE = 'Already exists, opened existing production.';
const FALLBACK_SETTINGS: Pick<RenderSettings, 'width' | 'height' | 'fps' | 'burnCaptions'> = {
  width: 1080,
  height: 1920,
  fps: 30,
  burnCaptions: true,
};

/**
 * Owner-only "start a render" form: approved script, voice (with quality warnings) and output settings.
 * On success it opens the production (new or the identical existing one).
 */
@Component({
  selector: 'app-start-render-form',
  imports: [ReactiveFormsModule, MatButtonModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      #panel
      class="render-form"
      role="region"
      aria-labelledby="start-render-heading"
      tabindex="-1"
      data-testid="start-render-form"
    >
      <h2 id="start-render-heading" class="section-title">Render a video</h2>
      @if (loading()) {
        <div class="state" role="status">
          <mat-spinner diameter="20" aria-label="Loading render options" />
          <span>Loading render options…</span>
        </div>
      } @else if (loadError(); as message) {
        <div class="state state-error" role="alert">
          <span>{{ message }}</span>
          <button mat-stroked-button type="button" (click)="loadOptions()">Retry</button>
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="render-script">Approved script</label>
            <select id="render-script" formControlName="scriptId" data-testid="render-script"
              [attr.aria-invalid]="showScriptError()" aria-describedby="render-script-error">
              <option value="">Select a script…</option>
              @for (s of scripts(); track s.id) {
                <option [value]="s.id">{{ s.title || 'Untitled script' }} (v{{ s.approvedVersion ?? s.currentVersion }})</option>
              }
            </select>
            <span id="render-script-error" class="error">
              @if (showScriptError()) {
                Select an approved script.
              }
            </span>
            @if (scripts().length === 0) {
              <span class="muted" data-testid="no-approved-scripts">No approved scripts yet. Approve a script first.</span>
            }
          </div>

          <fieldset class="field">
            <legend>Voice</legend>
            @if (voices().length === 0) {
              <span class="muted">No voice profiles configured; the server default is used.</span>
            }
            @for (v of voices(); track v.id) {
              <label class="voice" [class.disabled]="!v.available" [attr.data-voice]="v.id">
                <input type="radio" formControlName="voiceProfileId" [value]="v.id" [attr.disabled]="v.available ? null : ''"
                  [attr.aria-describedby]="'voice-note-' + v.id" />
                <span>{{ v.name }} · {{ v.provider }} · {{ v.language }}{{ v.isDefault ? ' · default' : '' }}</span>
                <span class="chip chip-{{ v.quality }}" data-testid="voice-quality">{{ qualityLabels[v.quality] }}</span>
                <span class="note" [id]="'voice-note-' + v.id">
                  @if (!v.available) {
                    <span class="muted">Unavailable on this server.</span>
                  }
                </span>
              </label>
            }
            @if (selectedWarning(); as w) {
              <p class="warning" role="note" data-testid="voice-warning">
                <span aria-hidden="true">! </span><strong>{{ selectedQualityLabel() }} voice:</strong> {{ w }}
              </p>
            }
          </fieldset>

          <fieldset class="field settings">
            <legend>Output settings (9:16)</legend>
            <label>
              <span>Size</span>
              <select formControlName="size" data-testid="render-size">
                @for (s of sizes; track s.label) {
                  <option [value]="s.width + 'x' + s.height">{{ s.label }}</option>
                }
              </select>
            </label>
            <label>
              <span>Frame rate</span>
              <select formControlName="fps" data-testid="render-fps">
                @for (f of fpsOptions; track f) {
                  <option [value]="f">{{ f }} fps</option>
                }
              </select>
            </label>
            <label class="inline">
              <input type="checkbox" formControlName="burnCaptions" data-testid="render-captions" />
              <span>Burn captions into the video</span>
            </label>
          </fieldset>

          @if (errors().length) {
            <div class="state-error" role="alert" data-testid="render-errors">
              <ul>
                @for (e of errors(); track $index) {
                  <li>{{ e }}</li>
                }
              </ul>
            </div>
          }
          <p role="status" class="result" data-testid="render-result">{{ result() }}</p>

          <div class="row">
            <button mat-flat-button type="submit" data-testid="render-submit" [disabled]="submitting()">
              {{ submitting() ? 'Queuing…' : 'Start render' }}
            </button>
            <button mat-button type="button" (click)="cancelled.emit()">Cancel</button>
          </div>
        </form>
      }
    </section>
  `,
  styles: `
    .render-form {
      margin: 16px 0;
      padding: 12px 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
    }
    form,
    .field {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    fieldset {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      margin: 0;
    }
    .settings {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 12px 24px;
    }
    .settings label {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    select {
      font: var(--mat-sys-body-medium);
      padding: 4px 6px;
      max-width: 100%;
    }
    .voice {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 8px;
    }
    .voice.disabled {
      opacity: 0.7;
    }
    .warning {
      margin: 0;
      padding: 8px 12px;
      border-left: 4px solid var(--app-status-warn);
      background: var(--mat-sys-surface-container);
    }
    .error,
    .state-error {
      color: var(--mat-sys-error);
    }
    .row {
      display: flex;
      gap: 8px;
    }
    .result:empty {
      display: none;
    }
  `,
})
export class StartRenderForm implements OnInit {
  private readonly content = inject(ContentApiService);
  private readonly video = inject(VideoApiService);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly injector = inject(Injector);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Preselected script (e.g. from the script workspace). */
  readonly scriptId = input<string | null>(null);
  readonly scriptTitle = input<string | null>(null);
  readonly cancelled = output<void>();
  readonly started = output<CreateProductionResponse>();

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly scripts = signal<ScriptDto[]>([]);
  protected readonly voices = signal<VoiceProfileDto[]>([]);
  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly errors = signal<string[]>([]);
  protected readonly result = signal('');
  private readonly selectedVoiceId = signal<string>('');

  protected readonly sizes = RENDER_SIZES;
  protected readonly fpsOptions = RENDER_FPS;
  protected readonly qualityLabels = VOICE_QUALITY_LABELS;

  protected readonly form = inject(NonNullableFormBuilder).group({
    scriptId: ['', Validators.required],
    voiceProfileId: [''],
    size: [`${FALLBACK_SETTINGS.width}x${FALLBACK_SETTINGS.height}`],
    fps: [String(FALLBACK_SETTINGS.fps)],
    burnCaptions: [FALLBACK_SETTINGS.burnCaptions],
  });

  private readonly selectedVoice = computed(() => this.voices().find((v) => v.id === this.selectedVoiceId()) ?? null);
  protected readonly selectedWarning = computed(() => {
    const v = this.selectedVoice();
    return v ? voiceWarning(v.quality) : null;
  });
  protected readonly selectedQualityLabel = computed(() => {
    const v = this.selectedVoice();
    return v ? VOICE_QUALITY_LABELS[v.quality] : '';
  });

  constructor() {
    this.form.controls.voiceProfileId.valueChanges.subscribe((id) => this.selectedVoiceId.set(id));
  }

  ngOnInit(): void {
    this.loadOptions();
  }

  protected loadOptions(): void {
    this.loading.set(true);
    this.loadError.set(null);
    forkJoin({
      scripts: this.content.listScripts({ status: 'approved', limit: 200, offset: 0 }),
      voices: this.video.voices(),
      status: this.video.status(),
    }).subscribe({
      next: ({ scripts, voices, status }) => {
        const list = [...scripts.items];
        const pre = this.scriptId();
        if (pre && !list.some((s) => s.id === pre)) {
          // Not in the first page of approved scripts: still offer it (the API re-validates approval).
          list.unshift({
            id: pre,
            ideaId: '',
            title: this.scriptTitle() ?? 'Selected script',
            status: 'approved',
            currentVersion: 0,
            approvedVersion: null,
            createdAt: '',
            updatedAt: '',
          });
        }
        this.scripts.set(list);
        this.voices.set(voices);
        const d = status.defaults;
        const voice = voices.find((v) => v.isDefault && v.available) ?? voices.find((v) => v.available);
        this.form.reset({
          scriptId: pre ?? '',
          voiceProfileId: voice?.id ?? '',
          size: `${d.width}x${d.height}`,
          fps: String(d.fps),
          burnCaptions: d.burnCaptions,
        });
        this.selectedVoiceId.set(voice?.id ?? '');
        this.loading.set(false);
        afterNextRender(() => this.panel()?.nativeElement.focus(), { injector: this.injector });
      },
      error: (err: unknown) => {
        this.loadError.set(apiErrorMessage(err, 'Could not load render options.'));
        this.loading.set(false);
      },
    });
  }

  protected showScriptError(): boolean {
    const c = this.form.controls.scriptId;
    return c.invalid && (c.touched || this.submitted());
  }

  protected submit(): void {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid || this.submitting()) {
      return;
    }
    const value = this.form.getRawValue();
    const [width, height] = value.size.split('x').map(Number);
    this.submitting.set(true);
    this.errors.set([]);
    this.result.set('');
    this.video
      .createProduction({
        scriptId: value.scriptId,
        ...(value.voiceProfileId ? { voiceProfileId: value.voiceProfileId } : {}),
        settings: {
          width,
          height,
          fps: Number(value.fps) as RenderSettings['fps'],
          burnCaptions: value.burnCaptions,
        },
      })
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          const message = res.created ? 'Render queued.' : EXISTING_PRODUCTION_MESSAGE;
          this.result.set(message);
          this.notify.success(message);
          this.started.emit(res);
          void this.router.navigate(['/video', res.production.id]);
        },
        error: (err: unknown) => {
          this.submitting.set(false);
          const status = httpStatus(err);
          const fallback =
            status === 409
              ? 'The script is not approved (or its approved version changed). Approve it before rendering.'
              : status === 400
                ? 'The render settings are invalid.'
                : 'Could not start the render.';
          const messages = apiErrorMessages(err, fallback);
          this.errors.set(status === 409 ? [`Cannot render: ${messages.join('; ')}`] : messages);
        },
      });
  }
}
