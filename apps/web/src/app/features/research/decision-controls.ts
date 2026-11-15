import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { TopicDecisionRequest, TrendTopicDto } from '@vsf/contracts';

/** Approve/Reject buttons with an optional note. Emits the decision; the parent persists it. */
@Component({
  selector: 'app-decision-controls',
  imports: [MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let t = topic();
    <div class="controls" role="group" [attr.aria-label]="'Decision for ' + t.title">
      <button
        mat-stroked-button
        type="button"
        data-testid="approve"
        [disabled]="busy() || t.status === 'approved'"
        (click)="emit('approved')"
      >
        Approve
      </button>
      <button
        mat-stroked-button
        type="button"
        data-testid="reject"
        [disabled]="busy() || t.status === 'rejected'"
        (click)="emit('rejected')"
      >
        Reject
      </button>
      <button
        mat-button
        type="button"
        [attr.aria-expanded]="noteOpen()"
        [attr.aria-controls]="noteId()"
        (click)="noteOpen.set(!noteOpen())"
      >
        {{ noteOpen() ? 'Hide note' : 'Add note' }}
      </button>
    </div>
    @if (noteOpen()) {
      <label class="note">
        <span>Decision note (optional)</span>
        <input
          type="text"
          maxlength="500"
          data-testid="decision-note"
          [id]="noteId()"
          [value]="note()"
          (input)="onNote($event)"
        />
      </label>
    }
  `,
  styles: `
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .note {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: 4px;
      font: var(--mat-sys-body-small);
    }
    .note input {
      font: var(--mat-sys-body-medium);
      padding: 4px 6px;
    }
  `,
})
export class DecisionControls {
  readonly topic = input.required<TrendTopicDto>();
  readonly busy = input(false);
  readonly decide = output<TopicDecisionRequest>();

  protected readonly noteOpen = signal(false);
  protected readonly note = signal('');
  protected noteId(): string {
    return `decision-note-${this.topic().id}`;
  }

  protected onNote(event: Event): void {
    this.note.set((event.target as HTMLInputElement).value);
  }

  protected emit(decision: TopicDecisionRequest['decision']): void {
    const note = this.note().trim();
    this.decide.emit(note ? { decision, note } : { decision });
    this.note.set('');
    this.noteOpen.set(false);
  }
}
