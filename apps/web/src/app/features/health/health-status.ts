import { DatePipe, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { DependencyCheck, DependencyName, ReadinessResponse } from '@vsf/contracts';
import { Subscription } from 'rxjs';
import { HealthApiService } from '../../core/api/health-api.service';
import { apiErrorMessage } from '../../core/http/api-error';

export const HEALTH_REFRESH_INTERVAL_MS = 15_000;

const DEPENDENCY_LABELS: Record<DependencyName, string> = {
  database: 'Database',
  redis: 'Redis',
  storage: 'Object storage',
};

interface DependencyRow {
  name: string;
  label: string;
  check: DependencyCheck;
}

/**
 * Readiness view: overall status plus each dependency. Auto-refreshes every 15 s while the
 * document is visible and refreshes immediately when the tab becomes visible again.
 */
@Component({
  selector: 'app-health-status',
  imports: [DatePipe, MatButtonModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './health-status.html',
  styleUrl: './health-status.scss',
})
export class HealthStatus implements OnInit {
  private readonly api = inject(HealthApiService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private inFlight: Subscription | null = null;

  /** Compact summary (dashboard) instead of the full detail table. */
  readonly compact = input(false);

  protected readonly readiness = signal<ReadinessResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly rows = computed<DependencyRow[]>(() => {
    const data = this.readiness();
    if (!data) {
      return [];
    }
    return Object.entries(data.checks).map(([name, check]) => ({
      name,
      label: DEPENDENCY_LABELS[name as DependencyName] ?? name,
      check,
    }));
  });
  protected readonly downCount = computed(
    () => this.rows().filter((r) => r.check.status === 'down').length,
  );

  ngOnInit(): void {
    this.refresh();
    const timer = setInterval(() => {
      if (this.isVisible()) {
        this.refresh(true);
      }
    }, HEALTH_REFRESH_INTERVAL_MS);
    const onVisibility = (): void => {
      if (this.isVisible()) {
        this.refresh(true);
      }
    };
    this.document.addEventListener('visibilitychange', onVisibility);
    this.destroyRef.onDestroy(() => {
      clearInterval(timer);
      this.document.removeEventListener('visibilitychange', onVisibility);
      this.inFlight?.unsubscribe();
    });
  }

  refresh(background = false): void {
    this.inFlight?.unsubscribe();
    this.loading.set(true);
    this.inFlight = this.api.getReadiness({ background }).subscribe({
      next: (data) => {
        this.readiness.set(data);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err, 'Could not load system health.'));
        this.loading.set(false);
      },
    });
  }

  private isVisible(): boolean {
    return this.document.visibilityState !== 'hidden';
  }
}
