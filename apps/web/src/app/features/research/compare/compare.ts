import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import type { ScoreComponent, ScoreComponentDetail, TrendTopicDetailDto } from '@vsf/contracts';
import { MAX_COMPARE, MIN_COMPARE, ResearchApiService } from '../../../core/api/research-api.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import { COMPONENT_LABELS, componentLabel, pct, sourceLabel } from '../research-labels';

/** Parses the `ids` query param into unique, non-empty ids. */
export function parseCompareIds(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
}

export function isValidCompareCount(n: number): boolean {
  return n >= MIN_COMPARE && n <= MAX_COMPARE;
}

@Component({
  selector: 'app-topic-compare',
  imports: [DecimalPipe, RouterLink, MatButtonModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <h1 class="page-title">Compare topics</h1>
      @if (topics()[0]; as first) {
        <div class="actions">
          <a mat-stroked-button [routerLink]="['/research/collections', first.collectionId]">Back to topics</a>
        </div>
      }
    </div>
    <section aria-live="polite" aria-label="Comparison">
      @if (!valid()) {
        <p class="state state-error" role="alert" data-testid="compare-invalid">
          Select between {{ min }} and {{ max }} topics to compare.
        </p>
      } @else if (loading()) {
        <div class="state" role="status">
          <mat-spinner diameter="24" aria-label="Loading comparison" />
          <span>Loading comparison…</span>
        </div>
      } @else if (error(); as message) {
        <div class="state state-error" role="alert">
          <span>{{ message }}</span>
          <button mat-stroked-button type="button" (click)="load()">Retry</button>
        </div>
      } @else if (topics().length) {
        <div class="table-scroll">
          <table class="data-table compare-table" data-testid="compare-table">
            <caption class="visually-hidden">Side-by-side score breakdown</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                @for (t of topics(); track t.id) {
                  <th scope="col">
                    <a [routerLink]="['/research/topics', t.id]">{{ t.title }}</a>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Score</th>
                @for (t of topics(); track t.id) {
                  <td>{{ t.score | number: '1.2-2' }}</td>
                }
              </tr>
              <tr>
                <th scope="row">Confidence</th>
                @for (t of topics(); track t.id) {
                  <td>{{ pct(t.confidence) }}</td>
                }
              </tr>
              <tr>
                <th scope="row">Fresh</th>
                @for (t of topics(); track t.id) {
                  <td>{{ t.stale ? 'Stale' : 'Fresh' }}</td>
                }
              </tr>
              <tr>
                <th scope="row">Sources</th>
                @for (t of topics(); track t.id) {
                  <td>{{ t.sources.map(sourceLabel).join(', ') || '—' }}</td>
                }
              </tr>
              @for (c of components(); track c) {
                <tr [attr.data-component]="c">
                  <th scope="row">{{ componentLabel(c) }}</th>
                  @for (t of topics(); track t.id) {
                    @let d = detail(t, c);
                    <td>
                      @if (!d || d.value === null) {
                        <span class="missing">missing</span>
                      } @else {
                        {{ d.value | number: '1.2-2' }}
                        <span class="muted">(w {{ d.weight | number: '1.2-2' }})</span>
                      }
                      @if (d) {
                        <div class="muted explanation">{{ d.explanation }}</div>
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: `
    .compare-table td,
    .compare-table th {
      vertical-align: top;
      min-width: 160px;
    }
    .missing {
      font-style: italic;
      color: var(--mat-sys-error);
    }
    .explanation {
      font: var(--mat-sys-body-small);
    }
  `,
})
export class TopicCompare implements OnInit {
  private readonly api = inject(ResearchApiService);

  /** Comma-separated topic ids (query param). */
  readonly ids = input<string | undefined>();

  protected readonly min = MIN_COMPARE;
  protected readonly max = MAX_COMPARE;
  protected readonly parsedIds = computed(() => parseCompareIds(this.ids()));
  protected readonly valid = computed(() => isValidCompareCount(this.parsedIds().length));
  protected readonly topics = signal<TrendTopicDetailDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Components in model order, then any extra ones a topic reports. */
  protected readonly components = computed<ScoreComponent[]>(() => {
    const seen = new Set<ScoreComponent>();
    for (const t of this.topics()) {
      t.breakdown.forEach((b) => seen.add(b.component));
      t.missingComponents.forEach((c) => seen.add(c));
    }
    const order = Object.keys(COMPONENT_LABELS) as ScoreComponent[];
    return [...seen].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  });

  protected readonly componentLabel = componentLabel;
  protected readonly sourceLabel = sourceLabel;
  protected readonly pct = pct;

  ngOnInit(): void {
    this.load();
  }

  protected detail(t: TrendTopicDetailDto, c: ScoreComponent): ScoreComponentDetail | undefined {
    return t.breakdown.find((b) => b.component === c);
  }

  protected load(): void {
    if (!this.valid()) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.api.compareTopics(this.parsedIds()).subscribe({
      next: (topics) => {
        this.topics.set(topics);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err, 'Could not load the comparison.'));
        this.loading.set(false);
      },
    });
  }
}
