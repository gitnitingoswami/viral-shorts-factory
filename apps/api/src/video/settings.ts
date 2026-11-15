import { createHash } from 'node:crypto';
import type { RenderSettings } from '@vsf/contracts';
import type { AppEnv } from '../config/env.schema';
import { canonicalJson } from '../content/content-utils';

export const ALLOWED_FPS = [24, 25, 30, 60] as const;
/** 9:16 sizes accepted for Shorts (width × height). */
export const ALLOWED_SIZES: ReadonlyArray<readonly [number, number]> = [
  [720, 1280],
  [1080, 1920],
];

export class InvalidSettingsError extends Error {}

export function defaultSettings(env: Pick<AppEnv, 'RENDER_WIDTH' | 'RENDER_HEIGHT' | 'RENDER_FPS' | 'RENDER_VIDEO_BITRATE_KBPS'>): RenderSettings {
  return {
    width: env.RENDER_WIDTH,
    height: env.RENDER_HEIGHT,
    fps: env.RENDER_FPS as RenderSettings['fps'],
    codec: 'h264',
    videoBitrateKbps: env.RENDER_VIDEO_BITRATE_KBPS,
    audioBitrateKbps: 160,
    minDurationSec: 20,
    maxDurationSec: 60,
    burnCaptions: true,
  };
}

/** Merges overrides onto defaults and validates the result (throws InvalidSettingsError with a readable message). */
export function resolveSettings(defaults: RenderSettings, overrides: Partial<RenderSettings> | undefined): RenderSettings {
  const s: RenderSettings = { ...defaults, ...(overrides ?? {}) };
  const errors: string[] = [];
  if (!ALLOWED_SIZES.some(([w, h]) => w === s.width && h === s.height)) {
    errors.push(`size must be one of ${ALLOWED_SIZES.map(([w, h]) => `${w}x${h}`).join(', ')} (9:16)`);
  }
  if (!(ALLOWED_FPS as readonly number[]).includes(s.fps)) errors.push(`fps must be one of ${ALLOWED_FPS.join(', ')}`);
  if (s.codec !== 'h264') errors.push('codec must be h264');
  if (!Number.isInteger(s.videoBitrateKbps) || s.videoBitrateKbps < 500 || s.videoBitrateKbps > 50_000) errors.push('videoBitrateKbps must be 500..50000');
  if (!Number.isInteger(s.audioBitrateKbps) || s.audioBitrateKbps < 64 || s.audioBitrateKbps > 320) errors.push('audioBitrateKbps must be 64..320');
  if (!Number.isInteger(s.minDurationSec) || !Number.isInteger(s.maxDurationSec) || s.minDurationSec < 1 || s.maxDurationSec > 180 || s.minDurationSec >= s.maxDurationSec) {
    errors.push('duration window must satisfy 1 <= minDurationSec < maxDurationSec <= 180');
  }
  if (typeof s.burnCaptions !== 'boolean') errors.push('burnCaptions must be a boolean');
  const unknown = Object.keys(overrides ?? {}).filter((k) => !(k in defaults));
  if (unknown.length) errors.push(`unknown settings: ${unknown.join(', ')}`);
  if (errors.length) throw new InvalidSettingsError(errors.join('; '));
  return s;
}

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

export function settingsHash(s: RenderSettings): string {
  return sha256(canonicalJson(s));
}
