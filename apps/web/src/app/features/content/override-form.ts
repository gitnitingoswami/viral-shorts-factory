import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MIN_OVERRIDE_REASON } from '../../core/api/content-api.service';

/** Requires at least {@link MIN_OVERRIDE_REASON} non-blank characters. */
export function overrideReasonValidator(control: AbstractControl<string>): ValidationErrors | null {
  return (control.value ?? '').trim().length >= MIN_OVERRIDE_REASON ? null : { tooShort: true };
}

/** Collapsible "Override" with a mandatory reason (≥ 10 non-blank chars). Emits the trimmed reason. */
@Component({
  selector: 'app-override-form',
  imports: [ReactiveFormsModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!open()) {
      <button mat-button type="button" data-testid="override-open" [disabled]="busy()" (click)="open.set(true)">
        Override…
      </button>
    } @else {
      <form class="override" [formGroup]="form" (ngSubmit)="submit()" [attr.aria-label]="'Override ' + subject()">
        <label [for]="fieldId()">Reason for overriding {{ subject() }} (at least {{ min }} characters)</label>
        <textarea
          rows="2"
          maxlength="1000"
          data-testid="override-reason"
          formControlName="reason"
          [id]="fieldId()"
          [attr.aria-invalid]="showError()"
          [attr.aria-describedby]="fieldId() + '-error'"
        ></textarea>
        <span class="error" [id]="fieldId() + '-error'" data-testid="override-error">
          @if (showError()) {
            Enter at least {{ min }} characters.
          }
        </span>
        @if (errorMessage(); as e) {
          <span class="error" role="alert">{{ e }}</span>
        }
        <div class="row">
          <button mat-stroked-button type="submit" data-testid="override-submit" [disabled]="busy()">
            Confirm override
          </button>
          <button mat-button type="button" (click)="close()">Cancel</button>
        </div>
      </form>
    }
  `,
  styles: `
    .override {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 6px;
      font: var(--mat-sys-body-small);
    }
    textarea {
      font: var(--mat-sys-body-medium);
      padding: 4px 6px;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .row {
      display: flex;
      gap: 4px;
    }
  `,
})
export class OverrideForm {
  readonly subject = input.required<string>();
  readonly fieldId = input.required<string>();
  readonly busy = input(false);
  readonly errorMessage = input<string | null>(null);
  readonly confirm = output<string>();

  protected readonly min = MIN_OVERRIDE_REASON;
  protected readonly open = signal(false);
  protected readonly submitted = signal(false);
  protected readonly form = inject(NonNullableFormBuilder).group({
    reason: ['', [Validators.required, overrideReasonValidator]],
  });

  protected showError(): boolean {
    const c = this.form.controls.reason;
    return c.invalid && (c.touched || this.submitted());
  }

  protected submit(): void {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) {
      return;
    }
    this.confirm.emit(this.form.controls.reason.value.trim());
  }

  /** Called by the parent after a successful override. */
  close(): void {
    this.open.set(false);
    this.submitted.set(false);
    this.form.reset();
  }
}
