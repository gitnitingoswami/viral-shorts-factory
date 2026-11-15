import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import type { Page, ProductionStatus, VideoProductionDto } from '@vsf/contracts';
import { Subscription, exhaustMap, timer } from 'rxjs';
import { VideoApiService } from '../../../core/api/video-api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/http/notification.service';
import { StartRenderForm } from '../start-render/start-render-form';
import {
  PRODUCTIONS_PAGE_SIZE,
  PRODUCTION_POLL_INTERVAL_MS,
  PRODUCTION_STATUSES,
  PRODUCTION_STATUS_LABELS,
  STAGE_LABELS,
  canCancel,
  canRetry,
  isActiveProduction,
} from '../video-labels';

@Component({
  selector: 'app-production-queue',
  imports: [DatePipe, RouterLink, MatButtonModule, MatProgressBarModule, MatProgressSpinnerModule, StartRenderForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="visually-hidden" aria-live="polite" data-testid="queue-announcement">{{ announcement() }}</p>
    <div class="page-header">
      <h1 class="page-title">Video productions</h1>
      <div class="actions">
        <a mat-stroked-button routerLink="/video/assets">Asset library</a>
        @if (isOwner()) {
          <button
            mat-flat-button
            type="button"
            data-testid="open-start-render"
            [attr.aria-expanded]="formOpen()"
            (click)="formOpen.set(!formOpen())"
          >
            Start a render
          </button>
        }
      </div>
    </div>

    @if (isOwner() && formOpen()) {
      <app-start-render-form (cancelled)="formOpen.set(false)" (started)="formOpen.set(false)" />
    }

    <div class="bar">
      <label for="production-status">Status</label>
      <select id="production-status" data-testid="production-status" [value]="status()" (change)="onStatus($event)">
        <option value="">All</option>
        @for (s of statuses; track s) {
          <option [value]="s">{{ labels[s] }}</option>
        }
      </select>
      @if (polling) {
        <span class="muted small" role="status">Renders in progress; refreshing automatically.</span>
      }
    </div>

    <section aria-label="Production queue">
      @if (loading() && !page()) {
        <div class="state" role="status">
          <mat-spinner diameter="24" aria-label="Loading productions" />
          <span>Loading productions…</span>
        </div>
      } @else if (error(); as message) {
        <div class="state state-error" role="alert">
          <span>{{ message }}</span>
          <button mat-stroked-button type="button" (click)="load()">Retry</button>
        </div>
      } @else if (page(); as pg) {
        @if (pg.items.length === 0) {
          <p class="state" data-testid="productions-empty">
            No productions match this filter.{{ isOwner() ? ' Start a render from an approved script.' : '' }}
          </p>
        } @else {
          <div class="table-scroll">
            <table class="data-table" data-testid="productions-table">
              <thead>
                <tr>
                  <th scope="col">Script</th>
                  <th scope="col">Voice</th>
                  <th scope="col">Status</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Latest version</th>
                  <th scope="col">Created</th>
                  @if (isOwner()) {
                    <th scope="col">Actions</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (p of pg.items; track p.id) {
                  <tr [attr.data-production]="p.id">
                    <th scope="row">
                      <a [routerLink]="['/video', p.id]">{{ p.scriptTitle || 'Untitled script' }}</a>
                      <span class="muted small"> · script v{{ p.scriptVersion }}</span>
                    </th>
                    <td>{{ p.voiceName }}</td>
                    <td>
                      <span class="chip chip-{{ p.status }}" data-testid="production-status-chip">{{ labels[p.status] }}</span>
                      @if (p.cancelRequested && isActive(p)) {
                        <span class="muted small"> (cancel requested)</span>
                      }
                      @if (p.error) {
                        <p class="error small" data-testid="production-error">{{ p.error }}</p>
                      }
                    </td>
                    <td class="progress-cell">
                      <span class="small">{{ stageLabels[p.stage] }}</span>
                      <div class="progress">
                        <mat-progress-bar
                          mode="determinate"
                          [value]="p.progress"
                          [attr.aria-label]="'Render progress for ' + (p.scriptTitle || 'untitled script')"
                        />
                        <span>{{ p.progress }}%</span>
                      </div>
                    </td>
                    <td>{{ p.latestVersion !== null ? 'v' + p.latestVersion : '—' }}</td>
                    <td>{{ p.createdAt | date: 'medium' }}</td>
                    @if (isOwner()) {
                      <td class="row-actions">
                        @if (canCancel(p)) {
                          <button mat-stroked-button type="button" data-testid="cancel-production"
                            [disabled]="busyId() === p.id" (click)="cancel(p)">
                            Cancel<span class="visually-hidden"> render of {{ p.scriptTitle }}</span>
                          </button>
                        }
                        @if (canRetry(p)) {
                          <button mat-stroked-button type="button" data-testid="retry-production"
                            [disabled]="busyId() === p.id" (click)="retry(p)">
                            Retry<span class="visually-hidden"> render of {{ p.scriptTitle }}</span>
                          </button>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="bar">
            <span class="muted">{{ pg.offset + 1 }}–{{ pg.offset + pg.items.length }} of {{ pg.total }} productions</span>
            <button mat-stroked-button type="button" [disabled]="pg.offset === 0" (click)="goTo(pg.offset - pageSize)">
              Previous
            </button>
            <button
              mat-stroked-button
              type="button"
              data-testid="next-page"
              [disabled]="pg.offset + pg.items.length >= pg.total"
              (click)="goTo(pg.offset + pageSize)"
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
    .progress-cell {
      min-width: 160px;
    }
    .progress {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .row-actions {
      white-space: nowrap;
    }
    .error {
      color: var(--mat-sys-error);
      margin: 4px 0 0;
      overflow-wrap: anywhere;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
  `,
})
export class ProductionQueue implements OnInit {
  private readonly api = inject(VideoApiService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private request: Subscription | null = null;
  private poll: Subscription | null = null;

  protected readonly status = signal<ProductionStatus | ''>('');
  protected readonly offset = signal(0);
  protected readonly page = signal<Page<VideoProductionDto> | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);
  protected readonly formOpen = signal(false);
  protected readonly announcement = signal('');

  protected readonly isOwner = this.auth.isOwner;
  protected readonly anyActive = computed(() => (this.page()?.items ?? []).some(isActiveProduction));

  protected readonly labels = PRODUCTION_STATUS_LABELS;
  protected readonly stageLabels = STAGE_LABELS;
  protected readonly statuses = PRODUCTION_STATUSES;
  protected readonly pageSize = PRODUCTIONS_PAGE_SIZE;
  protected readonly canCancel = canCancel;
  protected readonly canRetry = canRetry;
  protected readonly isActive = isActiveProduction;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopPolling();
      this.request?.unsubscribe();
    });
  }

  /** True while the background poll is active (exposed for tests). */
  get polling(): boolean {
    return !!this.poll && !this.poll.closed;
  }

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.request?.unsubscribe();
    this.stopPolling();
    this.loading.set(true);
    this.error.set(null);
    this.request = this.api.listProductions(this.query()).subscribe({
      next: (page) => {
        this.page.set(page);
        this.loading.set(false);
        this.ensurePolling();
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err, 'Could not load productions.'));
        this.loading.set(false);
      },
    });
  }

  protected onStatus(event: Event): void {
    this.offset.set(0);
    this.status.set((event.target as HTMLSelectElement).value as ProductionStatus | '');
    this.load();
  }

  protected goTo(offset: number): void {
    this.offset.set(Math.max(0, offset));
    this.load();
  }

  protected cancel(p: VideoProductionDto): void {
    this.busyId.set(p.id);
    this.api.cancelProduction(p.id).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.replace(updated);
        this.notify.success('Cancellation requested.');
        this.ensurePolling();
      },
      error: () => this.busyId.set(null),
    });
  }

  protected retry(p: VideoProductionDto): void {
    this.busyId.set(p.id);
    this.api.retryProduction(p.id).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.notify.success(res.created ? 'Render re-queued.' : 'Already exists, opened existing production.');
        this.load();
      },
      error: () => this.busyId.set(null),
    });
  }

  private query() {
    return { status: this.status() || null, limit: PRODUCTIONS_PAGE_SIZE, offset: this.offset() };
  }

  private replace(updated: VideoProductionDto): void {
    this.page.update((page) =>
      page ? { ...page, items: page.items.map((i) => (i.id === updated.id ? updated : i)) } : page,
    );
  }

  private ensurePolling(): void {
    if (!this.anyActive()) {
      this.stopPolling();
      return;
    }
    if (this.polling) {
      return;
    }
    this.poll = timer(PRODUCTION_POLL_INTERVAL_MS, PRODUCTION_POLL_INTERVAL_MS)
      .pipe(exhaustMap(() => this.api.listProductions(this.query(), { background: true })))
      .subscribe({
        next: (fresh) => {
          this.announceChanges(this.page()?.items ?? [], fresh.items);
          this.page.set(fresh);
          if (!fresh.items.some(isActiveProduction)) {
            this.stopPolling();
          }
        },
        // A failed poll ends this loop; keep the last known state (the user can change filter/page to reload).
        error: () => this.stopPolling(),
      });
  }

  private stopPolling(): void {
    this.poll?.unsubscribe();
    this.poll = null;
  }

  private announceChanges(before: VideoProductionDto[], after: VideoProductionDto[]): void {
    const prev = new Map(before.map((p) => [p.id, p.status]));
    const changed = after.filter((p) => prev.has(p.id) && prev.get(p.id) !== p.status);
    if (changed.length) {
      this.announcement.set(
        changed.map((p) => `${p.scriptTitle || 'Untitled script'}: ${PRODUCTION_STATUS_LABELS[p.status]}`).join('. '),
      );
    }
  }
}
