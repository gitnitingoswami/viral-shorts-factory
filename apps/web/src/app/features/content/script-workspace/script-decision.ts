import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { ScriptDecisionRequest, ScriptDto } from '@vsf/contracts';
import { ContentApiService } from '../../../core/api/content-api.service';
import { apiErrorMessages, httpStatus } from '../../../core/http/api-error';

type Decision = ScriptDecisionRequest['decision'];

/**
 * Approve / Request changes / Reject for the current version. Approve is disabled while the version has
 * approval blockers (listed in the tooltip and via aria-describedby). Server 409s show the blocker list.
 */
@Component({
  selector: 'app-script-decision',
  imports: [MatButtonModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="controls" role="group" aria-label="Script decision">
      <span
        class="tip"
        data-testid="approve-wrapper"
        [matTooltip]="approveTooltip()"
        [matTooltipDisabled]="!approveTooltip()"
        [attr.tabindex]="blockers().length ? 0 : null"
      >
        <button
          mat-flat-button
          type="button"
          data-testid="approve-script"
          [disabled]="busy() || blockers().length > 0"
          [attr.aria-describedby]="blockers().length ? blockersId() : null"
          (click)="decide('approved')"
        >
          Approve v{{ version() }}
        </button>
      </span>
      <button
        mat-stroked-button
        type="button"
        data-testid="request-changes"
        [disabled]="busy()"
        (click)="decide('changes_requested')"
      >
        Request changes
      </button>
      <button mat-stroked-button type="button" data-testid="reject-script" [disabled]="busy()" (click)="decide('rejected')">
        Reject
      </button>
    </div>
    <label class="note">
      <span>Decision note (required for Request changes and Reject)</span>
      <textarea
        rows="2"
        maxlength="1000"
        data-testid="script-decision-note"
        [value]="note()"
        [attr.aria-invalid]="noteError() ? true : null"
        (input)="onNote($event)"
      ></textarea>
    </label>
    @if (noteError(); as e) {
      <p class="error" role="alert" data-testid="note-error">{{ e }}</p>
    }
    @if (serverErrors().length) {
      <div class="error" role="alert" data-testid="decision-errors">
        <p>{{ conflict() ? 'Approval was blocked by the server:' : 'The decision failed:' }}</p>
        <ul>
          @for (m of serverErrors(); track $index) {
            <li>{{ m }}</li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .tip {
      display: inline-block;
    }
    .note {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: 8px;
      font: var(--mat-sys-body-small);
    }
    textarea {
      font: var(--mat-sys-body-medium);
      padding: 4px 6px;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .error ul {
      margin: 4px 0;
      padding-left: 20px;
    }
  `,
})
export class ScriptDecision {
  private readonly api = inject(ContentApiService);

  readonly scriptId = input.required<string>();
  readonly version = input.required<number>();
  readonly blockers = input<string[]>([]);
  /** Id of the element listing blockers (for aria-describedby). */
  readonly blockersId = input('approval-blockers');
  readonly decided = output<ScriptDto>();

  protected readonly busy = signal(false);
  protected readonly note = signal('');
  protected readonly noteError = signal<string | null>(null);
  protected readonly serverErrors = signal<string[]>([]);
  protected readonly conflict = signal(false);
  protected readonly approveTooltip = computed(() =>
    this.blockers().length ? `Approval blocked: ${this.blockers().join('; ')}` : '',
  );

  protected onNote(event: Event): void {
    this.note.set((event.target as HTMLTextAreaElement).value);
    this.noteError.set(null);
  }

  protected decide(decision: Decision): void {
    if (this.busy() || (decision === 'approved' && this.blockers().length > 0)) {
      return;
    }
    const note = this.note().trim();
    if (decision !== 'approved' && !note) {
      this.noteError.set('Add a note explaining what needs to change.');
      return;
    }
    const body: ScriptDecisionRequest = { version: this.version(), decision, ...(note ? { note } : {}) };
    this.busy.set(true);
    this.noteError.set(null);
    this.serverErrors.set([]);
    this.api.decide(this.scriptId(), body).subscribe({
      next: (script) => {
        this.busy.set(false);
        this.note.set('');
        this.decided.emit(script);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.conflict.set(httpStatus(err) === 409);
        this.serverErrors.set(apiErrorMessages(err, 'Could not record the decision.'));
      },
    });
  }
}
