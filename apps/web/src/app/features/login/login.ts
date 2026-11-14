import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { safeReturnUrl } from '../../core/auth/auth.guard';
import { AuthService } from '../../core/auth/auth.service';
import { apiErrorMessage } from '../../core/http/api-error';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Bound from the `returnUrl` query param via component input binding. */
  readonly returnUrl = input<string | undefined>();

  protected readonly pending = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ['', [Validators.required, Validators.maxLength(1024)]],
  });

  protected submit(): void {
    if (this.pending()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { email, password } = this.form.getRawValue();
    this.pending.set(true);
    this.errorMessage.set(null);
    this.auth.login(email.trim(), password).subscribe({
      next: () => {
        this.pending.set(false);
        void this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
      },
      error: (err: unknown) => {
        this.pending.set(false);
        this.form.controls.password.reset();
        this.errorMessage.set(apiErrorMessage(err, 'Sign-in failed. Please try again.'));
      },
    });
  }
}
