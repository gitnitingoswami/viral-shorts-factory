import type { TtsProviderName } from '@vsf/contracts';
import { probeVersion, run } from './process';

export interface TtsVoice {
  provider: TtsProviderName;
  voiceId: string;
  rateWpm: number;
  language: string;
}

export interface AssetRights {
  source: string;
  creatorOrProvider: string;
  license: string;
  licenseUrl: string | null;
  usageRights: string;
}

export interface TtsResult {
  /** Audio as WAV (any rate; normalized by the pipeline). */
  wav: Buffer;
  model: string;
  mock: boolean;
  /** Billable units (characters) and cost in USD cents. Local providers cost 0 but are still metered. */
  units: number;
  costMinor: number;
  rights: AssetRights;
}

export interface TtsProvider {
  readonly name: TtsProviderName;
  available(): Promise<{ ok: boolean; version: string | null }>;
  synthesize(text: string, voice: TtsVoice, opts: { signal?: AbortSignal; timeoutMs: number }): Promise<TtsResult>;
}

/** Provider is not installed/configured: retrying won't help. */
export class TtsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TtsUnavailableError';
  }
}

/** Voice ids are passed as CLI arguments: allow only plain identifiers (no leading dash, no spaces). */
export const VOICE_ID_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*(?:\+[a-z0-9]{1,12})?$|^tone$/;

/** Local eSpeak NG (GPLv3 program; its synthesized output is not covered by the GPL). Robotic: draft quality. */
export class EspeakTtsProvider implements TtsProvider {
  readonly name = 'espeak' as const;
  private version: Promise<string | null> | null = null;

  constructor(private readonly bin: string) {}

  async available(): Promise<{ ok: boolean; version: string | null }> {
    this.version ??= probeVersion(this.bin, '--version');
    const version = await this.version;
    if (!version) this.version = null; // re-probe next time (e.g. installed later)
    return { ok: Boolean(version), version };
  }

  async synthesize(text: string, voice: TtsVoice, opts: { signal?: AbortSignal; timeoutMs: number }): Promise<TtsResult> {
    if (!VOICE_ID_PATTERN.test(voice.voiceId)) throw new TtsUnavailableError(`Invalid eSpeak voice id`);
    const { ok, version } = await this.available();
    if (!ok) throw new TtsUnavailableError('eSpeak NG is not installed on this worker');
    // Text goes through stdin (never argv); without -m, markup in the text is spoken literally, not interpreted.
    const { stdout } = await run(this.bin, ['-v', voice.voiceId, '-s', String(voice.rateWpm), '--stdout', '--stdin'], {
      stdin: text,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      binaryStdout: true,
    });
    if (stdout.length < 100) throw new Error('eSpeak NG produced no audio');
    return {
      wav: stdout,
      model: `espeak-ng:${voice.voiceId}@${version ?? 'unknown'}`,
      mock: false,
      units: text.length,
      costMinor: 0,
      rights: {
        source: 'tts:espeak-ng',
        creatorOrProvider: 'Generated locally with eSpeak NG',
        license: 'Synthesized output owned by the workspace (eSpeak NG is GPL-3.0; generated audio is not covered)',
        licenseUrl: 'https://github.com/espeak-ng/espeak-ng/blob/master/COPYING',
        usageRights: 'Commercial use permitted; draft quality voice',
      },
    };
  }
}

/** Deterministic tone "speech" with word-length pulses. Tests and offline demos only; never publishable. */
export class MockTtsProvider implements TtsProvider {
  readonly name = 'mock' as const;
  /** Test hook: fail the next N calls (simulates provider outages). */
  failNext = 0;
  /** Test hook: simulated synthesis latency (honors cancellation). */
  delayMs = 0;
  /** Test hook: number of synthesize() calls (cache hits never call the provider). */
  calls = 0;

  available(): Promise<{ ok: boolean; version: string | null }> {
    return Promise.resolve({ ok: true, version: 'mock@1' });
  }

  async synthesize(text: string, voice: TtsVoice, opts?: { signal?: AbortSignal }): Promise<TtsResult> {
    this.calls++;
    if (this.delayMs > 0) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, this.delayMs);
        opts?.signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
      });
    }
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('Mock TTS transient failure');
    }
    return {
      wav: toneWav(text, voice.rateWpm),
      model: 'mock-tone@1',
      mock: true,
      units: text.length,
      costMinor: 0,
      rights: {
        source: 'tts:mock',
        creatorOrProvider: 'Viral Shorts Factory test tone generator',
        license: 'Generated test signal (no third-party content)',
        licenseUrl: null,
        usageRights: 'Testing only; not publishable',
      },
    };
  }
}

/** 16-bit mono PCM WAV: a 220 Hz tone pulsed once per word at the voice's speaking rate. */
export function toneWav(text: string, rateWpm: number, sampleRate = 24_000): Buffer {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordSec = 60 / rateWpm;
  const seconds = Math.max(0.6, words.length * wordSec);
  const n = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const phase = (t % wordSec) / wordSec; // 0..1 inside each word slot
    const env = phase < 0.75 ? Math.sin((Math.PI * phase) / 0.75) : 0;
    const v = Math.round(0.3 * env * Math.sin(2 * Math.PI * 220 * t) * 32767);
    data.writeInt16LE(v, i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
