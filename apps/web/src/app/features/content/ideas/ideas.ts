import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import type { ContentIdeaDto, IdeaStatus, Page } from '@vsf/contracts';
import { Subscription } from 'rxjs';
import { ContentApiService } from '../../../core/api/content-api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import { safeHref } from '../../research/report/safe-markdown';
import { formatLabel, isSimilar } from '../content-labels';
import { LlmProvenanceView } from '../llm-provenance';
import { MockBanner } from '../mock-banner';

export const IDEAS_PAGE_SIZE = 20;

@Component({
  selector: 'app-content-ideas',
  imports: [DatePipe, DecimalPipe, RouterLink, MatButtonModule, MatProgressSpinnerModule, MockBanner, LlmProvenanceView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ideas.html',
  styleUrl: './ideas.scss',
})
export class ContentIdeas {
  private readonly api = inject(ContentApiService);
  private readonly router = inject(Router);
  private request: Subscription | null = null;

  /** Optional topic filter (query param). */
  readonly topicId = input<string | undefined>(undefined);

  protected readonly isOwner = inject(AuthService).isOwner;
  protected readonly status = signal<IdeaStatus | ''>('');
  protected readonly offset = signal(0);
  protected readonly page = signal<Page<ContentIdeaDto> | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<ReadonlySet<string>>(new Set());
  protected readonly actionError = signal<string | null>(null);
  protected readonly announcement = signal('');
  protected readonly topicTitle = computed(() => (this.topicId() ? (this.page()?.items[0]?.topicTitle ?? null) : null));

  protected readonly pageSize = IDEAS_PAGE_SIZE;
  protected readonly formatLabel = formatLabel;
  protected readonly isSimilar = isSimilar;
  protected readonly safeHref = safeHref;

  constructor() {
    effect(() => {
      this.topicId();
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
      .listIdeas({
        topicId: this.topicId() ?? null,
        status: this.status() || null,
        limit: IDEAS_PAGE_SIZE,
        offset: this.offset(),
      })
      .subscribe({
        next: (page) => {
          this.page.set(page);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(apiErrorMessage(err, 'Could not load ideas.'));
          this.loading.set(false);
        },
      });
  }

  protected onStatus(event: Event): void {
    this.offset.set(0);
    this.status.set((event.target as HTMLSelectElement).value as IdeaStatus | '');
  }

  protected goTo(offset: number): void {
    this.offset.set(Math.max(0, offset));
  }

  protected select(idea: ContentIdeaDto): void {
    if (!this.startAction(idea.id)) {
      return;
    }
    this.api.selectIdea(idea.id).subscribe({
      next: ({ scriptId, job }) => {
        this.endAction(idea.id);
        this.announcement.set(`Idea selected; drafting script.`);
        void this.router.navigate(['/content/scripts', scriptId], { queryParams: { job: job.id } });
      },
      error: (err: unknown) => {
        this.endAction(idea.id);
        this.actionError.set(apiErrorMessage(err, 'Could not select the idea.'));
      },
    });
  }

  protected discard(idea: ContentIdeaDto): void {
    if (!this.startAction(idea.id)) {
      return;
    }
    this.api.discardIdea(idea.id).subscribe({
      next: (updated) => {
        this.endAction(idea.id);
        this.page.update((p) => (p ? { ...p, items: p.items.map((i) => (i.id === updated.id ? updated : i)) } : p));
        this.announcement.set(`"${updated.title}" discarded.`);
      },
      error: (err: unknown) => {
        this.endAction(idea.id);
        this.actionError.set(apiErrorMessage(err, 'Could not discard the idea.'));
      },
    });
  }

  private startAction(id: string): boolean {
    if (this.busy().has(id)) {
      return false;
    }
    this.actionError.set(null);
    this.busy.update((s) => new Set(s).add(id));
    return true;
  }

  private endAction(id: string): void {
    this.busy.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }
}
