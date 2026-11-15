import type {
  MediaKind,
  ProductionStatus,
  QualityCheckStatus,
  RenderSettings,
  RenderStage,
  VideoProductionDto,
  VoiceProfileDto,
} from '@vsf/contracts';

export const PRODUCTION_POLL_INTERVAL_MS = 3_000;
export const PRODUCTIONS_PAGE_SIZE = 25;
export const ASSETS_PAGE_SIZE = 25;

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  queued: 'Queued',
  rendering: 'Rendering',
  ready: 'Ready',
  quality_failed: 'Quality failed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
export const PRODUCTION_STATUSES = Object.keys(PRODUCTION_STATUS_LABELS) as ProductionStatus[];

export const STAGE_LABELS: Record<RenderStage, string> = {
  queued: 'Waiting in queue',
  narration: 'Synthesizing narration',
  frames: 'Rendering frames',
  compose: 'Composing video',
  quality: 'Running quality checks',
  done: 'Done',
};

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  image: 'Image',
  audio: 'Audio',
  font: 'Font',
  music: 'Music',
  code_frame: 'Code frame',
  video: 'Video',
  captions: 'Captions',
};
export const MEDIA_KINDS = Object.keys(MEDIA_KIND_LABELS) as MediaKind[];

export const QUALITY_CHECK_LABELS: Record<QualityCheckStatus, { icon: string; text: string }> = {
  pass: { icon: '✓', text: 'Pass' },
  warn: { icon: '!', text: 'Warning' },
  fail: { icon: '✕', text: 'Fail' },
};

export const VOICE_QUALITY_LABELS: Record<VoiceProfileDto['quality'], string> = {
  production: 'Production',
  draft: 'Draft',
  mock: 'Mock',
};

/** Warning text for non-publishable voices, null for production voices. */
export function voiceWarning(quality: VoiceProfileDto['quality']): string | null {
  switch (quality) {
    case 'draft':
      return 'Robotic placeholder voice, replace before publishing.';
    case 'mock':
      return 'Test tone, not publishable.';
    default:
      return null;
  }
}

export const RENDER_SIZES: readonly { width: number; height: number; label: string }[] = [
  { width: 1080, height: 1920, label: '1080 × 1920 (Full HD)' },
  { width: 720, height: 1280, label: '720 × 1280 (HD)' },
];
export const RENDER_FPS: readonly RenderSettings['fps'][] = [24, 25, 30, 60];

const ACTIVE: readonly ProductionStatus[] = ['queued', 'rendering'];
const RETRYABLE: readonly ProductionStatus[] = ['failed', 'quality_failed', 'cancelled'];

export function isActiveProduction(p: Pick<VideoProductionDto, 'status'>): boolean {
  return ACTIVE.includes(p.status);
}

export function canCancel(p: Pick<VideoProductionDto, 'status' | 'cancelRequested'>): boolean {
  return ACTIVE.includes(p.status) && !p.cancelRequested;
}

export function canRetry(p: Pick<VideoProductionDto, 'status'>): boolean {
  return RETRYABLE.includes(p.status);
}

/** "m:ss.s" for a millisecond offset. */
export function formatMs(ms: number): string {
  const totalSec = Math.max(0, ms) / 1000;
  const minutes = Math.floor(totalSec / 60);
  const seconds = (totalSec - minutes * 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${seconds}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function shortHash(hash: string, length = 12): string {
  return hash.length > length ? `${hash.slice(0, length)}…` : hash;
}
