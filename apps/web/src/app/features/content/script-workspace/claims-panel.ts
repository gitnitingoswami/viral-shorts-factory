import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import type { ScriptClaimDto } from '@vsf/contracts';
import { ContentApiService } from '../../../core/api/content-api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import { safeHref } from '../../research/report/safe-markdown';
import { VERDICT_LABELS, canOverrideClaim } from '../content-labels';
import { OverrideForm } from '../override-form';

/** Fact-check claims with verdicts and evidence; owners can override unsupported/contradicted claims. */
@Component({
  selector: 'app-claims-panel',
  imports: [OverrideForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (claims().length === 0) {
      <p class="muted">No factual claims were extracted.</p>
    } @else {
      <ul class="claims" data-testid="claims">
        @for (c of claims(); track c.id) {
          <li [attr.data-claim]="c.id">
            <div class="row">
              <span class="chip chip-{{ c.verdict }}" data-testid="verdict">{{ labels[c.verdict] }}</span>
              <span class="muted">Scene {{ c.sceneIndex + 1 }}</span>
            </div>
            <p class="text">{{ c.text }}</p>
            @if (c.evidence) {
              <blockquote class="evidence">“{{ c.evidence }}”</blockquote>
            }
            @if (c.sourceRef; as src) {
              @if (safeHref(src.url); as href) {
                <a [href]="href" target="_blank" rel="noopener noreferrer" data-testid="claim-source">
                  {{ src.title || href }}<span class="visually-hidden"> (opens in a new tab)</span>
                </a>
              } @else {
                <span>{{ src.title || src.url }}</span>
              }
            }
            @if (c.overrideReason) {
              <p class="muted small">Override reason: {{ c.overrideReason }}</p>
            }
            @if (isOwner() && canOverride(c.verdict)) {
              <app-override-form
                [subject]="'claim in scene ' + (c.sceneIndex + 1)"
                [fieldId]="'claim-override-' + c.id"
                [busy]="busyId() === c.id"
                [errorMessage]="errors()[c.id] ?? null"
                (confirm)="override(c, $event)"
              />
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .claims {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      padding: 10px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      overflow-wrap: anywhere;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .text {
      margin: 6px 0;
    }
    .evidence {
      margin: 4px 0;
      padding-left: 10px;
      border-left: 3px solid var(--mat-sys-outline);
      font-style: italic;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
  `,
})
export class ClaimsPanel {
  private readonly api = inject(ContentApiService);

  readonly claims = input.required<ScriptClaimDto[]>();
  readonly overridden = output<ScriptClaimDto>();

  protected readonly isOwner = inject(AuthService).isOwner;
  protected readonly busyId = signal<string | null>(null);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly labels = VERDICT_LABELS;
  protected readonly canOverride = canOverrideClaim;
  protected readonly safeHref = safeHref;

  protected override(claim: ScriptClaimDto, reason: string): void {
    if (this.busyId()) {
      return;
    }
    this.busyId.set(claim.id);
    this.errors.update(({ [claim.id]: _removed, ...rest }) => rest);
    this.api.overrideClaim(claim.id, reason).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.overridden.emit(updated);
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.errors.update((e) => ({ ...e, [claim.id]: apiErrorMessage(err, 'Override failed.') }));
      },
    });
  }
}
