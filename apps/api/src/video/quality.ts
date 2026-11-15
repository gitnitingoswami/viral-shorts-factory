import type { CaptionCue, QualityCheckDto, RenderSettings } from '@vsf/contracts';
import { validateCues } from './captions';
import { durationMs, parseRate, ProbeResult } from './ffmpeg';

export const QUALITY_REF = 'quality@1';
/** Max allowed difference between the audio and video stream durations. */
export const MAX_AV_DRIFT_MS = 100;
export const LOUDNESS_TARGET = -14;

export interface QualityInput {
  settings: RenderSettings;
  probe: ProbeResult;
  /** Decoder error text from a full decode ('' = clean). */
  decodeErrors: string;
  loudnessLufs: number | null;
  cues: CaptionCue[];
  /** Production assets that are missing from storage or have the wrong size. */
  missingAssets: string[];
  voiceQuality: 'draft' | 'mock' | 'production';
  /** Storyboard transitions other than "cut" (rendered as cuts in v1). */
  simplifiedTransitions: number;
  truncatedCodeLines: number;
  headlineOverflows: number;
  /** Planned timeline length (sum of scene lengths): both streams must match it. */
  expectedDurationMs: number;
}

const check = (id: string, label: string, status: QualityCheckDto['status'], detail: string, measured: string | null = null, expected: string | null = null): QualityCheckDto => ({
  id,
  label,
  status,
  detail,
  measured,
  expected,
});

/** Evaluates the rendered file and its inputs. `fail` blocks the version from being publishable; `warn` is advisory. */
export function evaluateQuality(q: QualityInput): QualityCheckDto[] {
  const s = q.settings;
  const v = q.probe.streams.find((x) => x.codec_type === 'video');
  const a = q.probe.streams.find((x) => x.codec_type === 'audio');
  const checks: QualityCheckDto[] = [];

  if (!v) {
    checks.push(check('video.stream', 'Video stream', 'fail', 'No video stream in the output'));
  } else {
    const dimsOk = v.width === s.width && v.height === s.height;
    checks.push(check('video.dimensions', 'Dimensions (9:16)', dimsOk ? 'pass' : 'fail', dimsOk ? 'Matches the requested size' : 'Output size differs from the settings', `${v.width}x${v.height}`, `${s.width}x${s.height}`));
    const codecOk = v.codec_name === 'h264' && v.pix_fmt === 'yuv420p';
    checks.push(check('video.codec', 'Codec / pixel format', codecOk ? 'pass' : 'fail', codecOk ? 'H.264, yuv420p (widely playable)' : 'Unexpected codec or pixel format', `${v.codec_name}/${v.pix_fmt}`, 'h264/yuv420p'));
    const fps = parseRate(v.r_frame_rate);
    const fpsOk = Math.abs(fps - s.fps) < 0.01;
    checks.push(check('video.fps', 'Frame rate', fpsOk ? 'pass' : 'fail', fpsOk ? 'Constant frame rate as requested' : 'Frame rate differs from the settings', fps.toFixed(2), String(s.fps)));
  }

  const totalMs = durationMs(q.probe);
  const inWindow = totalMs >= s.minDurationSec * 1000 && totalMs <= s.maxDurationSec * 1000;
  checks.push(
    check('video.duration', 'Duration', inWindow ? 'pass' : 'fail', inWindow ? 'Within the Shorts window' : 'Outside the allowed duration window', `${(totalMs / 1000).toFixed(2)} s`, `${s.minDurationSec}–${s.maxDurationSec} s`),
  );

  if (!a) {
    checks.push(check('audio.present', 'Narration audio', 'fail', 'No audio stream in the output', null, 'aac'));
  } else {
    checks.push(check('audio.present', 'Narration audio', a.codec_name === 'aac' ? 'pass' : 'fail', `${a.codec_name}, ${a.sample_rate} Hz, ${a.channels} ch`, a.codec_name, 'aac'));
    if (v) {
      // Narration is placed per scene on the planned timeline, and frames follow the same timeline; each stream
      // must match the plan (a stream that is shorter, longer or offset shows up here), and each other.
      const vd = durationMs(q.probe, 'video');
      const ad = durationMs(q.probe, 'audio');
      const drift = Math.max(Math.abs(vd - ad), Math.abs(vd - q.expectedDurationMs), Math.abs(ad - q.expectedDurationMs));
      const ok = drift <= MAX_AV_DRIFT_MS;
      checks.push(
        check('av.sync', 'Audio/video sync', ok ? 'pass' : 'fail', ok ? 'Video, narration and the scene timeline line up' : `Streams drift from the timeline (video ${vd} ms, audio ${ad} ms, plan ${q.expectedDurationMs} ms)`, `${drift} ms`, `≤ ${MAX_AV_DRIFT_MS} ms`),
      );
    }
  }

  if (q.loudnessLufs === null) {
    checks.push(check('audio.loudness', 'Loudness', 'warn', 'Could not measure integrated loudness', null, `${LOUDNESS_TARGET} LUFS`));
  } else {
    const off = Math.abs(q.loudnessLufs - LOUDNESS_TARGET);
    const status = off <= 2 ? 'pass' : off <= 5 ? 'warn' : 'fail';
    checks.push(check('audio.loudness', 'Loudness', status, status === 'pass' ? 'Normalized for YouTube playback' : 'Loudness is off target', `${q.loudnessLufs.toFixed(1)} LUFS`, `${LOUDNESS_TARGET} ±2 LUFS`));
  }

  if (s.burnCaptions) {
    const issues = validateCues(q.cues, totalMs);
    const fails = issues.filter((i) => i.severity === 'fail');
    const warns = issues.filter((i) => i.severity === 'warn');
    checks.push(
      check('captions.bounds', 'Caption bounds', fails.length ? 'fail' : 'pass', fails.length ? fails.map((i) => i.message).slice(0, 5).join('; ') : `${q.cues.length} cues inside the caption safe area`, `${fails.length} issues`, '0 issues'),
      check('captions.timing', 'Caption timing', warns.length ? 'warn' : 'pass', warns.length ? warns.map((i) => i.message).slice(0, 5).join('; ') : 'Readable durations and pace', `${warns.length} issues`, '0 issues'),
    );
  } else {
    checks.push(check('captions.bounds', 'Caption bounds', 'warn', 'Captions are not burned in; upload the WebVTT file instead'));
  }

  checks.push(
    check(
      'assets.present',
      'Assets present',
      q.missingAssets.length ? 'fail' : 'pass',
      q.missingAssets.length ? `Missing or corrupt: ${q.missingAssets.slice(0, 5).join(', ')}` : 'Every production asset is stored with matching size',
      `${q.missingAssets.length} missing`,
      '0 missing',
    ),
  );
  checks.push(check('render.integrity', 'Render integrity', q.decodeErrors ? 'fail' : 'pass', q.decodeErrors ? `Decoder errors: ${q.decodeErrors.slice(0, 200)}` : 'Full decode without errors'));

  const voice =
    q.voiceQuality === 'production'
      ? check('voice.publishable', 'Voice', 'pass', 'Production voice')
      : q.voiceQuality === 'draft'
        ? check('voice.publishable', 'Voice', 'warn', 'Draft voice (eSpeak NG): replace with a production TTS voice before publishing')
        : check('voice.publishable', 'Voice', 'fail', 'Mock tone instead of narration: test render only, not publishable');
  checks.push(voice);

  if (q.simplifiedTransitions > 0) checks.push(check('visual.transitions', 'Transitions', 'warn', `${q.simplifiedTransitions} storyboard transition(s) rendered as cuts (v1 renderer)`));
  if (q.truncatedCodeLines > 0) checks.push(check('visual.code', 'Code readability', 'warn', `${q.truncatedCodeLines} code line(s) shortened to fit the frame`));
  if (q.headlineOverflows > 0) checks.push(check('visual.headline', 'On-screen text', 'warn', `${q.headlineOverflows} headline(s) did not fit and were shortened`));

  const fmtBitrate = Number(q.probe.format.bit_rate ?? 0) / 1000;
  if (fmtBitrate > (s.videoBitrateKbps + s.audioBitrateKbps) * 1.6) {
    checks.push(check('video.bitrate', 'Bitrate', 'warn', 'Average bitrate well above target', `${Math.round(fmtBitrate)} kbps`, `≈ ${s.videoBitrateKbps + s.audioBitrateKbps} kbps`));
  }
  return checks;
}

/**
 * passed = no failing check (the render is technically sound).
 * publishable = passed and narrated by a production voice: the gate any publishing step must use.
 */
export function summarize(checks: QualityCheckDto[]): { passed: boolean; publishable: boolean; failures: string[] } {
  const failures = checks.filter((c) => c.status === 'fail').map((c) => `${c.label}: ${c.detail}`);
  const voiceOk = checks.find((c) => c.id === 'voice.publishable')?.status === 'pass';
  return { passed: failures.length === 0, publishable: failures.length === 0 && voiceOk, failures };
}
