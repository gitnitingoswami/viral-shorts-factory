import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { BudgetSummaryDto } from '@vsf/contracts';
import { BudgetApiService } from '../../core/api/budget-api.service';
import { apiErrorMessage } from '../../core/http/api-error';

const STATUS_TEXT: Record<BudgetSummaryDto['status'], string> = {
  ok: 'Within budget',
  warning: 'Approaching limit',
  exceeded: 'Budget exceeded',
};

/** Owner-only month-to-date spend vs. limit. Status is conveyed by text, not color alone. */
@Component({
  selector: 'app-budget-card',
  imports: [CurrencyPipe, MatButtonModule, MatProgressBarModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="card-title">Monthly budget</h2>
    <div aria-live="polite">
      @if (loading()) {
        <div class="state" role="status">
          <mat-spinner diameter="24" aria-label="Loading budget" />
          <span>Loading budget…</span>
        </div>
      } @else if (error(); as message) {
        <div class="state state-error" role="alert" data-testid="budget-error">
          <span>{{ message }}</span>
          <button mat-stroked-button type="button" (click)="load()">Retry</button>
        </div>
      } @else if (summary(); as b) {
        <p data-testid="budget-amounts">
          {{ b.spentMinor / 100 | currency: b.currency }} of {{ b.limitMinor / 100 | currency: b.currency }}
          spent in {{ b.period }}
        </p>
        <mat-progress-bar
          mode="determinate"
          [value]="usedPct()"
          [attr.aria-label]="'Budget used: ' + usedPct() + '%'"
        />
        <p>
          <span class="chip chip-{{ b.status }}" data-testid="budget-status">{{ statusText() }}</span>
          <span class="muted"> · {{ usedPct() }}% used (warning at {{ b.warnPct }}%)</span>
        </p>
      }
    </div>
  `,
  styles: `
    .card-title {
      margin: 0 0 8px;
      font: var(--mat-sys-title-medium);
    }
  `,
})
export class BudgetCard implements OnInit {
  private readonly api = inject(BudgetApiService);

  protected readonly summary = signal<BudgetSummaryDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly usedPct = computed(() => {
    const b = this.summary();
    if (!b || b.limitMinor <= 0) {
      return 0;
    }
    return Math.round((b.spentMinor / b.limitMinor) * 100);
  });
  protected readonly statusText = computed(() => {
    const b = this.summary();
    return b ? STATUS_TEXT[b.status] : '';
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.summary().subscribe({
      next: (b) => {
        this.summary.set(b);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err, 'Could not load the budget.'));
        this.loading.set(false);
      },
    });
  }
}
