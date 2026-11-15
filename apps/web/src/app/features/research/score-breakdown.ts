import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TrendTopicDto } from '@vsf/contracts';
import { componentLabel, pct } from './research-labels';

/** Score breakdown table: component, weight, value (or "missing") and explanation. */
@Component({
  selector: 'app-score-breakdown',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let t = topic();
    <p class="summary">
      Score <strong>{{ t.score | number: '1.2-2' }}</strong> · confidence
      <strong>{{ pct(t.confidence) }}</strong> of the model had data.
    </p>
    @if (missing().length) {
      <p class="missing-callout" role="note" data-testid="missing-components">
        <strong>Missing data:</strong> {{ missing().join(', ') }}. These components were excluded and
        the remaining weights renormalized.
      </p>
    }
    <div class="table-scroll">
      <table class="data-table">
        <caption class="visually-hidden">Score breakdown for {{ t.title }}</caption>
        <thead>
          <tr>
            <th scope="col">Component</th>
            <th scope="col">Weight</th>
            <th scope="col">Value</th>
            <th scope="col">Explanation</th>
          </tr>
        </thead>
        <tbody>
          @for (row of t.breakdown; track row.component) {
            <tr [attr.data-component]="row.component">
              <th scope="row">{{ label(row.component) }}</th>
              <td>{{ row.weight | number: '1.2-2' }}</td>
              <td data-testid="component-value">
                @if (row.value === null) {
                  <span class="missing">missing</span>
                } @else {
                  {{ row.value | number: '1.2-2' }}
                }
              </td>
              <td>{{ row.explanation }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .missing-callout {
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }
    .missing {
      font-style: italic;
      color: var(--mat-sys-error);
    }
  `,
})
export class ScoreBreakdown {
  readonly topic = input.required<TrendTopicDto>();

  /** Union of declared missing components and breakdown rows with no value. */
  protected readonly missing = computed(() => {
    const t = this.topic();
    const keys = new Set([
      ...t.missingComponents,
      ...t.breakdown.filter((b) => b.value === null).map((b) => b.component),
    ]);
    return [...keys].map(componentLabel);
  });

  protected readonly label = componentLabel;
  protected readonly pct = pct;
}
