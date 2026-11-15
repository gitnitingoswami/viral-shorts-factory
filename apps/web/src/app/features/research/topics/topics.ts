import { DatePipe, DecimalPipe } from '@angular/common';
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import type {
  Page,
  TopicDecisionRequest,
  TopicStatus,
  TrendCollectionDto,
  TrendTopicDto,
} from '@vsf/contracts';
import { Subscription, debounceTime, merge } from 'rxjs';
import {
  MAX_COMPARE,
  MIN_COMPARE,
  ResearchApiService,
  type TopicQuery,
  type TopicSort,
} from '../../../core/api/research-api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import { GenerateIdeas } from '../../content/generate-ideas';
import { DecisionControls } from '../decision-controls';
import { pct, sourceLabel, withDecision } from '../research-labels';

export const TOPICS_PAGE_SIZE = 25;
export const SEARCH_DEBOUNCE_MS = 300;

@Component({
  selector: 'app-collection-topics',
  imports: [
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    DecisionControls,
    GenerateIdeas,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './topics.html',
  styleUrl: './topics.scss',
})
export class CollectionTopics implements OnInit {
  private readonly api = inject(ResearchApiService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private topicsRequest: Subscription | null = null;

  /** Collection id (route param). */
  readonly id = input.required<string>();

  protected readonly collection = signal<TrendCollectionDto | null>(null);
  protected readonly page = signal<Page<TrendTopicDto> | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly offset = signal(0);
  protected readonly selected = signal<string[]>([]);
  protected readonly deciding = signal<ReadonlySet<string>>(new Set());
  protected readonly announcement = signal('');

  protected readonly canDecide = computed(() => this.auth.hasRole(['owner', 'reviewer']));
  protected readonly canCompare = computed(
    () => this.selected().length >= MIN_COMPARE && this.selected().length <= MAX_COMPARE,
  );
  protected readonly selectionFull = computed(() => this.selected().length >= MAX_COMPARE);
  protected readonly maxCompare = MAX_COMPARE;
  protected readonly pageSize = TOPICS_PAGE_SIZE;

  protected readonly filters = inject(NonNullableFormBuilder).group({
    status: ['' as TopicStatus | ''],
    minScore: [0],
    q: [''],
    sort: ['score' as TopicSort],
  });

  protected readonly sourceLabel = sourceLabel;
  protected readonly pct = pct;

  ngOnInit(): void {
    this.api.getCollection(this.id()).subscribe({
      next: (c) => this.collection.set(c),
      error: () => this.collection.set(null),
    });
    const c = this.filters.controls;
    merge(
      c.status.valueChanges,
      c.minScore.valueChanges,
      c.sort.valueChanges,
      c.q.valueChanges.pipe(debounceTime(SEARCH_DEBOUNCE_MS)),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());
    this.loadTopics();
  }

  /** Current filter state as an API query. */
  query(): TopicQuery {
    const f = this.filters.getRawValue();
    return {
      status: f.status || null,
      minScore: Number(f.minScore) || 0,
      q: f.q,
      sort: f.sort,
      limit: TOPICS_PAGE_SIZE,
      offset: this.offset(),
    };
  }

  protected applyFilters(): void {
    this.offset.set(0);
    this.loadTopics();
  }

  protected goTo(offset: number): void {
    this.offset.set(Math.max(0, offset));
    this.loadTopics();
  }

  protected loadTopics(): void {
    this.topicsRequest?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.topicsRequest = this.api.listTopics(this.id(), this.query()).subscribe({
      next: (page) => {
        this.page.set(page);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err, 'Could not load topics.'));
        this.loading.set(false);
      },
    });
  }

  protected isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  protected toggle(id: string, checked: boolean): void {
    this.selected.update((ids) => {
      if (!checked) {
        return ids.filter((x) => x !== id);
      }
      return ids.includes(id) || ids.length >= MAX_COMPARE ? ids : [...ids, id];
    });
  }

  protected onToggle(id: string, event: Event): void {
    this.toggle(id, (event.target as HTMLInputElement).checked);
  }

  protected compare(): void {
    if (!this.canCompare()) {
      return;
    }
    void this.router.navigate(['/research/topics/compare'], {
      queryParams: { ids: this.selected().join(',') },
    });
  }

  /** Optimistic update; rolls back to the previous topic if the API rejects it. */
  protected decide(topic: TrendTopicDto, req: TopicDecisionRequest): void {
    if (this.deciding().has(topic.id)) {
      return;
    }
    this.setDeciding(topic.id, true);
    this.replace(withDecision(topic, req.decision, req.note));
    this.api.decide(topic.id, req).subscribe({
      next: (updated) => {
        this.replace(updated);
        this.setDeciding(topic.id, false);
        this.announcement.set(`"${updated.title}" ${updated.status}.`);
      },
      error: () => {
        this.replace(topic);
        this.setDeciding(topic.id, false);
        this.announcement.set(`Decision on "${topic.title}" failed; status restored.`);
      },
    });
  }

  private replace(topic: TrendTopicDto): void {
    this.page.update((p) =>
      p ? { ...p, items: p.items.map((t) => (t.id === topic.id ? topic : t)) } : p,
    );
  }

  private setDeciding(id: string, on: boolean): void {
    this.deciding.update((set) => {
      const next = new Set(set);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }
}
