import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import type { WeeklyTrendReportDto } from '@vsf/contracts';
import { ResearchApiService } from '../../../core/api/research-api.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import { SafeMarkdownView } from './safe-markdown-view';

@Component({
  selector: 'app-research-report',
  imports: [DatePipe, RouterLink, MatButtonModule, MatProgressSpinnerModule, SafeMarkdownView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <h1 class="page-title">Weekly trend report</h1>
      <div class="actions">
        <a mat-stroked-button [routerLink]="['/research/collections', id()]">Back to topics</a>
      </div>
    </div>
    <section aria-live="polite" aria-label="Report">
      @if (loading()) {
        <div class="state" role="status">
          <mat-spinner diameter="24" aria-label="Loading report" />
          <span>Loading report…</span>
        </div>
      } @else if (notReady()) {
        <p class="state" data-testid="report-not-ready">
          The report is not available yet. It is generated when the collection finishes.
        </p>
      } @else if (error(); as message) {
        <div class="state state-error" role="alert">
          <span>{{ message }}</span>
          <button mat-stroked-button type="button" (click)="load()">Retry</button>
        </div>
      } @else if (report(); as r) {
        <p class="muted">Generated {{ r.generatedAt | date: 'medium' }}</p>
        @if (r.limitations.length) {
          <section class="limitations" aria-labelledby="limitations-heading">
            <h2 id="limitations-heading" class="section-title">Limitations</h2>
            <ul data-testid="report-limitations">
              @for (l of r.limitations; track $index) {
                <li>{{ l }}</li>
              }
            </ul>
          </section>
        }
        @if (r.markdown.trim()) {
          <article class="report-body" data-testid="report-body">
            <app-safe-markdown [markdown]="r.markdown" />
          </article>
        } @else {
          <p class="state">The report is empty.</p>
        }
      }
    </section>
  `,
  styles: `
    .limitations {
      padding: 12px 16px;
      margin-bottom: 16px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
    }
    .report-body {
      max-width: 80ch;
    }
  `,
})
export class ResearchReport implements OnInit {
  private readonly api = inject(ResearchApiService);

  /** Collection id (route param). */
  readonly id = input.required<string>();

  protected readonly report = signal<WeeklyTrendReportDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly notReady = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.notReady.set(false);
    this.api.getReport(this.id()).subscribe({
      next: (r) => {
        this.report.set(r);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.notReady.set(true);
        } else {
          this.error.set(apiErrorMessage(err, 'Could not load the report.'));
        }
        this.loading.set(false);
      },
    });
  }
}
