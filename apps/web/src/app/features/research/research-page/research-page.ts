import { DatePipe, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import type { NicheDto, Page, ResearchSourceDto, TrendCollectionDto } from '@vsf/contracts';
import { Subscription } from 'rxjs';
import { NichesApiService } from '../../../core/api/niches-api.service';
import { ResearchApiService } from '../../../core/api/research-api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/http/notification.service';
import { SOURCE_IMPACT, isTerminalStatus, sourceLabel } from '../research-labels';

export const COLLECTION_POLL_INTERVAL_MS = 5_000;
export const COLLECTIONS_PAGE_SIZE = 20;

@Component({
  selector: 'app-research-page',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './research-page.html',
  styleUrl: './research-page.scss',
})
export class ResearchPage implements OnInit {
  private readonly research = inject(ResearchApiService);
  private readonly nichesApi = inject(NichesApiService);
  private readonly notifications = inject(NotificationService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollRequest: Subscription | null = null;
  private collectionsRequest: Subscription | null = null;

  protected readonly isOwner = inject(AuthService).isOwner;

  protected readonly niches = signal<NicheDto[]>([]);
  protected readonly nichesLoading = signal(true);
  protected readonly nichesError = signal<string | null>(null);
  protected readonly nicheId = signal<string | null>(null);

  protected readonly sources = signal<ResearchSourceDto[]>([]);
  protected readonly sourcesLoading = signal(true);
  protected readonly sourcesError = signal<string | null>(null);

  protected readonly collections = signal<Page<TrendCollectionDto> | null>(null);
  protected readonly collectionsLoading = signal(false);
  protected readonly collectionsError = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly starting = signal(false);
  protected readonly announcement = signal('');

  protected readonly selected = computed(
    () => this.collections()?.items.find((c) => c.id === this.selectedId()) ?? null,
  );
  protected readonly selectedNiche = computed(
    () => this.niches().find((n) => n.id === this.nicheId()) ?? null,
  );

  protected readonly sourceLabel = sourceLabel;
  protected readonly sourceImpact = SOURCE_IMPACT;
  protected readonly isTerminal = isTerminalStatus;

  ngOnInit(): void {
    this.loadNiches();
    this.loadSources();
    const onVisibility = (): void => {
      if (this.isVisible()) {
        this.ensurePolling(true);
      } else {
        this.stopPolling();
      }
    };
    this.document.addEventListener('visibilitychange', onVisibility);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisibility);
      this.stopPolling();
      this.collectionsRequest?.unsubscribe();
    });
  }

  /** True while a poll timer is active (exposed for tests). */
  get polling(): boolean {
    return this.pollTimer !== null;
  }

  protected loadNiches(): void {
    this.nichesLoading.set(true);
    this.nichesError.set(null);
    this.nichesApi.list().subscribe({
      next: (niches) => {
        this.niches.set(niches);
        this.nichesLoading.set(false);
        const current = this.nicheId();
        if (!current || !niches.some((n) => n.id === current)) {
          const first = niches.find((n) => n.active) ?? niches[0];
          this.selectNiche(first?.id ?? null);
        }
      },
      error: (err: unknown) => {
        this.nichesError.set(apiErrorMessage(err, 'Could not load niches.'));
        this.nichesLoading.set(false);
      },
    });
  }

  protected loadSources(): void {
    this.sourcesLoading.set(true);
    this.sourcesError.set(null);
    this.research.listSources().subscribe({
      next: (sources) => {
        this.sources.set(sources);
        this.sourcesLoading.set(false);
      },
      error: (err: unknown) => {
        this.sourcesError.set(apiErrorMessage(err, 'Could not load research sources.'));
        this.sourcesLoading.set(false);
      },
    });
  }

  protected onNicheChange(event: Event): void {
    this.selectNiche((event.target as HTMLSelectElement).value || null);
  }

  protected selectNiche(id: string | null): void {
    this.nicheId.set(id);
    this.selectedId.set(null);
    this.collections.set(null);
    this.stopPolling();
    if (id) {
      this.loadCollections();
    }
  }

  protected loadCollections(): void {
    const nicheId = this.nicheId();
    if (!nicheId) {
      return;
    }
    this.collectionsRequest?.unsubscribe();
    this.collectionsLoading.set(true);
    this.collectionsError.set(null);
    this.collectionsRequest = this.research
      .listCollections({ nicheId, limit: COLLECTIONS_PAGE_SIZE, offset: 0 })
      .subscribe({
        next: (page) => {
          this.collections.set(page);
          this.collectionsLoading.set(false);
          const keep = page.items.some((c) => c.id === this.selectedId());
          if (!keep) {
            // Prefer a collection that is still running so its progress is visible.
            const running = page.items.find((c) => !isTerminalStatus(c.status));
            this.selectedId.set(running?.id ?? page.items[0]?.id ?? null);
          }
          this.ensurePolling();
        },
        error: (err: unknown) => {
          this.collectionsError.set(apiErrorMessage(err, 'Could not load collections.'));
          this.collectionsLoading.set(false);
        },
      });
  }

  protected select(collection: TrendCollectionDto): void {
    this.selectedId.set(collection.id);
    this.stopPolling();
    this.ensurePolling(!isTerminalStatus(collection.status));
  }

  protected runNow(): void {
    const nicheId = this.nicheId();
    if (!nicheId || this.starting()) {
      return;
    }
    this.starting.set(true);
    this.research.startRun(nicheId, crypto.randomUUID()).subscribe({
      next: (collection) => {
        this.starting.set(false);
        this.collections.update((p) => {
          const existed = p?.items.some((c) => c.id === collection.id) ?? false;
          return {
            items: [collection, ...(p?.items.filter((c) => c.id !== collection.id) ?? [])],
            total: (p?.total ?? 0) + (existed ? 0 : 1),
            limit: p?.limit ?? COLLECTIONS_PAGE_SIZE,
            offset: p?.offset ?? 0,
          };
        });
        this.selectedId.set(collection.id);
        this.announcement.set(`Research run ${collection.status}.`);
        this.notifications.success('Research run started.');
        this.stopPolling();
        this.ensurePolling();
      },
      error: () => this.starting.set(false),
    });
  }

  /** Starts the poll timer if the selected collection is not terminal and the tab is visible. */
  private ensurePolling(pollNow = false): void {
    const c = this.selected();
    if (!c || isTerminalStatus(c.status) || !this.isVisible()) {
      this.stopPolling();
      return;
    }
    if (pollNow) {
      this.pollOnce();
    }
    this.pollTimer ??= setInterval(() => this.pollOnce(), COLLECTION_POLL_INTERVAL_MS);
  }

  private pollOnce(): void {
    const c = this.selected();
    if (!c || isTerminalStatus(c.status) || !this.isVisible()) {
      this.stopPolling();
      return;
    }
    if (this.pollRequest && !this.pollRequest.closed) {
      return;
    }
    this.pollRequest = this.research.getCollection(c.id, { background: true }).subscribe({
      next: (updated) => {
        if (updated.status !== c.status) {
          this.announcement.set(`Collection status changed to ${updated.status}.`);
        }
        this.collections.update((p) =>
          p ? { ...p, items: p.items.map((x) => (x.id === updated.id ? updated : x)) } : p,
        );
        if (isTerminalStatus(updated.status)) {
          this.stopPolling();
        }
      },
      // Transient errors: keep polling; the next tick retries.
      error: () => undefined,
    });
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollRequest?.unsubscribe();
    this.pollRequest = null;
  }

  private isVisible(): boolean {
    return this.document.visibilityState !== 'hidden';
  }
}
