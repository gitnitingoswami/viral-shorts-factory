import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { UserRole, VideoProductionDetailDto } from '@vsf/contracts';
import { NotificationService } from '../../../core/http/notification.service';
import { makeProduction, makeProductionDetail, signInAs } from '../../../testing/fixtures';
import { PRODUCTION_POLL_INTERVAL_MS } from '../video-labels';
import { ProductionDetail } from './production-detail';

const DETAIL = '/api/video/productions/p1';
const signed = (id: string) => ({ url: `/api/video/media/${id}?exp=1&sig=s`, expiresAt: '2026-11-15T03:00:00.000Z' });

describe('ProductionDetail', () => {
  let fixture: ComponentFixture<ProductionDetail>;
  let httpMock: HttpTestingController;
  let el: HTMLElement;

  const q = <T extends Element = HTMLElement>(sel: string): T | null => el.querySelector<T>(sel);
  const isPolling = (): boolean => (fixture.componentInstance as unknown as { polling: boolean }).polling;

  function flushUrls(ids = ['a-video', 'a-vtt', 'a-thumb']): void {
    for (const id of ids) {
      httpMock.expectOne(`/api/video/assets/${id}/url`).flush(signed(id));
    }
  }

  function create(
    role: UserRole,
    detail: VideoProductionDetailDto = makeProductionDetail(),
    urlIds = ['a-video', 'a-vtt', 'a-thumb'],
  ): void {
    signInAs(role);
    fixture = TestBed.createComponent(ProductionDetail);
    fixture.componentRef.setInput('id', 'p1');
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    httpMock.expectOne(DETAIL).flush(detail);
    if (detail.versions.length) {
      flushUrls(urlIds);
    }
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ProductionDetail],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(NotificationService), 'success').mockImplementation(() => undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    fixture?.destroy();
    httpMock.verify();
    vi.useRealTimers();
  });

  it('plays the latest version via signed URLs with captions track and poster', () => {
    create('reviewer');
    const video = q<HTMLVideoElement>('[data-testid="video-player"]') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('/api/video/media/a-video?exp=1&sig=s');
    expect(video.getAttribute('poster')).toBe('/api/video/media/a-thumb?exp=1&sig=s');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    const track = q<HTMLTrackElement>('[data-testid="captions-track"]') as HTMLTrackElement;
    expect(track.getAttribute('src')).toBe('/api/video/media/a-vtt?exp=1&sig=s');
    expect(track.getAttribute('kind')).toBe('captions');
    expect(track.getAttribute('srclang')).toBe('en');
    expect(track.hasAttribute('default')).toBe(true);
    // Reviewers have no actions; a single version has no picker.
    expect(q('[data-testid="retry-production"]')).toBeNull();
    expect(q('[data-testid="video-version-picker"]')).toBeNull();
  });

  it('refreshes signed URLs when the video fails to load', () => {
    create('reviewer');
    (q('[data-testid="video-player"]') as HTMLVideoElement).dispatchEvent(new Event('error'));
    flushUrls();
  });

  it('renders every check status with text, measured vs expected', () => {
    create('reviewer');
    const report = q('[data-testid="quality-report"]') as HTMLElement;
    expect(report.querySelector('[data-quality-check="duration"] [data-testid="check-status"]')?.textContent).toContain('Pass');
    expect(report.querySelector('[data-quality-check="voice"] [data-testid="check-status"]')?.textContent).toContain('Warning');
    expect(report.textContent).toContain('Measured: 32.0 s · Expected: 20–60 s');
    expect(q('[data-testid="quality-failures"]')).toBeNull();
  });

  it('makes quality failures prominent and offers retry to owners', () => {
    const base = makeProductionDetail();
    const v = base.versions[0];
    create(
      'owner',
      makeProductionDetail({
        status: 'quality_failed',
        versions: [
          {
            ...v,
            quality: {
              ...v.quality!,
              passed: false,
              checks: [...v.quality!.checks, { id: 'loudness', label: 'Loudness', status: 'fail', detail: 'Too quiet', measured: '-30 LUFS', expected: '-16 ± 2 LUFS' }],
              failures: ['Loudness -30 LUFS is outside -16 ± 2 LUFS'],
            },
          },
        ],
      }),
    );
    const failures = q('[data-testid="quality-failures"]') as HTMLElement;
    expect(failures.textContent).toContain('Not publishable');
    expect(failures.textContent).toContain('Loudness -30 LUFS is outside -16 ± 2 LUFS');
    expect(q('[data-quality-check="loudness"] [data-testid="check-status"]')?.textContent).toContain('Fail');
    expect(q('[data-testid="quality-verdict"]')?.textContent).toContain('Failed: 1 blocking issue');

    (q('[data-testid="retry-production"]') as HTMLButtonElement).click();
    const retry = httpMock.expectOne(`${DETAIL}/retry`);
    retry.flush({ production: { ...base, status: 'queued' }, job: null, created: true });
    httpMock.expectOne(DETAIL).flush(makeProductionDetail({ status: 'queued', stage: 'queued', progress: 0 }));
    fixture.detectChanges();
    expect(isPolling()).toBe(true);
  });

  it('shows asset rights metadata with safe license links', () => {
    create('reviewer');
    const table = q('[data-testid="production-assets"]') as HTMLElement;
    const row = table.querySelector('[data-asset="a-img"]') as HTMLElement;
    expect(row.textContent).toContain('frame · scene 1');
    expect(row.textContent).toContain('generated:frame-renderer@1');
    expect(row.textContent).toContain('Viral Shorts Factory');
    expect(row.textContent).toContain('Original work; unrestricted use');
    const link = row.querySelector('[data-testid="license-link"]') as HTMLAnchorElement;
    expect(link.textContent).toContain('CC0-1.0');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
    const hash = row.querySelector('code') as HTMLElement;
    expect(hash.getAttribute('title')).toHaveLength(64);
    expect(hash.textContent).toContain('0123456789ab…');
    const audio = table.querySelector('[data-asset="a-audio"]') as HTMLElement;
    expect(audio.textContent).toContain('GPL-3.0 output');
    expect(audio.querySelector('[data-testid="license-link"]')).toBeNull();
  });

  it('polls while rendering, then loads the new video', () => {
    create('owner', makeProductionDetail({ status: 'rendering', stage: 'frames', progress: 30, versions: [], latestVersion: null }));
    expect(q('[data-testid="no-video"]')).not.toBeNull();
    expect(q('[data-testid="cancel-production"]')).not.toBeNull();
    expect(isPolling()).toBe(true);
    vi.advanceTimersByTime(PRODUCTION_POLL_INTERVAL_MS);
    httpMock.expectOne(DETAIL).flush(makeProductionDetail());
    flushUrls();
    fixture.detectChanges();
    expect(isPolling()).toBe(false);
    expect(q('[data-testid="detail-announcement"]')?.textContent).toContain('Ready');
    expect(q('[data-testid="video-player"]')).not.toBeNull();
    vi.advanceTimersByTime(PRODUCTION_POLL_INTERVAL_MS * 2);
    httpMock.expectNone(DETAIL);
  });

  it('owner cancels an active render', () => {
    create('owner', makeProductionDetail({ status: 'queued', stage: 'queued', progress: 0, versions: [] }));
    (q('[data-testid="cancel-production"]') as HTMLButtonElement).click();
    httpMock
      .expectOne(`${DETAIL}/cancel`)
      .flush(makeProduction({ status: 'cancelled', stage: 'queued', progress: 0 }));
    fixture.detectChanges();
    expect(q('[data-testid="production-status-chip"]')?.textContent).toContain('Cancelled');
    expect(isPolling()).toBe(false);
  });

  it('switches between versions', () => {
    const base = makeProductionDetail();
    const v1 = base.versions[0];
    create('reviewer', makeProductionDetail({ versions: [v1, { ...v1, id: 'vv2', version: 2, videoAssetId: 'b-video', captionsAssetId: null, thumbnailAssetId: null }] }), ['b-video']);
    expect(q('[data-testid="captions-track"]')).toBeNull();
    const picker = q('[data-testid="video-version-picker"]') as HTMLSelectElement;
    expect(picker.value).toBe('2');
    picker.value = '1';
    picker.dispatchEvent(new Event('change'));
    flushUrls();
    fixture.detectChanges();
    expect(q('[data-testid="video-player"]')?.getAttribute('src')).toContain('a-video');
  });
});
