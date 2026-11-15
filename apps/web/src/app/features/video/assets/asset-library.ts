import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import type { MediaAssetDto, MediaKind, Page } from '@vsf/contracts';
import { Subscription } from 'rxjs';
import { VideoApiService } from '../../../core/api/video-api.service';
import { apiErrorMessage } from '../../../core/http/api-error';
import { safeHref } from '../../research/report/safe-markdown';
import { ASSETS_PAGE_SIZE, MEDIA_KINDS, MEDIA_KIND_LABELS, formatBytes, shortHash } from '../video-labels';

export function isImageAsset(a: Pick<MediaAssetDto, 'mime'>): boolean {
  return a.mime.startsWith('image/');
}

export function isAudioAsset(a: Pick<MediaAssetDto, 'mime'>): boolean {
  return a.mime.startsWith('audio/');
}

@Component({
  selector: 'app-asset-library',
  imports: [DatePipe, RouterLink, MatButtonModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <h1 class="page-title">Asset library</h1>
      <div class="actions">
        <a mat-stroked-button routerLink="/video">Productions</a>
      </div>
    </div>
    <p class="muted">Every stored asset carries its license, source and usage rights.</p>

    <div class="bar">
      <label for="asset-kind">Kind</label>
      <select id="asset-kind" data-testid="asset-kind" [value]="kind()" (change)="onKind($event)">
        <option value="">All</option>
        @for (k of kinds; track k) {
          <option [value]="k">{{ kindLabels[k] }}</option>
        }
      </select>
    </div>

    <section aria-label="Asset list">
      @if (loading() && !page()) {
        <div class="state" role="status">
          <mat-spinner diameter="24" aria-label="Loading assets" />
          <span>Loading assets…</span>
        </div>
      } @else if (error(); as message) {
        <div class="state state-error" role="alert">
          <span>{{ message }}</span>
          <button mat-stroked-button type="button" (click)="load()">Retry</button>
        </div>
      } @else if (page(); as pg) {
        @if (pg.items.length === 0) {
          <p class="state" data-testid="assets-empty">No assets match this filter.</p>
        } @else {
          <div class="table-scroll">
            <table class="data-table" data-testid="assets-table">
              <thead>
                <tr>
                  <th scope="col">Preview</th>
                  <th scope="col">Kind</th>
                  <th scope="col">License</th>
                  <th scope="col">Source</th>
                  <th scope="col">Creator / provider</th>
                  <th scope="col">Usage rights</th>
                  <th scope="col">Details</th>
                  <th scope="col">SHA-256</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                @for (a of pg.items; track a.id) {
                  <tr [attr.data-asset]="a.id">
                    <td class="preview">
                      @if (isImage(a)) {
                        @if (urls()[a.id]; as src) {
                          <img [src]="src" [alt]="kindLabels[a.kind] + ' from ' + a.source" loading="lazy"
                            data-testid="asset-thumb" (error)="refresh(a)" />
                        } @else {
                          <span class="muted small">Loading…</span>
                        }
                      } @else if (isAudio(a)) {
                        @if (urls()[a.id]; as src) {
                          <audio controls preload="none" [src]="src" data-testid="asset-audio"
                            [attr.aria-label]="'Audio preview: ' + a.source" (error)="refresh(a)"></audio>
                        } @else {
                          <button mat-stroked-button type="button" data-testid="audio-preview"
                            [disabled]="pending()[a.id]" (click)="fetchUrl(a)">
                            Preview audio
                          </button>
                        }
                      } @else {
                        <span class="muted small">—</span>
                      }
                      @if (urlErrors()[a.id]) {
                        <span class="error small" role="alert">Preview unavailable.</span>
                      }
                    </td>
                    <td>{{ kindLabels[a.kind] }}{{ a.generated ? ' (generated)' : '' }}</td>
                    <td>
                      @if (a.licenseUrl && safeHref(a.licenseUrl); as href) {
                        <a [href]="href" target="_blank" rel="noopener noreferrer" data-testid="license-link">
                          {{ a.license }}<span class="visually-hidden"> (opens in a new tab)</span>
                        </a>
                      } @else {
                        {{ a.license }}
                      }
                    </td>
                    <td class="wrap">{{ a.source }}</td>
                    <td>{{ a.creatorOrProvider }}</td>
                    <td class="wrap">{{ a.usageRights }}</td>
                    <td class="small">
                      {{ a.mime }} · {{ formatBytes(a.bytes) }}
                      @if (a.width !== null && a.height !== null) {
                        · {{ a.width }}×{{ a.height }}
                      }
                      @if (a.durationMs !== null) {
                        · {{ (a.durationMs / 1000).toFixed(1) }} s
                      }
                    </td>
                    <td><code [attr.title]="a.sha256">{{ shortHash(a.sha256) }}</code></td>
                    <td>{{ a.createdAt | date: 'medium' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="bar">
            <span class="muted">{{ pg.offset + 1 }}–{{ pg.offset + pg.items.length }} of {{ pg.total }} assets</span>
            <button mat-stroked-button type="button" [disabled]="pg.offset === 0" (click)="goTo(pg.offset - pageSize)">
              Previous
            </button>
            <button
              mat-stroked-button
              type="button"
              [disabled]="pg.offset + pg.items.length >= pg.total"
              (click)="goTo(pg.offset + pageSize)"
            >
              Next
            </button>
          </div>
        }
      }
    </section>
  `,
  styles: `
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin: 12px 0;
    }
    select {
      font: var(--mat-sys-body-medium);
      padding: 4px 6px;
    }
    .preview img {
      display: block;
      max-width: 72px;
      max-height: 128px;
      border-radius: 4px;
      background: var(--mat-sys-surface-container);
    }
    .preview audio {
      max-width: 220px;
    }
    .wrap {
      overflow-wrap: anywhere;
      max-width: 260px;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .error {
      display: block;
      color: var(--mat-sys-error);
    }
  `,
})
export class AssetLibrary implements OnInit {
  private readonly api = inject(VideoApiService);
  private request: Subscription | null = null;
  private readonly urlRequests = new Subscription();
  private readonly refreshed = new Set<string>();

  protected readonly kind = signal<MediaKind | ''>('');
  protected readonly offset = signal(0);
  protected readonly page = signal<Page<MediaAssetDto> | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly urls = signal<Record<string, string>>({});
  protected readonly pending = signal<Record<string, boolean>>({});
  protected readonly urlErrors = signal<Record<string, boolean>>({});

  protected readonly kinds = MEDIA_KINDS;
  protected readonly kindLabels = MEDIA_KIND_LABELS;
  protected readonly pageSize = ASSETS_PAGE_SIZE;
  protected readonly isImage = isImageAsset;
  protected readonly isAudio = isAudioAsset;
  protected readonly formatBytes = formatBytes;
  protected readonly shortHash = shortHash;
  protected readonly safeHref = safeHref;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.request?.unsubscribe();
      this.urlRequests.unsubscribe();
    });
  }

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.request = this.api
      .listAssets({ kind: this.kind() || null, limit: ASSETS_PAGE_SIZE, offset: this.offset() })
      .subscribe({
        next: (page) => {
          this.page.set(page);
          this.loading.set(false);
          this.urls.set({});
          this.urlErrors.set({});
          this.refreshed.clear();
          // Image thumbnails load with the page; audio is fetched only when the user asks for a preview.
          page.items.filter(isImageAsset).forEach((a) => this.fetchUrl(a));
        },
        error: (err: unknown) => {
          this.error.set(apiErrorMessage(err, 'Could not load assets.'));
          this.loading.set(false);
        },
      });
  }

  protected onKind(event: Event): void {
    this.offset.set(0);
    this.kind.set((event.target as HTMLSelectElement).value as MediaKind | '');
    this.load();
  }

  protected goTo(offset: number): void {
    this.offset.set(Math.max(0, offset));
    this.load();
  }

  protected fetchUrl(a: MediaAssetDto): void {
    this.pending.update((p) => ({ ...p, [a.id]: true }));
    this.urlErrors.update((e) => ({ ...e, [a.id]: false }));
    this.urlRequests.add(
      this.api.assetUrl(a.id).subscribe({
        next: (signed) => {
          this.urls.update((u) => ({ ...u, [a.id]: signed.url }));
          this.pending.update((p) => ({ ...p, [a.id]: false }));
        },
        error: () => {
          this.urlErrors.update((e) => ({ ...e, [a.id]: true }));
          this.pending.update((p) => ({ ...p, [a.id]: false }));
        },
      }),
    );
  }

  /** The element failed to load (signed URL likely expired): fetch a fresh URL once. */
  protected refresh(a: MediaAssetDto): void {
    if (this.refreshed.has(a.id)) {
      this.urlErrors.update((e) => ({ ...e, [a.id]: true }));
      return;
    }
    this.refreshed.add(a.id);
    this.fetchUrl(a);
  }
}
