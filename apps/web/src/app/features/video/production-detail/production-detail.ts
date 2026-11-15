import { DatePipe } from '@angular/common';
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
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import type { VideoProductionDetailDto, VideoVersionDto } from '@vsf/contracts';
import { Subscription, catchError, exhaustMap, forkJoin, of, timer } from 'rxjs';
import { VideoApiService } from '../../../core/api/video-api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/http/notification.service';
import { safeHref } from '../../research/report/safe-markdown';
import {
  MEDIA_KIND_LABELS,
  PRODUCTION_POLL_INTERVAL_MS,
  PRODUCTION_STATUS_LABELS,
  QUALITY_CHECK_LABELS,
  STAGE_LABELS,
  canCancel,
  canRetry,
  formatBytes,
  formatMs,
  isActiveProduction,
  shortHash,
} from '../video-labels';

interface MediaUrls {
  video: string | null;
  captions: string | null;
  poster: string | null;
}

/** Media element errors trigger at most this many signed-URL refreshes per version selection. */
const MAX_URL_REFRESHES = 2;

@Component({
  selector: 'app-production-detail',
  imports: [DatePipe, RouterLink, MatButtonModule, MatProgressBarModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './production-detail.html',
  styleUrl: './production-detail.scss',
})
export class ProductionDetail implements OnInit {
  private readonly api = inject(VideoApiService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private poll: Subscription | null = null;
  private urlRequest: Subscription | null = null;
  private urlRefreshes = 0;
  private resumeAt = 0;

  /** Production id (route param). */
  readonly id = input.required<string>();

  protected readonly production = signal<VideoProductionDetailDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly selectedVersion = signal<number | null>(null);
  protected readonly urls = signal<MediaUrls | null>(null);
  protected readonly urlError = signal<string | null>(null);
  protected readonly announcement = signal('');

  protected readonly isOwner = this.auth.isOwner;
  protected readonly versionsDesc = computed(() =>
    [...(this.production()?.versions ?? [])].sort((a, b) => b.version - a.version),
  );
  protected readonly version = computed<VideoVersionDto | null>(() => {
    const n = this.selectedVersion();
    return this.versionsDesc().find((v) => v.version === n) ?? this.versionsDesc()[0] ?? null;
  });
  protected readonly quality = computed(() => this.version()?.quality ?? null);
  protected readonly failedChecks = computed(() => (this.quality()?.checks ?? []).filter((c) => c.status === 'fail'));

  protected readonly statusLabels = PRODUCTION_STATUS_LABELS;
  protected readonly stageLabels = STAGE_LABELS;
  protected readonly kindLabels = MEDIA_KIND_LABELS;
  protected readonly checkLabels = QUALITY_CHECK_LABELS;
  protected readonly canCancel = canCancel;
  protected readonly canRetry = canRetry;
  protected readonly isActive = isActiveProduction;
  protected readonly formatMs = formatMs;
  protected readonly formatBytes = formatBytes;
  protected readonly shortHash = shortHash;
  protected readonly safeHref = safeHref;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopPolling();
      this.urlRequest?.unsubscribe();
    });
  }

  /** True while the status poll is active (exposed for tests). */
  get polling(): boolean {
    return !!this.poll && !this.poll.closed;
  }

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.stopPolling();
    this.loading.set(true);
    this.error.set(null);
    this.api.getProduction(this.id()).subscribe({
      next: (p) => {
        this.loading.set(false);
        this.apply(p);
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err, 'Could not load the production.'));
        this.loading.set(false);
      },
    });
  }

  protected onVersionPick(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (Number.isInteger(value) && value > 0 && value !== this.version()?.version) {
      this.selectedVersion.set(value);
      this.loadUrls();
    }
  }

  /** The <video> failed to load (e.g. the signed URL expired): fetch fresh URLs and resume. */
  protected onMediaError(video: HTMLVideoElement): void {
    if (this.urlRefreshes >= MAX_URL_REFRESHES) {
      this.urlError.set('The video could not be loaded. Reload the page to try again.');
      return;
    }
    this.urlRefreshes++;
    this.resumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    this.loadUrls(false);
  }

  protected onMetadata(video: HTMLVideoElement): void {
    if (this.resumeAt > 0) {
      video.currentTime = this.resumeAt;
      this.resumeAt = 0;
    }
  }

  protected cancel(): void {
    const p = this.production();
    if (!p) {
      return;
    }
    this.busy.set(true);
    this.api.cancelProduction(p.id).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.production.update((cur) => (cur ? { ...cur, ...updated } : cur));
        this.notify.success('Cancellation requested.');
        this.ensurePolling();
      },
      error: () => this.busy.set(false),
    });
  }

  protected retry(): void {
    const p = this.production();
    if (!p) {
      return;
    }
    this.busy.set(true);
    this.api.retryProduction(p.id).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.notify.success(res.created ? 'Render re-queued.' : 'Already exists, opened existing production.');
        if (res.production.id !== p.id) {
          void this.router.navigate(['/video', res.production.id]);
        } else {
          this.load();
        }
      },
      error: () => this.busy.set(false),
    });
  }

  private apply(p: VideoProductionDetailDto): void {
    const before = this.production();
    this.production.set(p);
    if (before && before.status !== p.status) {
      this.announcement.set(`Status: ${PRODUCTION_STATUS_LABELS[p.status]}.`);
    }
    const latest = this.versionsDesc()[0]?.version ?? null;
    const prevLatest = before ? Math.max(0, ...before.versions.map((v) => v.version)) : null;
    // Select the latest version initially and when a new version appears.
    if (this.selectedVersion() === null || (latest !== null && prevLatest !== null && latest > prevLatest)) {
      this.selectedVersion.set(latest);
      if (latest !== null) {
        this.loadUrls();
      }
    }
    this.ensurePolling();
  }

  private loadUrls(resetRefreshes = true): void {
    const v = this.version();
    this.urlRequest?.unsubscribe();
    if (resetRefreshes) {
      this.urlRefreshes = 0;
      this.urls.set(null);
    }
    this.urlError.set(null);
    if (!v) {
      return;
    }
    const url = (assetId: string | null) =>
      assetId
        ? this.api.assetUrl(assetId).pipe(catchError(() => of(null)))
        : of(null);
    this.urlRequest = forkJoin({
      video: url(v.videoAssetId),
      captions: url(v.captionsAssetId),
      poster: url(v.thumbnailAssetId),
    }).subscribe(({ video, captions, poster }) => {
      if (!video) {
        this.urlError.set('Could not get a playback link for this version.');
      }
      this.urls.set({ video: video?.url ?? null, captions: captions?.url ?? null, poster: poster?.url ?? null });
    });
  }

  private ensurePolling(): void {
    const p = this.production();
    if (!p || !isActiveProduction(p)) {
      this.stopPolling();
      return;
    }
    if (this.polling) {
      return;
    }
    this.poll = timer(PRODUCTION_POLL_INTERVAL_MS, PRODUCTION_POLL_INTERVAL_MS)
      .pipe(exhaustMap(() => this.api.getProduction(this.id(), { background: true })))
      .subscribe({
        next: (fresh) => {
          this.apply(fresh);
          if (!isActiveProduction(fresh)) {
            this.stopPolling();
          }
        },
        error: () => this.stopPolling(),
      });
  }

  private stopPolling(): void {
    this.poll?.unsubscribe();
    this.poll = null;
  }
}
