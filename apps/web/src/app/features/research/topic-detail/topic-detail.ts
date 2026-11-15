import { DatePipe, KeyValuePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import type { TopicDecisionRequest, TrendTopicDetailDto } from '@vsf/contracts';
import { ResearchApiService } from '../../../core/api/research-api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import { DecisionControls } from '../decision-controls';
import { safeHref } from '../report/safe-markdown';
import { sourceLabel, withDecision } from '../research-labels';
import { ScoreBreakdown } from '../score-breakdown';

@Component({
  selector: 'app-topic-detail',
  imports: [
    DatePipe,
    KeyValuePipe,
    RouterLink,
    MatButtonModule,
    MatProgressSpinnerModule,
    ScoreBreakdown,
    DecisionControls,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './topic-detail.html',
  styleUrl: './topic-detail.scss',
})
export class TopicDetail implements OnInit {
  private readonly api = inject(ResearchApiService);
  private readonly auth = inject(AuthService);

  /** Topic id (route param). */
  readonly id = input.required<string>();

  protected readonly topic = signal<TrendTopicDetailDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly deciding = signal(false);
  protected readonly announcement = signal('');
  protected readonly canDecide = computed(() => this.auth.hasRole(['owner', 'reviewer']));

  protected readonly sourceLabel = sourceLabel;
  protected readonly safeHref = safeHref;

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getTopic(this.id()).subscribe({
      next: (t) => {
        this.topic.set(t);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err, 'Could not load the topic.'));
        this.loading.set(false);
      },
    });
  }

  protected decide(req: TopicDecisionRequest): void {
    const previous = this.topic();
    if (!previous || this.deciding()) {
      return;
    }
    this.deciding.set(true);
    this.topic.set(withDecision(previous, req.decision, req.note));
    this.api.decide(previous.id, req).subscribe({
      next: (updated) => {
        this.topic.update((t) => (t ? { ...t, ...updated } : t));
        this.deciding.set(false);
        this.announcement.set(`Topic ${updated.status}.`);
      },
      error: () => {
        this.topic.set(previous);
        this.deciding.set(false);
        this.announcement.set('Decision failed; the previous status was restored.');
      },
    });
  }
}
