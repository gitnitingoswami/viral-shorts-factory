import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import type { JobDto, TrendTopicDto } from '@vsf/contracts';
import { Subscription } from 'rxjs';
import { ContentApiService } from '../../core/api/content-api.service';
import { JobsApiService } from '../../core/api/jobs-api.service';
import { AuthService } from '../../core/auth/auth.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { pollJob } from './content-labels';

/**
 * "Generate ideas" for an approved topic (owner only). Starts the job, polls it, then links to the ideas.
 * Renders nothing for reviewers or topics that are not approved.
 */
@Component({
  selector: 'app-generate-ideas',
  imports: [MatButtonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="generate" data-testid="generate-ideas">
        @let j = job();
        @if (j?.status === 'completed') {
          <a
            mat-stroked-button
            data-testid="ideas-link"
            routerLink="/content/ideas"
            [queryParams]="{ topicId: topic().id }"
          >
            View ideas
          </a>
        } @else {
          <button
            mat-stroked-button
            type="button"
            data-testid="generate-ideas-btn"
            [disabled]="busy()"
            (click)="generate()"
          >
            {{ busy() ? 'Generating ideas…' : 'Generate ideas' }}
          </button>
        }
        <span class="status" role="status" aria-live="polite">
          @if (error(); as e) {
            <span class="error">{{ e }}</span>
          } @else if (j) {
            @switch (j.status) {
              @case ('completed') {
                Ideas ready.
              }
              @case ('queued') {
                Queued…
              }
              @case ('running') {
                Running ({{ j.progress }}%)…
              }
            }
          }
        </span>
      </div>
    }
  `,
  styles: `
    .generate {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .status {
      font: var(--mat-sys-body-small);
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class GenerateIdeas {
  private readonly api = inject(ContentApiService);
  private readonly jobs = inject(JobsApiService);
  private readonly auth = inject(AuthService);
  private poll: Subscription | null = null;
  /** Reused for retries after a failed POST so the request stays idempotent. */
  private pendingKey: string | null = null;

  readonly topic = input.required<TrendTopicDto>();

  protected readonly job = signal<JobDto | null>(null);
  protected readonly starting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly visible = computed(() => this.auth.isOwner() && this.topic().status === 'approved');
  protected readonly busy = computed(() => {
    const status = this.job()?.status;
    return this.starting() || status === 'queued' || status === 'running';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.poll?.unsubscribe());
  }

  protected generate(): void {
    if (this.busy()) {
      return;
    }
    this.pendingKey ??= crypto.randomUUID();
    this.starting.set(true);
    this.error.set(null);
    this.api.generateIdeas(this.topic().id, this.pendingKey).subscribe({
      next: (job) => {
        this.pendingKey = null;
        this.starting.set(false);
        this.track(job);
      },
      error: (err: unknown) => {
        this.starting.set(false);
        this.error.set(apiErrorMessage(err, 'Could not start idea generation.'));
      },
    });
  }

  private track(job: JobDto): void {
    this.job.set(job);
    this.poll?.unsubscribe();
    this.poll = pollJob(this.jobs, job).subscribe((j) => {
      this.job.set(j);
      if (j.status === 'failed' || j.status === 'cancelled') {
        this.error.set(j.error ? `Idea generation failed: ${j.error}` : `Idea generation ${j.status}.`);
      }
    });
  }
}
