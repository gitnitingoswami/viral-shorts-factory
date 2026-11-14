import { Injectable, Injector, inject } from '@angular/core';
import type { MatSnackBarConfig } from '@angular/material/snack-bar';

/**
 * Snackbar notifications. MatSnackBar is loaded lazily so it stays out of the initial bundle.
 * MatSnackBar announces messages through the CDK LiveAnnouncer (aria-live).
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly injector = inject(Injector);

  error(message: string): void {
    void this.open(message, 'Dismiss', {
      duration: 8000,
      politeness: 'assertive',
      panelClass: 'app-snackbar-error',
    });
  }

  success(message: string): void {
    void this.open(message, 'OK', { duration: 4000, politeness: 'polite' });
  }

  private async open(message: string, action: string, config: MatSnackBarConfig): Promise<void> {
    const { MatSnackBar } = await import('@angular/material/snack-bar');
    this.injector.get(MatSnackBar).open(message, action, config);
  }
}
