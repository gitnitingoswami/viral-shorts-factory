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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import type {
  CodeVerificationDto,
  JobDto,
  ScriptClaimDto,
  ScriptDetailDto,
  ScriptDto,
  ScriptVersionDto,
} from '@vsf/contracts';
import { Subscription, exhaustMap, takeWhile, timer } from 'rxjs';
import { ContentApiService } from '../../../core/api/content-api.service';
import { JobsApiService } from '../../../core/api/jobs-api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import {
  CHECKS_POLL_INTERVAL_MS,
  CHECK_LABELS,
  checksActive,
  durationWarning,
  isTerminalJob,
  pollJob,
} from '../content-labels';
import { LlmProvenanceView } from '../llm-provenance';
import { MockBanner } from '../mock-banner';
import { SCRIPT_STATUS_LABELS } from '../scripts/scripts';
import { ClaimsPanel } from './claims-panel';
import { CodeChecksPanel } from './code-checks-panel';
import { ReviewPanel } from './review-panel';
import { ScriptDecision } from './script-decision';
import { ScriptEditor } from './script-editor';
import { Storyboard } from './storyboard';

@Component({
  selector: 'app-script-workspace',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatProgressSpinnerModule,
    MockBanner,
    LlmProvenanceView,
    Storyboard,
    ClaimsPanel,
    CodeChecksPanel,
    ReviewPanel,
    ScriptDecision,
    ScriptEditor,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './script-workspace.html',
  styleUrl: './script-workspace.scss',
})
export class ScriptWorkspace implements OnInit {
  private readonly api = inject(ContentApiService);
  private readonly jobsApi = inject(JobsApiService);
  private readonly auth = inject(AuthService);
  private versionRequest: Subscription | null = null;
  private checksPoll: Subscription | null = null;
  private jobPoll: Subscription | null = null;

  /** Script id (route param). */
  readonly id = input.required<string>();
  /** Optional generation job id (query param `job`, set after selecting an idea). */
  readonly job = input<string | undefined>(undefined);

  protected readonly script = signal<ScriptDetailDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedVersion = signal<number | null>(null);
  protected readonly version = signal<ScriptVersionDto | null>(null);
  protected readonly versionLoading = signal(false);
  protected readonly versionError = signal<string | null>(null);
  protected readonly generation = signal<JobDto | null>(null);
  protected readonly editing = signal(false);
  protected readonly rerunning = signal(false);
  protected readonly announcement = signal('');

  protected readonly isOwner = this.auth.isOwner;
  protected readonly canReview = computed(() => this.auth.hasRole(['owner', 'reviewer']));
  protected readonly isCurrent = computed(() => {
    const s = this.script();
    const v = this.version();
    return !!s && !!v && v.version === s.currentVersion;
  });
  protected readonly versionsDesc = computed(() =>
    [...(this.script()?.versions ?? [])].sort((a, b) => b.version - a.version),
  );
  protected readonly durationWarning = computed(() => {
    const v = this.version();
    return v ? durationWarning(v.estDurationSec) : null;
  });
  protected readonly generating = computed(() => {
    const j = this.generation();
    return !!j && !isTerminalJob(j.status);
  });
  protected readonly checkEntries = computed(() => {
    const v = this.version();
    return v
      ? (Object.keys(CHECK_LABELS) as (keyof ScriptVersionDto['checks'])[]).map((key) => ({
          key,
          label: CHECK_LABELS[key],
          state: v.checks[key],
        }))
      : [];
  });

  protected readonly statusLabels = SCRIPT_STATUS_LABELS;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopChecksPolling();
      this.jobPoll?.unsubscribe();
      this.versionRequest?.unsubscribe();
    });
  }

  /** True while the checks poll is active (exposed for tests). */
  get pollingChecks(): boolean {
    return !!this.checksPoll && !this.checksPoll.closed;
  }

  ngOnInit(): void {
    this.load();
    const jobId = this.job();
    if (jobId) {
      this.trackGeneration(jobId);
    }
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.editing.set(false);
    this.api.getScript(this.id()).subscribe({
      next: (s) => {
        this.script.set(s);
        this.loading.set(false);
        if (s.currentVersion > 0 && s.versions.length > 0) {
          this.loadVersion(s.currentVersion);
        } else {
          this.version.set(null);
          this.selectedVersion.set(null);
        }
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err, 'Could not load the script.'));
        this.loading.set(false);
      },
    });
  }

  protected onVersionPick(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (Number.isInteger(value) && value > 0) {
      this.editing.set(false);
      this.loadVersion(value);
    }
  }

  protected loadVersion(version: number): void {
    this.stopChecksPolling();
    this.versionRequest?.unsubscribe();
    this.selectedVersion.set(version);
    this.versionLoading.set(true);
    this.versionError.set(null);
    this.versionRequest = this.api.getVersion(this.id(), version).subscribe({
      next: (v) => {
        this.version.set(v);
        this.versionLoading.set(false);
        this.ensureChecksPolling();
      },
      error: (err: unknown) => {
        this.versionError.set(apiErrorMessage(err, `Could not load version ${version}.`));
        this.versionLoading.set(false);
      },
    });
  }

  protected rerunChecks(): void {
    const v = this.version();
    if (!v || this.rerunning()) {
      return;
    }
    this.rerunning.set(true);
    this.api.rerunChecks(v.scriptId, v.version).subscribe({
      next: () => {
        this.rerunning.set(false);
        this.announcement.set('Checks re-queued.');
        this.version.update((cur) =>
          cur && cur.version === v.version
            ? { ...cur, checks: { factCheck: 'pending', quality: 'pending', code: 'pending' } }
            : cur,
        );
        this.ensureChecksPolling();
      },
      error: () => this.rerunning.set(false),
    });
  }

  protected onClaimOverridden(claim: ScriptClaimDto): void {
    this.version.update((v) =>
      v ? { ...v, claims: v.claims.map((c) => (c.id === claim.id ? claim : c)) } : v,
    );
    this.announcement.set('Claim overridden.');
    this.refreshVersion();
  }

  protected onCodeCheckOverridden(check: CodeVerificationDto): void {
    this.version.update((v) =>
      v ? { ...v, codeChecks: v.codeChecks.map((c) => (c.id === check.id ? check : c)) } : v,
    );
    this.announcement.set('Code check overridden.');
    this.refreshVersion();
  }

  protected onDecided(updated: ScriptDto): void {
    this.script.update((s) => (s ? { ...s, ...updated } : s));
    this.announcement.set(`Script ${SCRIPT_STATUS_LABELS[updated.status].toLowerCase()}.`);
    this.refreshVersion();
  }

  protected onSaved(v: ScriptVersionDto): void {
    this.editing.set(false);
    this.announcement.set(`Saved version ${v.version}.`);
    this.script.update((s) =>
      s
        ? {
            ...s,
            title: v.title,
            currentVersion: v.version,
            versions: [
              ...s.versions.filter((x) => x.version !== v.version),
              { version: v.version, authorType: v.authorType, createdAt: v.createdAt },
            ],
          }
        : s,
    );
    this.stopChecksPolling();
    this.selectedVersion.set(v.version);
    this.version.set(v);
    this.ensureChecksPolling();
  }

  protected onReloadRequested(): void {
    this.load();
  }

  /** Background re-fetch of the displayed version (blockers are recomputed server-side). */
  private refreshVersion(): void {
    const v = this.version();
    if (!v) {
      return;
    }
    this.api.getVersion(this.id(), v.version, { background: true }).subscribe({
      next: (fresh) => {
        if (this.selectedVersion() === fresh.version) {
          this.version.set(fresh);
          this.ensureChecksPolling();
        }
      },
      error: () => undefined,
    });
  }

  private ensureChecksPolling(): void {
    const v = this.version();
    if (!v || !checksActive(v.checks)) {
      this.stopChecksPolling();
      return;
    }
    if (this.pollingChecks) {
      return;
    }
    const versionNo = v.version;
    this.checksPoll = timer(CHECKS_POLL_INTERVAL_MS, CHECKS_POLL_INTERVAL_MS)
      .pipe(
        exhaustMap(() => this.api.getVersion(this.id(), versionNo, { background: true })),
        takeWhile((fresh) => checksActive(fresh.checks), true),
      )
      .subscribe({
        next: (fresh) => {
          if (this.selectedVersion() !== versionNo) {
            return;
          }
          this.version.set(fresh);
          if (!checksActive(fresh.checks)) {
            this.announcement.set('Checks finished.');
          }
        },
        // A failed poll ends this loop; the user can reload. Keep the last known state.
        error: () => undefined,
      });
  }

  private stopChecksPolling(): void {
    this.checksPoll?.unsubscribe();
    this.checksPoll = null;
  }

  private trackGeneration(jobId: string): void {
    this.jobPoll?.unsubscribe();
    this.jobsApi.get(jobId, { background: true }).subscribe({
      next: (job) => {
        this.generation.set(job);
        this.jobPoll = pollJob(this.jobsApi, job).subscribe((j) => {
          const wasRunning = this.generating();
          this.generation.set(j);
          if (j.status === 'completed' && wasRunning) {
            this.announcement.set('Script draft ready.');
            this.load();
          }
        });
      },
      error: () => this.generation.set(null),
    });
  }
}
