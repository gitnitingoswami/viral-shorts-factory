import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RenderSettings } from '@vsf/contracts';
import { run } from './process';

export interface FfmpegBins {
  ffmpeg: string;
  ffprobe: string;
}

export interface ProbeStream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  bit_rate?: string;
}

export interface ProbeResult {
  streams: ProbeStream[];
  format: { duration?: string; bit_rate?: string; size?: string; format_name?: string };
}

export interface StepOpts {
  signal?: AbortSignal;
  timeoutMs: number;
}

export async function probe(bins: FfmpegBins, file: string, opts: StepOpts): Promise<ProbeResult> {
  const { stdout } = await run(bins.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], opts);
  return JSON.parse(stdout.toString('utf8')) as ProbeResult;
}

export function durationMs(p: ProbeResult, type?: 'video' | 'audio'): number {
  const s = type ? p.streams.find((x) => x.codec_type === type) : undefined;
  const d = Number(s?.duration ?? p.format.duration ?? 0);
  return Math.round(d * 1000);
}

/** Any input audio → 48 kHz mono 16-bit WAV with leading/trailing silence trimmed. */
export async function normalizeSpeech(bins: FfmpegBins, input: string, output: string, opts: StepOpts): Promise<void> {
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse';
  await run(bins.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-i', input, '-af', trim, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', output], opts);
}

export interface ComposeScene {
  /** Normalized speech WAV for the scene. */
  audioPath: string;
  /** Scene length (speech + padding). */
  durationMs: number;
  /** Frames shown during the scene, each for `ms` (sums to durationMs). */
  frames: Array<{ path: string; ms: number }>;
}

export interface ComposeInput {
  workDir: string;
  scenes: ComposeScene[];
  settings: RenderSettings;
  output: string;
  onProgress?: (fraction: number) => void;
}

/**
 * Builds the final MP4: frames via the concat demuxer (exact per-frame durations), narration padded per scene,
 * concatenated and loudness-normalized (two-pass) to −14 LUFS (YouTube's playback reference), H.264 + AAC, faststart.
 */
export async function compose(bins: FfmpegBins, input: ComposeInput, opts: StepOpts): Promise<void> {
  const { settings: s, scenes, workDir } = input;
  const totalMs = scenes.reduce((a, sc) => a + sc.durationMs, 0);
  const totalSec = (totalMs / 1000).toFixed(3);

  // Frame list (concat demuxer). The last file is repeated so its duration is honored.
  const lines = ['ffconcat version 1.0'];
  const all = scenes.flatMap((sc) => sc.frames);
  for (const f of all) lines.push(`file '${f.path.replace(/'/g, "'\\''")}'`, `duration ${(f.ms / 1000).toFixed(3)}`);
  lines.push(`file '${all[all.length - 1].path.replace(/'/g, "'\\''")}'`);
  const listPath = join(workDir, 'frames.ffconcat');
  await writeFile(listPath, `${lines.join('\n')}\n`);

  // Pass 1: narration track (each scene padded to its length, gently compressed) + loudness measurement.
  const narration = join(workDir, 'narration.wav');
  const aArgs = ['-hide_banner', '-nostdin', '-y', '-v', 'error'];
  for (const sc of scenes) aArgs.push('-i', sc.audioPath);
  const pads = scenes.map((sc, i) => `[${i}:a]apad=whole_dur=${(sc.durationMs / 1000).toFixed(3)},atrim=0:${(sc.durationMs / 1000).toFixed(3)}[a${i}]`);
  aArgs.push('-filter_complex', [...pads, `${scenes.map((_, i) => `[a${i}]`).join('')}concat=n=${scenes.length}:v=0:a=1,${SPEECH_COMPRESSOR}[a]`].join(';'), '-map', '[a]', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', narration);
  await run(bins.ffmpeg, aArgs, opts);
  const m = await measureLoudness(bins, narration, opts);

  // Pass 2: frames + normalized narration → MP4.
  const args = ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-progress', 'pipe:1', '-nostats', '-f', 'concat', '-safe', '0', '-i', listPath, '-i', narration];
  const fadeOut = Math.max(0, totalMs / 1000 - 0.3).toFixed(3);
  const norm = m
    ? `loudnorm=I=${LOUDNESS_I}:TP=${LOUDNESS_TP}:LRA=${LOUDNESS_LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
    : `loudnorm=I=${LOUDNESS_I}:TP=${LOUDNESS_TP}:LRA=${LOUDNESS_LRA}`;
  const filter = [
    `[0:v]fps=${s.fps},scale=${s.width}:${s.height}:flags=lanczos,format=yuv420p,fade=t=in:st=0:d=0.15,fade=t=out:st=${fadeOut}:d=0.3[v]`,
    `[1:a]${norm},aresample=48000,afade=t=out:st=${fadeOut}:d=0.3[a]`,
  ].join(';');
  args.push(
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    '-t', totalSec,
    '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-b:v', `${s.videoBitrateKbps}k`, '-maxrate', `${Math.round(s.videoBitrateKbps * 1.5)}k`, '-bufsize', `${s.videoBitrateKbps * 2}k`,
    '-g', String(s.fps * 2), '-r', String(s.fps),
    '-c:a', 'aac', '-b:a', `${s.audioBitrateKbps}k`, '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    input.output,
  );
  let buf = '';
  await run(bins.ffmpeg, args, {
    ...opts,
    onStdout: (chunk) => {
      buf += chunk;
      const m = [...buf.matchAll(/out_time_us=(\d+)/g)].pop();
      if (m && input.onProgress) input.onProgress(Math.min(1, Number(m[1]) / 1000 / totalMs));
      if (buf.length > 8192) buf = buf.slice(-1024);
    },
  });
}

export const LOUDNESS_I = -14;
export const LOUDNESS_TP = -1.5;
export const LOUDNESS_LRA = 11;
/** Speech compression before normalization: lowers the crest factor so −14 LUFS is reachable under the −1.5 dBTP ceiling. */
export const SPEECH_COMPRESSOR = 'acompressor=threshold=-24dB:ratio=4:attack=5:release=80:makeup=2';

interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/** First pass of two-pass loudnorm (accurate for short, gappy speech where single-pass undershoots). */
export async function measureLoudness(bins: FfmpegBins, file: string, opts: StepOpts): Promise<LoudnormMeasurement | null> {
  const { stderr } = await run(bins.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'info', '-i', file, '-af', `loudnorm=I=${LOUDNESS_I}:TP=${LOUDNESS_TP}:LRA=${LOUDNESS_LRA}:print_format=json`, '-f', 'null', '-'], opts);
  const json = stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1);
  try {
    const m = JSON.parse(json) as LoudnormMeasurement;
    const finite = [m.input_i, m.input_tp, m.input_lra, m.input_thresh, m.target_offset].every((v) => Number.isFinite(Number(v)));
    return finite ? m : null; // silence measures as -inf: fall back to single-pass
  } catch {
    return null;
  }
}

/** Full decode of every stream; any decoder error means the file is corrupt. Returns the error text ('' = clean). */
export async function decodeErrors(bins: FfmpegBins, file: string, opts: StepOpts): Promise<string> {
  try {
    const { stderr } = await run(bins.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-f', 'null', '-'], opts);
    return stderr.trim();
  } catch (err) {
    if ((err as { reason?: string }).reason === 'aborted' || (err as { reason?: string }).reason === 'timeout') throw err;
    return err instanceof Error ? err.message : String(err);
  }
}

/** Integrated loudness (LUFS) of the file's audio via the EBU R128 meter, or null when it cannot be measured. */
export async function integratedLoudness(bins: FfmpegBins, file: string, opts: StepOpts): Promise<number | null> {
  const { stderr } = await run(bins.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'info', '-i', file, '-vn', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], opts);
  const m = [...stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g)].pop();
  return m ? Number(m[1]) : null;
}

/** "30/1" → 30 */
export function parseRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [n, d] = rate.split('/').map(Number);
  return d ? n / d : n;
}
