import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import type {
  CodeLanguage,
  CreateScriptVersionRequest,
  ScriptVersionDto,
  StoryboardSceneDto,
} from '@vsf/contracts';
import { ContentApiService } from '../../../core/api/content-api.service';
import { apiErrorMessage, httpStatus } from '../../../core/http/api-error';
import { MAX_CODE_LINES, MAX_SCENE_SEC, MIN_SCENE_SEC, lineCount, parseHighlightLines } from '../content-labels';

type Transition = StoryboardSceneDto['transition'];

export const CODE_LANGUAGES: readonly CodeLanguage[] = ['javascript', 'typescript', 'shell', 'sql', 'other'];
export const TRANSITIONS: readonly Transition[] = ['cut', 'fade', 'slide', 'zoom'];

export type SceneForm = FormGroup<{
  durationSec: FormControl<number>;
  narration: FormControl<string>;
  onScreenText: FormControl<string>;
  visualConcept: FormControl<string>;
  transition: FormControl<Transition>;
  assetBrief: FormControl<string>;
  hasCode: FormControl<boolean>;
  language: FormControl<CodeLanguage>;
  source: FormControl<string>;
  highlightLines: FormControl<string>;
}>;

const notBlank = (c: AbstractControl<string>): ValidationErrors | null =>
  (c.value ?? '').trim() ? null : { required: true };

/** Scene-level code rules: source required, ≤ 12 lines, highlight lines a comma list within range. */
export function sceneCodeValidator(group: AbstractControl): ValidationErrors | null {
  const v = (group as SceneForm).getRawValue();
  if (!v.hasCode) {
    return null;
  }
  const errors: ValidationErrors = {};
  const lines = lineCount(v.source);
  if (!v.source.trim()) {
    errors['codeRequired'] = true;
  } else if (lines > MAX_CODE_LINES) {
    errors['tooManyLines'] = { max: MAX_CODE_LINES, actual: lines };
  }
  const hl = parseHighlightLines(v.highlightLines);
  if (hl === null) {
    errors['highlightFormat'] = true;
  } else if (hl.some((n) => n > lines)) {
    errors['highlightRange'] = true;
  }
  return Object.keys(errors).length ? errors : null;
}

/**
 * Edits the given version's title and scenes and saves them as a new version (`baseVersion` = that version).
 * A 409 means someone saved a newer version first; the user is offered a reload.
 */
@Component({
  selector: 'app-script-editor',
  imports: [ReactiveFormsModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './script-editor.html',
  styleUrl: './script-editor.scss',
})
export class ScriptEditor implements OnInit {
  private readonly api = inject(ContentApiService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly base = input.required<ScriptVersionDto>();
  readonly saved = output<ScriptVersionDto>();
  readonly cancelled = output<void>();
  readonly reloadRequested = output<void>();

  protected readonly form = this.fb.group({
    title: ['', [notBlank, Validators.maxLength(200)]],
    scenes: this.fb.array<SceneForm>([], [Validators.required]),
  });
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly stale = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly baseVersion = computed(() => this.base().version);

  protected readonly languages = CODE_LANGUAGES;
  protected readonly transitions = TRANSITIONS;
  protected readonly maxLines = MAX_CODE_LINES;
  protected readonly minSec = MIN_SCENE_SEC;
  protected readonly maxSec = MAX_SCENE_SEC;

  get scenes(): FormArray<SceneForm> {
    return this.form.controls.scenes;
  }

  ngOnInit(): void {
    const v = this.base();
    this.form.controls.title.setValue(v.title);
    [...v.scenes].sort((a, b) => a.index - b.index).forEach((s) => this.scenes.push(this.sceneGroup(s)));
  }

  protected sceneGroup(s?: StoryboardSceneDto): SceneForm {
    return this.fb.group(
      {
        durationSec: [
          s?.durationSec ?? 5,
          [Validators.required, Validators.min(MIN_SCENE_SEC), Validators.max(MAX_SCENE_SEC)],
        ],
        narration: [s?.narration ?? '', [notBlank, Validators.maxLength(1000)]],
        onScreenText: [s?.onScreenText ?? '', [Validators.maxLength(200)]],
        visualConcept: [s?.visualConcept ?? '', [Validators.maxLength(500)]],
        transition: [s?.transition ?? ('cut' as Transition)],
        assetBrief: [s?.assetBrief ?? '', [Validators.maxLength(500)]],
        hasCode: [s?.code != null],
        language: [s?.code?.language ?? ('typescript' as CodeLanguage)],
        source: [s?.code?.source ?? ''],
        highlightLines: [s?.code?.highlightLines.join(', ') ?? ''],
      },
      { validators: sceneCodeValidator },
    );
  }

  protected addScene(): void {
    this.scenes.push(this.sceneGroup());
  }

  protected removeScene(i: number): void {
    if (this.scenes.length > 1) {
      this.scenes.removeAt(i);
    }
  }

  protected move(i: number, delta: -1 | 1): void {
    const j = i + delta;
    if (j < 0 || j >= this.scenes.length) {
      return;
    }
    const ctrl = this.scenes.at(i);
    this.scenes.removeAt(i);
    this.scenes.insert(j, ctrl);
  }

  /** True when the control has the error and should display it. */
  protected show(ctrl: AbstractControl, error: string): boolean {
    return ctrl.hasError(error) && (ctrl.touched || this.submitted());
  }

  protected lines(scene: SceneForm): number {
    return lineCount(scene.controls.source.value);
  }

  protected totalSec(): number {
    return this.scenes.controls.reduce((sum, s) => sum + (Number(s.controls.durationSec.value) || 0), 0);
  }

  protected submit(): void {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    this.stale.set(false);
    this.api.createVersion(this.base().scriptId, this.toRequest()).subscribe({
      next: (version) => {
        this.saving.set(false);
        this.saved.emit(version);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        if (httpStatus(err) === 409) {
          this.stale.set(true);
        } else {
          this.saveError.set(apiErrorMessage(err, 'Could not save the new version.'));
        }
      },
    });
  }

  toRequest(): CreateScriptVersionRequest {
    const v = this.form.getRawValue();
    return {
      baseVersion: this.baseVersion(),
      title: v.title.trim(),
      scenes: v.scenes.map((s) => ({
        durationSec: Number(s.durationSec),
        narration: s.narration.trim(),
        onScreenText: s.onScreenText.trim(),
        visualConcept: s.visualConcept.trim(),
        transition: s.transition,
        assetBrief: s.assetBrief.trim(),
        code: s.hasCode
          ? {
              language: s.language,
              source: s.source.replace(/\s+$/, ''),
              highlightLines: parseHighlightLines(s.highlightLines) ?? [],
            }
          : null,
      })),
    };
  }
}
