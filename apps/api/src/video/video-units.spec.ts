import type { CaptionCue, RenderSettings } from '@vsf/contracts';
import { buildCues, toSrt, toWebVtt, validateCues } from './captions';
import type { ProbeResult } from './ffmpeg';
import { parseRate } from './ffmpeg';
import { buildFrameSvg, renderPng, tokenizeLine } from './frames';
import { CAPTION, captionMaxChars, captionRect, fitText, insideBox, SAFE_AREA, wrapWords } from './layout';
import { redactMediaQuery, serializeRequest } from '../common/logging';
import { MediaSigner } from './media-signer';
import { ProcessError, run } from './process';
import { evaluateQuality, QualityInput, summarize } from './quality';
import { defaultSettings, InvalidSettingsError, resolveSettings, settingsHash } from './settings';
import { MockTtsProvider, toneWav, VOICE_ID_PATTERN } from './tts';

const DEFAULTS: RenderSettings = defaultSettings({ RENDER_WIDTH: 1080, RENDER_HEIGHT: 1920, RENDER_FPS: 30, RENDER_VIDEO_BITRATE_KBPS: 6000 });

describe('render settings', () => {
  it('defaults to 1080x1920 30 fps h264 within the 20–60 s window', () => {
    expect(DEFAULTS).toMatchObject({ width: 1080, height: 1920, fps: 30, codec: 'h264', minDurationSec: 20, maxDurationSec: 60, burnCaptions: true });
  });

  it('accepts 9:16 overrides and rejects other aspect ratios, fps, windows and unknown keys', () => {
    expect(resolveSettings(DEFAULTS, { width: 720, height: 1280, fps: 60 })).toMatchObject({ width: 720, height: 1280, fps: 60 });
    expect(() => resolveSettings(DEFAULTS, { width: 1920, height: 1080 })).toThrow(InvalidSettingsError);
    expect(() => resolveSettings(DEFAULTS, { fps: 29 as RenderSettings['fps'] })).toThrow(/fps/);
    expect(() => resolveSettings(DEFAULTS, { minDurationSec: 60, maxDurationSec: 30 })).toThrow(/duration/);
    expect(() => resolveSettings(DEFAULTS, { foo: 1 } as unknown as Partial<RenderSettings>)).toThrow(/unknown settings: foo/);
  });

  it('hashes settings canonically (key order does not matter)', () => {
    const reordered = Object.fromEntries(Object.entries(DEFAULTS).reverse()) as unknown as RenderSettings;
    expect(settingsHash(reordered)).toBe(settingsHash(DEFAULTS));
    expect(settingsHash({ ...DEFAULTS, fps: 60 })).not.toBe(settingsHash(DEFAULTS));
  });
});

describe('layout and captions', () => {
  it('wraps words greedily and hard-splits words longer than a line', () => {
    expect(wrapWords('one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(wrapWords('abcdefghijkl x', 5)).toEqual(['abcde', 'fghij', 'kl x']);
    expect(wrapWords('   ', 5)).toEqual([]);
  });

  it('fits text by shrinking the font, and reports when it cannot fit', () => {
    const box = { x: 0, y: 0, width: 600, height: 200 };
    expect(fitText('short', box, [60, 40], 2, 1.2)).toMatchObject({ fontSize: 60, fits: true });
    const long = fitText('a '.repeat(200), box, [60, 40], 2, 1.2);
    expect(long.fits).toBe(false);
    expect(long.lines.length).toBeLessThanOrEqual(2);
  });

  it('builds cues that stay in bounds, cover the speech and end at the scene end', () => {
    const narration = 'Arrays have an at method that accepts negative indexes, so the last item is just at minus one. No more length minus one.';
    const cues = buildCues(narration, 1000, 5000, 6500);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0].startMs).toBe(1000);
    expect(cues[cues.length - 1].endMs).toBe(6500);
    for (const c of cues) {
      expect(c.lines.length).toBeLessThanOrEqual(CAPTION.maxLines);
      for (const l of c.lines) expect(l.length).toBeLessThanOrEqual(captionMaxChars());
    }
    expect(validateCues(cues, 6500).filter((i) => i.severity === 'fail')).toEqual([]);
    expect(buildCues('', 0, 0, 1000)).toEqual([]);
  });

  it('flags overflowing, overlapping, out-of-video and too-fast cues', () => {
    const bad: CaptionCue[] = [
      { startMs: 0, endMs: 1000, text: 'x'.repeat(60), lines: ['x'.repeat(60)] },
      { startMs: 900, endMs: 1200, text: 'ok', lines: ['ok'] },
      { startMs: 1200, endMs: 1300, text: 'a b c', lines: ['a', 'b', 'c'] },
      { startMs: 1300, endMs: 9000, text: 'late', lines: ['late'] },
    ];
    const msgs = validateCues(bad, 5000).map((i) => `${i.severity}:${i.message}`);
    expect(msgs.some((m) => m.startsWith('fail:cue 1: line of 60'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('fail:cue 2: overlaps'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('fail:cue 3: 3 lines'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('fail:cue 4: ends after the video'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('warn:cue 2: on screen 300 ms'))).toBe(true);
  });

  it('keeps every caption rectangle inside the Shorts safe area', () => {
    const widest = ['x'.repeat(captionMaxChars()), 'y'.repeat(captionMaxChars())];
    expect(insideBox(captionRect(widest), SAFE_AREA)).toBe(true);
    expect(insideBox({ ...captionRect(['ok']), x: 10 }, SAFE_AREA)).toBe(false);
  });

  it('escapes caption text in WebVTT (code like Array<string> must not become markup)', () => {
    const vtt = toWebVtt([{ startMs: 0, endMs: 1000, text: 'x', lines: ['Array<string> & a --> b'] }]);
    expect(vtt).toContain('Array&lt;string&gt; &amp; a --&gt; b');
    expect(vtt.split('-->').length).toBe(2); // only the timing separator
  });

  it('serializes WebVTT and SRT timestamps', () => {
    const cues: CaptionCue[] = [{ startMs: 1500, endMs: 62_250, text: 'hi there', lines: ['hi', 'there'] }];
    expect(toWebVtt(cues)).toBe('WEBVTT\n\n1\n00:00:01.500 --> 00:01:02.250\nhi\nthere\n');
    expect(toSrt(cues)).toBe('1\n00:00:01,500 --> 00:01:02,250\nhi\nthere\n');
  });
});

describe('frames', () => {
  const spec = { width: 1080, height: 1920, headline: 'Use <at> & "friends"', code: null, caption: ['a <b>'], progress: 0.5, sceneLabel: '1/3' };

  it('drops characters XML cannot contain instead of failing the render', () => {
    const { svg } = buildFrameSvg({ ...spec, headline: 'bad\u0000\u0007char\ud800s' });
    expect(svg).toContain('badchars');
    expect(() => renderPng(svg)).not.toThrow();
  });

  it('escapes all text (no markup injection from script content)', () => {
    const { svg } = buildFrameSvg(spec);
    expect(svg).not.toContain('<at>');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;at&gt;');
    expect(svg).toContain('&amp;');
  });

  it('shrinks code to fit and truncates lines that still do not fit', () => {
    const short = buildFrameSvg({ ...spec, code: { language: 'javascript', source: 'console.log(1);', highlightLines: [1] } });
    expect(short.notes).toMatchObject({ codeFontSize: 36, truncatedCodeLines: 0 });
    const long = buildFrameSvg({ ...spec, code: { language: 'javascript', source: `const x = "${'y'.repeat(120)}";`, highlightLines: [] } });
    expect(long.notes.codeFontSize).toBe(24);
    expect(long.notes.truncatedCodeLines).toBe(1);
  });

  it('highlights keywords, strings, numbers and comments', () => {
    const t = tokenizeLine('const a = "s" + 42; // note', 'javascript');
    const color = (text: string) => t.find((x) => x.text.includes(text))?.color;
    expect(color('const')).not.toBe(color('a ='));
    expect(color('"s"')).toBeDefined();
    expect(t[t.length - 1].text).toBe('// note');
    expect(tokenizeLine('SELECT 1 -- c', 'sql').map((x) => x.text).join('')).toBe('SELECT 1 -- c');
    expect(tokenizeLine('anything', 'other')).toHaveLength(1);
  });

  it('rasterizes to a PNG of the requested size with the bundled fonts', () => {
    const png = renderPng(buildFrameSvg({ ...spec, width: 720, height: 1280 }).svg);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(720);
    expect(png.readUInt32BE(20)).toBe(1280);
  });
});

describe('quality evaluation', () => {
  const probe = (over: Partial<{ w: number; h: number; vdur: string; adur: string; codec: string; fps: string; audio: boolean }> = {}): ProbeResult => ({
    streams: [
      { codec_type: 'video', codec_name: over.codec ?? 'h264', width: over.w ?? 1080, height: over.h ?? 1920, pix_fmt: 'yuv420p', r_frame_rate: over.fps ?? '30/1', duration: over.vdur ?? '30.000' },
      ...(over.audio === false ? [] : [{ codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, duration: over.adur ?? '30.010' }]),
    ],
    format: { duration: over.vdur ?? '30.000', bit_rate: '2000000' },
  });
  const base = (over: Partial<QualityInput> = {}): QualityInput => ({
    settings: DEFAULTS,
    probe: probe(),
    decodeErrors: '',
    loudnessLufs: -14.2,
    cues: [{ startMs: 0, endMs: 2000, text: 'hello world', lines: ['hello world'] }],
    missingAssets: [],
    voiceQuality: 'production',
    simplifiedTransitions: 0,
    truncatedCodeLines: 0,
    headlineOverflows: 0,
    expectedDurationMs: 30_000,
    ...over,
  });
  const status = (checks: ReturnType<typeof evaluateQuality>, id: string) => checks.find((c) => c.id === id)?.status;

  it('passes a well-formed render', () => {
    const checks = evaluateQuality(base());
    expect(summarize(checks)).toEqual({ passed: true, publishable: true, failures: [] });
    expect(checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('fails dimensions, duration, sync, codec, fps, missing audio, missing assets and corrupt files', () => {
    expect(status(evaluateQuality(base({ probe: probe({ w: 720, h: 1280 }) })), 'video.dimensions')).toBe('fail');
    expect(status(evaluateQuality(base({ probe: probe({ vdur: '75.0', adur: '75.0' }) })), 'video.duration')).toBe('fail');
    expect(status(evaluateQuality(base({ probe: probe({ adur: '29.5' }) })), 'av.sync')).toBe('fail');
    // Both streams equal to each other but off the planned timeline is still a sync failure.
    expect(status(evaluateQuality(base({ expectedDurationMs: 32_000 })), 'av.sync')).toBe('fail');
    expect(status(evaluateQuality(base({ probe: probe({ codec: 'hevc' }) })), 'video.codec')).toBe('fail');
    expect(status(evaluateQuality(base({ probe: probe({ fps: '25/1' }) })), 'video.fps')).toBe('fail');
    expect(status(evaluateQuality(base({ probe: probe({ audio: false }) })), 'audio.present')).toBe('fail');
    expect(status(evaluateQuality(base({ missingAssets: ['frame:abc'] })), 'assets.present')).toBe('fail');
    expect(status(evaluateQuality(base({ decodeErrors: 'Invalid NAL unit' })), 'render.integrity')).toBe('fail');
    expect(status(evaluateQuality(base({ cues: [{ startMs: 0, endMs: 1000, text: 'x', lines: ['x'.repeat(80)] }] })), 'captions.bounds')).toBe('fail');
  });

  it('grades loudness and voice quality, and warns about simplified visuals', () => {
    expect(status(evaluateQuality(base({ loudnessLufs: -17 })), 'audio.loudness')).toBe('warn');
    expect(status(evaluateQuality(base({ loudnessLufs: -30 })), 'audio.loudness')).toBe('fail');
    expect(status(evaluateQuality(base({ loudnessLufs: null })), 'audio.loudness')).toBe('warn');
    expect(status(evaluateQuality(base({ voiceQuality: 'draft' })), 'voice.publishable')).toBe('warn');
    const mock = evaluateQuality(base({ voiceQuality: 'mock' }));
    expect(status(mock, 'voice.publishable')).toBe('fail');
    expect(summarize(mock).failures[0]).toMatch(/^Voice: Mock tone/);
    const warned = evaluateQuality(base({ simplifiedTransitions: 2, truncatedCodeLines: 1, headlineOverflows: 1 }));
    expect(['visual.transitions', 'visual.code', 'visual.headline'].map((id) => status(warned, id))).toEqual(['warn', 'warn', 'warn']);
    expect(summarize(warned).passed).toBe(true);
    // Draft voices pass the technical checks but are never publishable.
    expect(summarize(evaluateQuality(base({ voiceQuality: 'draft' })))).toMatchObject({ passed: true, publishable: false });
    expect(summarize(mock)).toMatchObject({ passed: false, publishable: false });
  });

  it('parses ffprobe frame rates', () => {
    expect(parseRate('30000/1001')).toBeCloseTo(29.97, 2);
    expect(parseRate('25')).toBe(25);
    expect(parseRate(undefined)).toBe(0);
  });
});

describe('media signer', () => {
  const signer = new MediaSigner('x'.repeat(40));
  const id = '00000000-0000-4000-8000-0000000000aa';

  it('verifies its own signatures until they expire', () => {
    const exp = 2_000_000_000;
    const sig = signer.sign(id, exp);
    expect(signer.verify(id, exp, sig, exp - 10)).toBe(true);
    expect(signer.verify(id, exp, sig, exp + 1)).toBe(false);
  });

  it('rejects tampered ids, expiries, signatures, and other secrets', () => {
    const exp = 2_000_000_000;
    const sig = signer.sign(id, exp);
    expect(signer.verify('00000000-0000-4000-8000-0000000000ab', exp, sig, 0)).toBe(false);
    expect(signer.verify(id, exp + 1, sig, 0)).toBe(false);
    expect(signer.verify(id, exp, `${sig.slice(0, -1)}A`, 0)).toBe(sig.endsWith('A'));
    expect(signer.verify(id, exp, 'short', 0)).toBe(false);
    expect(new MediaSigner('y'.repeat(40)).verify(id, exp, sig, 0)).toBe(false);
  });
});

describe('tts', () => {
  it('only allows plain voice ids (never an option-like argument)', () => {
    expect(VOICE_ID_PATTERN.test('en-us')).toBe(true);
    expect(VOICE_ID_PATTERN.test('en-gb-x-rp+f3')).toBe(true);
    expect(VOICE_ID_PATTERN.test('--stdout')).toBe(false);
    expect(VOICE_ID_PATTERN.test('en us')).toBe(false);
  });

  it('generates a deterministic mock WAV whose length follows the speaking rate', async () => {
    const wav = toneWav('one two three four five', 150, 8000);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect((wav.length - 44) / 2 / 8000).toBeCloseTo(2, 1);
    expect(toneWav('one two three four five', 150, 8000).equals(wav)).toBe(true);
    const p = new MockTtsProvider();
    p.failNext = 1;
    await expect(p.synthesize('hi', { provider: 'mock', voiceId: 'tone', rateWpm: 150, language: 'en-US' })).rejects.toThrow(/transient/);
    await expect(p.synthesize('hi', { provider: 'mock', voiceId: 'tone', rateWpm: 150, language: 'en-US' })).resolves.toMatchObject({ mock: true, costMinor: 0 });
  });
});

describe('process runner', () => {
  const node = process.execPath;

  it('returns stdout and passes stdin', async () => {
    const { stdout } = await run(node, ['-e', 'process.stdin.pipe(process.stdout)'], { timeoutMs: 5000, stdin: 'hello' });
    expect(stdout.toString()).toBe('hello');
  });

  it('reports non-zero exits, timeouts, aborts and missing binaries', async () => {
    await expect(run(node, ['-e', 'console.error("boom"); process.exit(3)'], { timeoutMs: 5000 })).rejects.toMatchObject({ reason: 'exit', code: 3 });
    await expect(run(node, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 })).rejects.toMatchObject({ reason: 'timeout' });
    const ac = new AbortController();
    const p = run(node, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 5000, signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    await expect(p).rejects.toMatchObject({ reason: 'aborted' });
    await expect(run('/nonexistent/binary-vsf', [], { timeoutMs: 1000 })).rejects.toBeInstanceOf(ProcessError);
  });
});

describe('log redaction', () => {
  it('removes signatures from signed media URLs only', () => {
    expect(redactMediaQuery('/api/video/media/abc?exp=1&sig=secret')).toBe('/api/video/media/abc?[REDACTED]');
    expect(redactMediaQuery('/api/video/productions?limit=5')).toBe('/api/video/productions?limit=5');
    expect(redactMediaQuery(undefined)).toBeUndefined();
  });

  it('drops the parsed query (exp/sig) of signed media requests from request logs', () => {
    const out = serializeRequest({ method: 'GET', url: '/api/video/media/abc?exp=1&sig=SECRET', query: { exp: '1', sig: 'SECRET' } });
    expect(JSON.stringify(out)).not.toContain('SECRET');
    expect(serializeRequest({ url: '/api/video/productions?limit=5', query: { limit: '5' } })).toMatchObject({ query: { limit: '5' } });
  });
});
