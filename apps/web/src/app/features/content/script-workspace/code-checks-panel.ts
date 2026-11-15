import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import type { CodeVerificationDto } from '@vsf/contracts';
import { ContentApiService } from '../../../core/api/content-api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import { CODE_STATUS_LABELS, canOverrideCodeCheck } from '../content-labels';
import { OverrideForm } from '../override-form';

/** Sandbox results per code scene; owners can override failed/unavailable checks. */
@Component({
  selector: 'app-code-checks-panel',
  imports: [OverrideForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (checks().length === 0) {
      <p class="muted">No code in this version.</p>
    } @else {
      <ul class="checks" data-testid="code-checks">
        @for (c of checks(); track c.id) {
          <li [attr.data-check]="c.id">
            <div class="row">
              <span class="chip chip-{{ c.status }}" data-testid="code-status">{{ labels[c.status] }}</span>
              <span>Scene {{ c.sceneIndex + 1 }} · {{ c.language }}</span>
              @if (c.durationMs !== null) {
                <span class="muted">{{ c.durationMs }} ms</span>
              }
            </div>
            @if (c.status === 'not_executable') {
              <p class="muted small">This language is not executed; shown for reference and does not block approval.</p>
            }
            @if (c.stdout) {
              <span class="small">stdout</span>
              <pre data-testid="stdout">{{ c.stdout }}</pre>
            }
            @if (c.stderr) {
              <span class="small">stderr</span>
              <pre class="stderr" data-testid="stderr">{{ c.stderr }}</pre>
            }
            @if (c.overrideReason) {
              <p class="muted small">Override reason: {{ c.overrideReason }}</p>
            }
            @if (isOwner() && canOverride(c.status)) {
              <app-override-form
                [subject]="'code check for scene ' + (c.sceneIndex + 1)"
                [fieldId]="'code-override-' + c.id"
                [busy]="busyId() === c.id"
                [errorMessage]="errors()[c.id] ?? null"
                (confirm)="override(c, $event)"
              />
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .checks {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      padding: 10px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      min-width: 0;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    pre {
      margin: 2px 0 6px;
      padding: 6px 8px;
      max-height: 200px;
      overflow: auto;
      border-radius: 6px;
      background: var(--mat-sys-surface-container-highest);
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .stderr {
      color: var(--mat-sys-error);
    }
    .small {
      font: var(--mat-sys-body-small);
    }
  `,
})
export class CodeChecksPanel {
  private readonly api = inject(ContentApiService);

  readonly checks = input.required<CodeVerificationDto[]>();
  readonly overridden = output<CodeVerificationDto>();

  protected readonly isOwner = inject(AuthService).isOwner;
  protected readonly busyId = signal<string | null>(null);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly labels = CODE_STATUS_LABELS;
  protected readonly canOverride = canOverrideCodeCheck;

  protected override(check: CodeVerificationDto, reason: string): void {
    if (this.busyId()) {
      return;
    }
    this.busyId.set(check.id);
    this.errors.update(({ [check.id]: _removed, ...rest }) => rest);
    this.api.overrideCodeCheck(check.id, reason).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.overridden.emit(updated);
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.errors.update((e) => ({ ...e, [check.id]: apiErrorMessage(err, 'Override failed.') }));
      },
    });
  }
}
