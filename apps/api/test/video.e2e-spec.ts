import { INestApplication, INestApplicationContext } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CreateProductionResponse, StoryboardSceneDto, VideoProductionDetailDto, VideoProductionDto } from '@vsf/contracts';
import { scriptMetrics, versionHash } from '../src/content/content-utils';
import { decodeErrors, probe } from '../src/video/ffmpeg';
import { probeVersion } from '../src/video/process';
import type { MockTtsProvider } from '../src/video/tts';
import { TTS_PROVIDERS, TtsProviders, VideoPipeline } from '../src/video/video.pipeline';
import { VideoProcessor } from '../src/video/video.processor';
import { createTestApp, createUser, createWorker, resetTestDatabase, waitFor } from './helpers';

const OWNER = { email: 'owner@video.test', password: 'owner-password-123' };
const REVIEWER = { email: 'reviewer@video.test', password: 'reviewer-password-123' };
const WS = '00000000-0000-4000-8000-000000000001';
const BINS = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
const FAST = { width: 720, height: 1280 };

const SCENES: StoryboardSceneDto[] = [
  {
    index: 0,
    durationSec: 5,
    narration: 'Still writing items dot length minus one to get the last element? There is a cleaner way.',
    onScreenText: 'Stop writing length - 1',
    visualConcept: 'Title card',
    code: null,
    transition: 'cut',
    assetBrief: 'Original title card',
  },
  {
    index: 1,
    durationSec: 9,
    narration: 'Arrays have an at method. Pass a negative index and it counts from the end, so at minus one is the last item.',
    onScreenText: 'Array.prototype.at()',
    visualConcept: 'Code frame',
    code: { language: 'javascript', source: 'const items = ["a", "b", "c"];\nconsole.log(items.at(-1)); // "c"', highlightLines: [2] },
    transition: 'fade',
    assetBrief: 'Code frame',
  },
  {
    index: 2,
    durationSec: 8,
    narration: 'It works on strings and typed arrays too, and it returns undefined instead of throwing when the index is out of range.',
    onScreenText: 'Strings too',
    visualConcept: 'Code frame',
    code: { language: 'javascript', source: 'console.log("hello".at(-1)); // "o"\nconsole.log([].at(-1)); // undefined', highlightLines: [1] },
    transition: 'cut',
    assetBrief: 'Code frame',
  },
  {
    index: 3,
    durationSec: 6,
    narration: 'So next time you need the last element, reach for at minus one. Follow for more quick JavaScript tips.',
    onScreenText: 'Use .at(-1)',
    visualConcept: 'Recap card',
    code: null,
    transition: 'cut',
    assetBrief: 'Recap card',
  },
];

describe('Video production (e2e: real FFmpeg, mock + eSpeak TTS, S3 storage)', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let http: App;
  let ds: DataSource;
  let owner: string;
  let reviewer: string;
  let scriptId: string;
  let mockVoiceId: string;
  let espeakAvailable = false;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const mockTts = () => worker.get<TtsProviders>(TTS_PROVIDERS).mock as MockTtsProvider;

  async function seedApprovedScript(title: string): Promise<string> {
    const [niche] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO niche (workspace_id, name, slug, keywords) VALUES ($1, 'Coding tips', 'coding-tips', '{javascript}')
       ON CONFLICT (workspace_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [WS],
    );
    const [col] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO trend_collection (workspace_id, niche_id, trigger, status, run_key, window_start, window_end)
       VALUES ($1, $2, 'manual', 'completed', $3, now() - interval '7 days', now()) RETURNING id`,
      [WS, niche.id, `seed:${Math.random()}`],
    );
    const [topic] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO trend_topic (workspace_id, collection_id, niche_id, title, slug, score, confidence, breakdown, sources, signal_count, status)
       VALUES ($1, $2, $3, 'Array.at', $4, 0.8, 0.8, '[]', '{hackernews}', 1, 'approved') RETURNING id`,
      [WS, col.id, niche.id, `slug-${Math.random()}`],
    );
    const [idea] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO content_idea (workspace_id, topic_id, title, audience, angle, hook, value_proposition, format, target_duration_sec, status, llm_model, prompt_ref, llm_mock)
       VALUES ($1, $2, $3, 'JS developers', 'quick tip', 'hook', 'value', 'quick-tip', 30, 'selected', 'mock', 'ideas@1', true) RETURNING id`,
      [WS, topic.id, title],
    );
    const [script] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO video_script (workspace_id, idea_id, title, status, current_version, approved_version) VALUES ($1, $2, $3, 'approved', 1, 1) RETURNING id`,
      [WS, idea.id, title],
    );
    const m = scriptMetrics(SCENES);
    await ds.query(
      `INSERT INTO script_version (script_id, version, author_type, title, body, content_hash, word_count, est_duration_sec, fact_check_state, quality_state, code_state)
       VALUES ($1, 1, 'human', $2, $3, $4, $5, $6, 'done', 'done', 'done')`,
      [script.id, title, JSON.stringify({ scenes: SCENES }), versionHash(title, SCENES), m.wordCount, m.estDurationSec],
    );
    return script.id;
  }

  async function createProduction(body: Record<string, unknown>, token = owner, status = 202): Promise<CreateProductionResponse> {
    const r = await request(http).post('/api/video/productions').set(auth(token)).send(body).expect(status);
    return r.body as CreateProductionResponse;
  }

  async function waitProduction(id: string, statuses: string[], timeoutMs = 90_000): Promise<VideoProductionDetailDto> {
    return waitFor(async () => {
      const r = await request(http).get(`/api/video/productions/${id}`).set(auth(owner)).expect(200);
      return statuses.includes(r.body.status) ? (r.body as VideoProductionDetailDto) : undefined;
    }, timeoutMs);
  }

  async function jobRow(id: string) {
    const [row] = await ds.query<Array<{ status: string; attempt: number; error: string | null }>>(`SELECT status, attempt, error FROM job WHERE id = $1`, [id]);
    return row;
  }

  async function download(assetId: string, range?: string) {
    const signed = await request(http).get(`/api/video/assets/${assetId}/url`).set(auth(reviewer)).expect(200);
    let req = request(http).get(signed.body.url as string);
    if (range) req = req.set('Range', range);
    return await req
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  }

  beforeAll(async () => {
    await resetTestDatabase();
    app = await createTestApp();
    worker = await createWorker();
    http = app.getHttpServer() as App;
    ds = app.get(DataSource);
    await createUser(app, OWNER.email, OWNER.password, 'owner');
    await createUser(app, REVIEWER.email, REVIEWER.password, 'reviewer');
    owner = (await request(http).post('/api/auth/login').send(OWNER)).body.accessToken;
    reviewer = (await request(http).post('/api/auth/login').send(REVIEWER)).body.accessToken;
    scriptId = await seedApprovedScript('Get the last array item with at(-1)');
    espeakAvailable = Boolean(await probeVersion('espeak-ng', '--version'));
  }, 60_000);

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  it('reports render capabilities and the seeded voice profiles', async () => {
    const status = await request(http).get('/api/video/status').set(auth(reviewer)).expect(200);
    expect(status.body.ffmpeg.available).toBe(true);
    expect(status.body.defaults).toMatchObject({ width: 1080, height: 1920, fps: 30, codec: 'h264' });
    const voices = await request(http).get('/api/video/voices').set(auth(reviewer)).expect(200);
    expect(voices.body.map((v: { provider: string }) => v.provider).sort()).toEqual(['espeak', 'mock']);
    expect(voices.body[0]).toMatchObject({ provider: 'espeak', isDefault: true, quality: 'draft' });
    mockVoiceId = voices.body.find((v: { provider: string }) => v.provider === 'mock').id;
  });

  it('only renders approved scripts, only for owners, with valid 9:16 settings', async () => {
    await createProduction({ scriptId, voiceProfileId: mockVoiceId }, reviewer, 403);
    await createProduction({ scriptId, voiceProfileId: mockVoiceId, settings: { width: 1920, height: 1080 } }, owner, 400);
    await createProduction({ scriptId, voiceProfileId: mockVoiceId, settings: { fps: 29 } }, owner, 400);
    const pending = await seedApprovedScript('Not approved yet');
    await ds.query(`UPDATE video_script SET status = 'in_review', approved_version = NULL WHERE id = $1`, [pending]);
    await createProduction({ scriptId: pending, voiceProfileId: mockVoiceId }, owner, 409);
    await createProduction({ scriptId: '00000000-0000-4000-8000-00000000dead', voiceProfileId: mockVoiceId }, owner, 404);
  });

  let mockProduction: VideoProductionDetailDto;

  it('renders a complete 1080x1920 video; duplicate requests reuse the same production and job', async () => {
    const a = await createProduction({ scriptId, voiceProfileId: mockVoiceId });
    const b = await createProduction({ scriptId, voiceProfileId: mockVoiceId });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.production.id).toBe(a.production.id);
    expect(b.job?.id).toBe(a.job?.id);

    mockProduction = await waitProduction(a.production.id, ['ready', 'quality_failed', 'failed']);
    expect(mockProduction).toMatchObject({ status: 'quality_failed', stage: 'done', progress: 100, latestVersion: 1 });
    expect((await jobRow(a.job!.id)).status).toBe('completed');
    const [{ count }] = await ds.query<Array<{ count: string }>>(`SELECT count(*) FROM video_production WHERE script_id = $1`, [scriptId]);
    expect(Number(count)).toBe(1);

    const v = mockProduction.versions[0];
    expect(v).toMatchObject({ version: 1, width: 1080, height: 1920, fps: 30, codec: 'h264' });
    expect(v.durationMs).toBeGreaterThanOrEqual(20_000);
    expect(v.durationMs).toBeLessThanOrEqual(60_000);
    // Quality failures are visible: the mock tone is not publishable; everything else passes.
    const q = v.quality!;
    expect(q.passed).toBe(false);
    expect(q.publishable).toBe(false);
    expect(q.failures).toEqual([expect.stringMatching(/^Voice: Mock tone/)]);
    const byId = Object.fromEntries(q.checks.map((c) => [c.id, c.status]));
    expect(byId).toMatchObject({
      'video.dimensions': 'pass',
      'video.codec': 'pass',
      'video.fps': 'pass',
      'video.duration': 'pass',
      'audio.present': 'pass',
      'av.sync': 'pass',
      'audio.loudness': 'pass',
      'captions.bounds': 'pass',
      'assets.present': 'pass',
      'render.integrity': 'pass',
      'voice.publishable': 'fail',
      'visual.transitions': 'warn',
    });

    // Scenes are contiguous and captions cover each scene.
    expect(mockProduction.scenes).toHaveLength(4);
    mockProduction.scenes.forEach((s, i) => {
      if (i > 0) expect(s.startMs).toBe(mockProduction.scenes[i - 1].endMs);
      expect(s.captions[0].startMs).toBe(s.startMs);
      expect(s.captions[s.captions.length - 1].endMs).toBe(s.endMs);
    });
  }, 120_000);

  it('records rights metadata and provenance for every asset used', async () => {
    const roles = new Set(mockProduction.assets.map((a) => a.role));
    expect([...roles].sort()).toEqual(['captions', 'font', 'frame', 'narration', 'thumbnail', 'video']);
    for (const a of mockProduction.assets) {
      expect(a.license.length).toBeGreaterThan(0);
      expect(a.source.length).toBeGreaterThan(0);
      expect(a.creatorOrProvider.length).toBeGreaterThan(0);
      expect(a.usageRights.length).toBeGreaterThan(0);
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(mockProduction.assets.find((a) => a.role === 'font')).toMatchObject({ license: 'SIL Open Font License 1.1', generated: false });
    expect(mockProduction.assets.find((a) => a.role === 'narration')).toMatchObject({ source: 'tts:mock', generated: true, provenance: expect.objectContaining({ mock: true }) });
    expect(mockProduction.assets.find((a) => a.role === 'video')?.provenance).toMatchObject({ scriptId, scriptHash: mockProduction.scriptHash });
    // The database refuses assets without a license.
    await expect(
      ds.query(`INSERT INTO media_asset (workspace_id, kind, generated, storage_key, sha256, mime, bytes, source, creator_or_provider, license, usage_rights)
                VALUES ($1, 'image', false, 'k', repeat('a', 64), 'image/png', 1, 's', 'c', '', 'u')`, [WS]),
    ).rejects.toThrow(/check/i);
    const lib = await request(http).get('/api/video/assets?kind=font').set(auth(reviewer)).expect(200);
    expect(lib.body.total).toBe(2);
    await request(http).get('/api/video/assets?kind=bogus').set(auth(reviewer)).expect(400);
  });

  it('serves the video through signed, expiring URLs with Range support, and the file decodes cleanly', async () => {
    const v = mockProduction.versions[0];
    const full = await download(v.videoAssetId);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toBe('video/mp4');
    expect((full.body as Buffer).length).toBe(v.bytes);
    const part = await download(v.videoAssetId, 'bytes=0-99');
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-99/${v.bytes}`);
    expect((part.body as Buffer).length).toBe(100);

    const dir = await mkdtemp(join(tmpdir(), 'vsf-e2e-'));
    try {
      const file = join(dir, 'out.mp4');
      await writeFile(file, full.body as Buffer);
      const p = await probe(BINS, file, { timeoutMs: 30_000 });
      expect(p.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
      expect(await decodeErrors(BINS, file, { timeoutMs: 60_000 })).toBe('');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    const vtt = await download(v.captionsAssetId!);
    expect(vtt.status).toBe(200);
    expect((vtt.body as Buffer).toString('utf8')).toMatch(/^WEBVTT\n\n1\n00:00:00\.000 --> /);

    const signed = await request(http).get(`/api/video/assets/${v.videoAssetId}/url`).set(auth(owner)).expect(200);
    const url = new URL(signed.body.url as string, 'http://x');
    await request(http).get(`${url.pathname}?exp=${url.searchParams.get('exp')}&sig=${'A'.repeat(43)}`).expect(403);
    await request(http).get(`${url.pathname}?exp=${Number(url.searchParams.get('exp')) + 1}&sig=${url.searchParams.get('sig')}`).expect(403);
    await request(http).get(`${url.pathname}?exp=1000&sig=${url.searchParams.get('sig')}`).expect(403);
    await request(http).get(`/api/video/assets/${v.videoAssetId}/url`).expect(401);

    // Range edge cases: unsatisfiable → 416; malformed → ignored (full body).
    const good = `${url.pathname}?exp=${url.searchParams.get('exp')}&sig=${url.searchParams.get('sig')}`;
    await request(http).get(good).set('Range', `bytes=${v.bytes + 10}-`).expect(416);
    await request(http).get(good).set('Range', 'bytes=abc').expect(200);
  }, 120_000);

  it('releases storage streams when players abort mid-download', async () => {
    const v = mockProduction.versions[0];
    const signed = await request(http).get(`/api/video/assets/${v.videoAssetId}/url`).set(auth(owner)).expect(200);
    const server = app.getHttpServer() as import('node:http').Server;
    if (!server.listening) await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as import('node:net').AddressInfo;
    // Abort far more downloads than the S3 client's socket pool (50) holds; leaked sockets would stall the next call.
    for (let i = 0; i < 60; i++) {
      const ac = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}${signed.body.url}`, { signal: ac.signal });
      const reader = res.body!.getReader();
      await reader.read();
      ac.abort();
      await reader.cancel().catch(() => undefined);
    }
    const after = await download(v.videoAssetId);
    expect(after.status).toBe(200);
    expect((after.body as Buffer).length).toBe(v.bytes); // the server is closed by app.close() in afterAll
  }, 120_000);

  it('renders with the local eSpeak NG draft voice (ready, flagged as draft)', async () => {
    if (!espeakAvailable) {
      if (process.env.CI) throw new Error('eSpeak NG must be installed in CI');
      console.warn('eSpeak NG not installed: skipping the draft-voice render');
      return;
    }
    const { production } = await createProduction({ scriptId, settings: FAST });
    const done = await waitProduction(production.id, ['ready', 'quality_failed', 'failed']);
    expect(done.status).toBe('ready');
    const q = done.versions[0].quality!;
    expect(q.passed).toBe(true);
    expect(q.publishable).toBe(false); // draft voice: technically sound, never publishable
    expect(q.checks.find((c) => c.id === 'voice.publishable')).toMatchObject({ status: 'warn', detail: expect.stringMatching(/Draft voice/) });
    expect(done.versions[0]).toMatchObject({ width: 720, height: 1280 });
    const [exp] = await ds.query<Array<{ count: string }>>(`SELECT count(*) FROM expense_record WHERE category = 'tts' AND provider = 'espeak' AND related_id = $1`, [production.id]);
    expect(Number(exp.count)).toBe(4);
  }, 120_000);

  it('retries a transient TTS failure without duplicating productions, versions or assets', async () => {
    const [voice] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO voice_profile (workspace_id, name, provider, voice_id, language, rate_wpm, quality) VALUES ($1, 'Mock fast', 'mock', 'tone', 'en-US', 170, 'mock') RETURNING id`,
      [WS],
    );
    mockTts().failNext = 1;
    const callsBefore = mockTts().calls;
    const { production, job } = await createProduction({ scriptId, voiceProfileId: voice.id, settings: FAST });
    const done = await waitProduction(production.id, ['ready', 'quality_failed', 'failed']);
    expect(done.status).toBe('quality_failed'); // mock voice
    expect(await jobRow(job!.id)).toMatchObject({ status: 'completed', attempt: 2 });
    expect(done.versions).toHaveLength(1);
    const [{ dup }] = await ds.query<Array<{ dup: string }>>(`SELECT count(*) AS dup FROM (SELECT sha256 FROM media_asset GROUP BY workspace_id, kind, sha256 HAVING count(*) > 1) d`);
    expect(Number(dup)).toBe(0);
    const narration = done.assets.filter((a) => a.role === 'narration');
    expect(narration).toHaveLength(4);
    // 1 failed call + 4 scenes; the retry did not re-synthesize anything already stored.
    expect(mockTts().calls - callsBefore).toBe(5);
    const [{ count: audioBefore }] = await ds.query<Array<{ count: string }>>(`SELECT count(*) FROM media_asset WHERE kind = 'audio'`);
    // Same voice + text in another production: narration comes from the cache (no provider calls, no new rows).
    const other = await createProduction({ scriptId, voiceProfileId: voice.id, settings: { ...FAST, fps: 24 } });
    await waitProduction(other.production.id, ['ready', 'quality_failed', 'failed']);
    expect(mockTts().calls - callsBefore).toBe(5);
    const [{ count: audioAfter }] = await ds.query<Array<{ count: string }>>(`SELECT count(*) FROM media_asset WHERE kind = 'audio'`);
    expect(audioAfter).toBe(audioBefore);
  }, 120_000);

  it('recovers a render whose worker died mid-job (lease takeover) and produces exactly one version', async () => {
    await worker.close();
    const { production, job } = await createProduction({ scriptId, voiceProfileId: mockVoiceId, settings: { ...FAST, fps: 25 } });
    // A worker claimed the job and died: running, lease already expired.
    await ds.query(`UPDATE job SET status = 'running', attempt = 1, lease_owner = 'dead-worker', lease_until = now() - interval '1 second', started_at = now() WHERE id = $1`, [job!.id]);
    await ds.query(`UPDATE video_production SET status = 'rendering', stage = 'narration', progress = 10 WHERE id = $1`, [production.id]);

    worker = await createWorker();
    const done = await waitProduction(production.id, ['ready', 'quality_failed', 'failed']);
    expect(done.status).toBe('quality_failed');
    expect(done.versions).toHaveLength(1);
    expect(done.versions[0].fps).toBe(25);
    const row = await jobRow(job!.id);
    expect(row.status).toBe('completed');
    expect(row.attempt).toBeGreaterThanOrEqual(2);
    const [{ count }] = await ds.query<Array<{ count: string }>>(`SELECT count(*) FROM video_version WHERE production_id = $1`, [production.id]);
    expect(Number(count)).toBe(1);
  }, 120_000);

  it('fails visibly after retries are exhausted, then a manual retry renders a new attempt', async () => {
    // A fresh voice, so narration is not served from the cache and the provider is really called.
    const [voice] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO voice_profile (workspace_id, name, provider, voice_id, language, rate_wpm, quality) VALUES ($1, 'Mock slow', 'mock', 'tone', 'en-US', 160, 'mock') RETURNING id`,
      [WS],
    );
    mockTts().failNext = 3;
    const { production, job } = await createProduction({ scriptId, voiceProfileId: voice.id, settings: { ...FAST, burnCaptions: false } });
    const failed = await waitProduction(production.id, ['failed', 'ready', 'quality_failed']);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/Mock TTS transient failure/);
    expect(await jobRow(job!.id)).toMatchObject({ status: 'failed', attempt: 3 });
    await request(http).post(`/api/video/productions/${production.id}/retry`).set(auth(reviewer)).expect(403);

    const retried = await request(http).post(`/api/video/productions/${production.id}/retry`).set(auth(owner)).expect(202);
    expect(retried.body.production).toMatchObject({ status: 'queued', renderAttempt: 2, error: null });
    expect(retried.body.job.id).not.toBe(job!.id);
    const done = await waitProduction(production.id, ['ready', 'quality_failed', 'failed']);
    expect(done.status).toBe('quality_failed');
    expect(done.versions).toHaveLength(1);
    expect(done.versions[0].quality?.checks.find((c) => c.id === 'captions.bounds')?.status).toBe('warn'); // not burned in
    // A quality-failed production may be re-rendered (ready/rendering ones may not: see the cancel test's 409s).
    await request(http).post(`/api/video/productions/${production.id}/retry`).set(auth(owner)).expect(202);
    await waitProduction(production.id, ['ready', 'quality_failed', 'failed']);
  }, 180_000);

  it('renders when the worker picks the job up before the API linked it, and re-enqueues productions left unlinked', async () => {
    await worker.close();
    // Dispatch happened, but the link write had not (or never) landed.
    const a = await createProduction({ scriptId, voiceProfileId: mockVoiceId, settings: { ...FAST, videoBitrateKbps: 4000 } });
    await ds.query(`UPDATE video_production SET job_id = NULL WHERE id = $1`, [a.production.id]);
    // The API crashed before creating the job at all.
    const [orphan] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO video_production (workspace_id, script_id, script_version_id, script_hash, voice_profile_id, settings, settings_hash, updated_at)
       SELECT workspace_id, script_id, script_version_id, script_hash, voice_profile_id, jsonb_set(settings, '{videoBitrateKbps}', '3500'), repeat('e', 64), now() - interval '1 hour'
         FROM video_production WHERE id = $1 RETURNING id`,
      [a.production.id],
    );
    worker = await createWorker();
    const linked = await waitProduction(a.production.id, ['ready', 'quality_failed', 'failed']);
    expect(linked.status).toBe('quality_failed'); // mock voice; not "Superseded"
    expect(linked.jobId).toBe(a.job!.id);

    // The worker's periodic reconciler (500 ms in tests) re-enqueues and links the orphan.
    const recovered = await waitProduction(orphan.id, ['ready', 'quality_failed', 'failed']);
    expect(recovered.status).toBe('quality_failed');
    expect(recovered.jobId).not.toBeNull();
  }, 120_000);

  it('does not re-render (or downgrade) a production whose job was re-claimed after its result was committed', async () => {
    const { production, job } = await createProduction({ scriptId, voiceProfileId: mockVoiceId, settings: { ...FAST, videoBitrateKbps: 4500 } });
    const done = await waitProduction(production.id, ['ready', 'quality_failed', 'failed']);
    await waitFor(async () => ((await jobRow(job!.id)).status === 'completed' ? true : undefined));
    const expenses = async () => Number((await ds.query<Array<{ c: string }>>(`SELECT count(*) AS c FROM expense_record WHERE related_id = $1`, [production.id]))[0].c);
    const before = await expenses();
    // The worker committed the version and then died before marking the job completed.
    await ds.query(`UPDATE job SET status = 'running', attempt = 1, lease_owner = 'dead-worker', lease_until = now() - interval '1 second', finished_at = NULL WHERE id = $1`, [job!.id]);
    await waitFor(async () => ((await jobRow(job!.id)).status === 'completed' ? true : undefined), 30_000);
    const after = await waitProduction(production.id, [done.status]);
    expect(after.versions).toHaveLength(1);
    expect(after.status).toBe(done.status);
    expect(await expenses()).toBe(before);
  }, 120_000);

  it('fails fast without retries when FFmpeg is missing (non-retryable)', async () => {
    const pipeline = worker.get<VideoPipeline, { bins: { ffmpeg: string } }>(VideoPipeline);
    const original = pipeline.bins.ffmpeg;
    pipeline.bins.ffmpeg = '/nonexistent/ffmpeg';
    try {
      const { production, job } = await createProduction({ scriptId, voiceProfileId: mockVoiceId, settings: { ...FAST, videoBitrateKbps: 3000 } });
      const failed = await waitProduction(production.id, ['failed', 'ready', 'quality_failed']);
      expect(failed.error).toMatch(/FFmpeg is not installed/);
      expect(await jobRow(job!.id)).toMatchObject({ status: 'failed', attempt: 1 });
    } finally {
      pipeline.bins.ffmpeg = original;
    }
  }, 60_000);

  it('cancels a running render (killing work in progress) and a queued one, without creating versions', async () => {
    mockTts().delayMs = 1500;
    try {
      const { production, job } = await createProduction({ scriptId, voiceProfileId: mockVoiceId, settings: { ...FAST, videoBitrateKbps: 2500 } });
      await waitProduction(production.id, ['rendering'], 30_000);
      await request(http).post(`/api/video/productions/${production.id}/cancel`).set(auth(reviewer)).expect(403);
      const c = await request(http).post(`/api/video/productions/${production.id}/cancel`).set(auth(owner)).expect(200);
      expect((c.body as VideoProductionDto).cancelRequested).toBe(true);
      const done = await waitProduction(production.id, ['cancelled', 'ready', 'quality_failed', 'failed'], 30_000);
      expect(done.status).toBe('cancelled');
      expect(done.versions).toHaveLength(0);
      await waitFor(async () => ((await jobRow(job!.id)).status === 'cancelled' ? true : undefined), 15_000);
      await request(http).post(`/api/video/productions/${production.id}/cancel`).set(auth(owner)).expect(409);
    } finally {
      mockTts().delayMs = 0;
    }

    await worker.close();
    const { production, job } = await createProduction({ scriptId, voiceProfileId: mockVoiceId, settings: { ...FAST, videoBitrateKbps: 2000 } });
    const c = await request(http).post(`/api/video/productions/${production.id}/cancel`).set(auth(owner)).expect(200);
    expect(c.body.status).toBe('cancelled');
    expect((await jobRow(job!.id)).status).toBe('cancelled');
    worker = await createWorker();
  }, 90_000);

  it('marks productions failed when their job ended without a recorded result, and refuses renders of revoked scripts', async () => {
    await worker.close();
    const { production, job } = await createProduction({ scriptId, voiceProfileId: mockVoiceId, settings: { ...FAST, videoBitrateKbps: 1500 } });
    await ds.query(`UPDATE job SET status = 'failed', error = 'Lease expired on final attempt' WHERE id = $1`, [job!.id]);
    await ds.query(`UPDATE video_production SET status = 'rendering' WHERE id = $1`, [production.id]);
    worker = await createWorker();
    expect(await worker.get(VideoProcessor).reconcile()).toBeGreaterThanOrEqual(0);
    const failed = await waitProduction(production.id, ['failed'], 10_000);
    expect(failed.error).toBe('Lease expired on final attempt');

    await ds.query(`UPDATE video_script SET status = 'in_review', approved_version = NULL WHERE id = $1`, [scriptId]);
    try {
      await request(http).post(`/api/video/productions/${production.id}/retry`).set(auth(owner)).expect(409);
      await createProduction({ scriptId, voiceProfileId: mockVoiceId }, owner, 409);
    } finally {
      await ds.query(`UPDATE video_script SET status = 'approved', approved_version = 1 WHERE id = $1`, [scriptId]);
    }
  }, 60_000);

  it('lists productions with filters and audits user actions', async () => {
    const all = await request(http).get('/api/video/productions?limit=100').set(auth(reviewer)).expect(200);
    expect(all.body.total).toBeGreaterThanOrEqual(6);
    const failed = await request(http).get('/api/video/productions?status=failed').set(auth(reviewer)).expect(200);
    expect(failed.body.items.every((p: VideoProductionDto) => p.status === 'failed')).toBe(true);
    await request(http).get('/api/video/productions?status=bogus').set(auth(reviewer)).expect(400);
    const audits = await ds.query<Array<{ action: string }>>(`SELECT DISTINCT action FROM audit_event WHERE action LIKE 'video.%'`);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['video.production_created', 'video.rendered', 'video.production_cancel_requested', 'video.production_retried']));
  });
});
