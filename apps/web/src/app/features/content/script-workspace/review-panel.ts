import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ScriptReviewDto } from '@vsf/contracts';
import { DIMENSION_LABELS, QUALITY_DIMENSIONS } from '../content-labels';

const DECISION_LABELS: Record<NonNullable<ScriptReviewDto['decision']>, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
};

/** Latest AI quality review (7 dimensions, 1–5) plus the human review history. */
@Component({
  selector: 'app-review-panel',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3 class="sub">AI quality review</h3>
    @if (aiReview(); as r) {
      @if (r.scores; as scores) {
        <dl class="scores" data-testid="quality-scores">
          @for (d of dimensions; track d) {
            <div class="score">
              <dt>{{ dimensionLabels[d] }}</dt>
              <dd>
                <meter min="1" max="5" low="2.5" high="3.5" optimum="5" [value]="scores[d]" [attr.aria-label]="dimensionLabels[d]"></meter>
                <span>{{ scores[d] }}/5</span>
              </dd>
            </div>
          }
        </dl>
      }
      @if (r.issues.length) {
        <ul class="issues" data-testid="quality-issues">
          @for (issue of r.issues; track $index) {
            <li>{{ issue }}</li>
          }
        </ul>
      } @else {
        <p class="muted">No issues reported.</p>
      }
    } @else {
      <p class="muted">No AI quality review yet.</p>
    }

    <h3 class="sub">Human review history</h3>
    @if (humanReviews().length === 0) {
      <p class="muted">No human reviews yet.</p>
    } @else {
      <ol class="history" data-testid="review-history">
        @for (r of humanReviews(); track r.id) {
          <li>
            @if (r.decision) {
              <span class="chip chip-{{ r.decision }}">{{ decisionLabels[r.decision] }}</span>
            }
            <span class="muted">{{ r.createdAt | date: 'medium' }}</span>
            @if (r.note) {
              <p class="note">{{ r.note }}</p>
            }
          </li>
        }
      </ol>
    }
  `,
  styles: `
    .sub {
      margin: 12px 0 6px;
      font: var(--mat-sys-title-small);
    }
    .scores {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
      gap: 6px 16px;
      margin: 0;
    }
    .score dt {
      font: var(--mat-sys-label-medium);
    }
    .score dd {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    meter {
      flex: 1;
    }
    .issues,
    .history {
      margin: 6px 0;
      padding-left: 20px;
      overflow-wrap: anywhere;
    }
    .history li {
      margin-bottom: 6px;
    }
    .note {
      margin: 2px 0 0;
    }
  `,
})
export class ReviewPanel {
  readonly reviews = input.required<ScriptReviewDto[]>();

  protected readonly dimensions = QUALITY_DIMENSIONS;
  protected readonly dimensionLabels = DIMENSION_LABELS;
  protected readonly decisionLabels = DECISION_LABELS;
  protected readonly aiReview = computed(() => {
    const ai = this.reviews().filter((r) => r.kind === 'ai_quality');
    return ai.length ? ai.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)) : null;
  });
  protected readonly humanReviews = computed(() =>
    this.reviews()
      .filter((r) => r.kind === 'human')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
}
