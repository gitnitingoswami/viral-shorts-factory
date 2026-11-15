import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import type { Page, ScriptDto, ScriptStatus } from '@vsf/contracts';
import { Subscription } from 'rxjs';
import { ContentApiService } from '../../../core/api/content-api.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import { MockBanner } from '../mock-banner';

export const SCRIPTS_PAGE_SIZE = 25;

export const SCRIPT_STATUS_LABELS: Record<ScriptStatus, string> = {
  drafting: 'Drafting',
  in_review: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
};

@Component({
  selector: 'app-script-list',
  imports: [DatePipe, RouterLink, MatButtonModule, MatProgressSpinnerModule, MockBanner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <h1 class="page-title">Scripts</h1>
      <div class="actions">
        <a mat-stroked-button routerLink="/content/ideas">Ideas</a>
      </div>
    </div>

    <app-mock-banner />

    <div class="bar">
      <label for="script-status">Status</label>
      <select id="script-status" data-testid="script-status" [value]="status()" (change)="onStatus($event)">
        <option value="">All</option>
        @for (s of statuses; track s) {
          <option [value]="s">{{ labels[s] }}</option>
        }
      </select>
    </div>

    <section aria-label="Script list">
      @if (loading() && !page()) {
        <div class="state" role="status">
          <mat-spinner diameter="24" aria-label="Loading scripts" />
          <span>Loading scripts…</span>
        </div>
      } @else if (error(); as message) {
        <div class="state state-error" role="alert">
          <span>{{ message }}</span>
          <button mat-stroked-button type="button" (click)="load()">Retry</button>
        </div>
      } @else if (page(); as p) {
        @if (p.items.length === 0) {
          <p class="state" data-testid="scripts-empty">No scripts match this filter. Select an idea to draft one.</p>
        } @else {
          <div class="table-scroll">
            <table class="data-table" data-testid="scripts-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Status</th>
                  <th scope="col">Version</th>
                  <th scope="col">Approved version</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                @for (s of p.items; track s.id) {
                  <tr [attr.data-script]="s.id">
                    <th scope="row"><a [routerLink]="['/content/scripts', s.id]">{{ s.title || 'Untitled script' }}</a></th>
                    <td><span class="chip chip-{{ s.status }}">{{ labels[s.status] }}</span></td>
                    <td>v{{ s.currentVersion }}</td>
                    <td>{{ s.approvedVersion !== null ? 'v' + s.approvedVersion : '—' }}</td>
                    <td>{{ s.updatedAt | date: 'medium' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="bar">
            <span class="muted">{{ p.offset + 1 }}–{{ p.offset + p.items.length }} of {{ p.total }} scripts</span>
            <button mat-stroked-button type="button" [disabled]="p.offset === 0" (click)="goTo(p.offset - pageSize)">
              Previous
            </button>
            <button
              mat-stroked-button
              type="button"
              [disabled]="p.offset + p.items.length >= p.total"
              (click)="goTo(p.offset + pageSize)"
            >
              Next
            </button>
          </div>
        }
      }
    </section>
  `,
  styles: `
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin: 12px 0;
    }
    select {
      font: var(--mat-sys-body-medium);
      padding: 4px 6px;
    }
  `,
})
export class ScriptList {
  private readonly api = inject(ContentApiService);
  private request: Subscription | null = null;

  protected readonly status = signal<ScriptStatus | ''>('');
  protected readonly offset = signal(0);
  protected readonly page = signal<Page<ScriptDto> | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly labels = SCRIPT_STATUS_LABELS;
  protected readonly statuses = Object.keys(SCRIPT_STATUS_LABELS) as ScriptStatus[];
  protected readonly pageSize = SCRIPTS_PAGE_SIZE;

  constructor() {
    effect(() => {
      this.status();
      this.offset();
      untracked(() => this.load());
    });
  }

  protected load(): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.request = this.api
      .listScripts({ status: this.status() || null, limit: SCRIPTS_PAGE_SIZE, offset: this.offset() })
      .subscribe({
        next: (page) => {
          this.page.set(page);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(apiErrorMessage(err, 'Could not load scripts.'));
          this.loading.set(false);
        },
      });
  }

  protected onStatus(event: Event): void {
    this.offset.set(0);
    this.status.set((event.target as HTMLSelectElement).value as ScriptStatus | '');
  }

  protected goTo(offset: number): void {
    this.offset.set(Math.max(0, offset));
  }
}
