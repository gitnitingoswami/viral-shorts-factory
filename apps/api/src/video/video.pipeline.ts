import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaptionCue, RenderStage, StoryboardSceneDto } from '@vsf/contracts';
import { AuditService } from '../audit/audit.service';
import { BudgetService } from '../budget/budget.service';
import type { AppEnv } from '../config/env.schema';
import type { ScriptBody } from '../database/content.entities';
import { MediaAssetEntity, VideoProductionEntity, VoiceProfileEntity } from '../database/video.entities';
import { StorageService } from '../infra/storage.service';
import { buildCues, toWebVtt } from './captions';
import { compose, ComposeScene, decodeErrors, durationMs, FfmpegBins, integratedLoudness, normalizeSpeech, probe } from './ffmpeg';
import { buildFrameSvg, FONT_FILES, fontsDir, FRAME_RENDERER_REF, renderPng } from './frames';
import { MediaAssetsService } from './media-assets.service';
import { ProcessError, probeVersion } from './process';
import { evaluateQuality, QUALITY_REF, summarize } from './quality';
import { sha256 } from './settings';
import { TtsProvider, TtsUnavailableError } from './tts';

export const TTS_PROVIDERS = Symbol('TTS_PROVIDERS');
export type TtsProviders = Record<string, TtsProvider>;

/** Silence after each scene's narration, and the minimum scene length. */
export const SCENE_PAD_MS = 350;
export const MIN_SCENE_MS = 1200;
/** Extra time (beyond speech) a code scene may stay on screen so viewers can read the code. */
export const CODE_READ_MS = 2000;

/** Retrying will not fix it (approval revoked, provider missing, invalid input). */
export class RenderNonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderNonRetryableError';
  }
}
export class RenderCancelledError extends Error {
  constructor() {
    super('Render cancelled');
    this.name = 'RenderCancelledError';
  }
}
export class RenderLeaseLostError extends Error {
  constructor() {
    super('Render job lease lost; another worker may have taken over');
    this.name = 'RenderLeaseLostError';
  }
}

export interface RenderContext {
  jobId: string;
  workerId: string;
  workspaceId: string;
  signal: AbortSignal;
  /** Render attempt the job was created for (job input); used to take ownership of an unlinked production. */
  renderAttempt: number;
  /** Extends the job lease and records progress; false = lease lost. */
  heartbeat: (progress: number) => Promise<boolean>;
}

export interface RenderOutput {
  productionId: string;
  status: 'ready' | 'quality_failed' | 'cancelled';
  version?: number;
  videoAssetId?: string;
  durationMs?: number;
  /** Passed every check and uses a production voice: the gate for publishing (Phase 05+). */
  publishable?: boolean;
  failures?: string[];
}

interface SceneTiming {
  index: number;
  scene: StoryboardSceneDto;
  startMs: number;
  endMs: number;
  speechMs: number;
  audioAssetId: string;
  audioPath: string;
  cues: CaptionCue[];
  frameAssetIds: string[];
  frames: Array<{ path: string; ms: number }>;
}

/**
 * Renders one production: narration (TTS) → frames → FFmpeg → captions → quality checks → video version.
 * Every intermediate asset is content-addressed and cached by input, so a retried job reuses finished work and
 * never duplicates records; the final version is unique per (production, job).
 */
@Injectable()
export class VideoPipeline {
  private readonly logger = new Logger(VideoPipeline.name);
  private readonly bins: FfmpegBins;
  private readonly timeoutMs: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly assets: MediaAssetsService,
    private readonly storage: StorageService,
    private readonly budget: BudgetService,
    private readonly audit: AuditService,
    @Inject(TTS_PROVIDERS) private readonly tts: TtsProviders,
    config: ConfigService<AppEnv, true>,
  ) {
    this.bins = { ffmpeg: config.get('FFMPEG_PATH', { infer: true }), ffprobe: config.get('FFPROBE_PATH', { infer: true }) };
    this.timeoutMs = config.get('RENDER_TIMEOUT_MS', { infer: true });
  }

  async render(productionId: string, ctx: RenderContext): Promise<RenderOutput> {
    const started = Date.now();
    const m = this.dataSource.manager;
    const prod = await m.findOneBy(VideoProductionEntity, { id: productionId, workspaceId: ctx.workspaceId });
    if (!prod) throw new RenderNonRetryableError('Production not found');
    // Already finished by this job (e.g. the worker died after committing the result but before completing the
    // job, and the job was re-claimed): return the recorded outcome instead of rendering again.
    const finished = await this.finishedResult(prod.id, ctx.jobId);
    if (finished) return finished;
    // Ownership by render attempt: the job created for the current attempt owns the production even if the API
    // has not linked it yet (enqueue dispatches before the link is written).
    await this.dataSource.query(`UPDATE video_production SET job_id = $2 WHERE id = $1 AND render_attempt = $3 AND job_id IS NULL`, [prod.id, ctx.jobId, ctx.renderAttempt]);
    const [{ job_id: ownerJob }] = await this.dataSource.query<Array<{ job_id: string | null }>>(`SELECT job_id FROM video_production WHERE id = $1`, [prod.id]);
    if (ownerJob !== ctx.jobId) throw new RenderNonRetryableError('Superseded by a newer render job');
    if (prod.status === 'cancelled' || prod.cancelRequested) return this.markCancelled(prod.id, ctx);
    if (!['queued', 'rendering'].includes(prod.status)) throw new RenderNonRetryableError(`Production is ${prod.status}; start a new render attempt instead`);

    const scenes = await this.loadApprovedScenes(prod);
    const voice = await m.findOneByOrFail(VoiceProfileEntity, { id: prod.voiceProfileId });
    const provider = this.tts[voice.provider];
    if (!provider) throw new RenderNonRetryableError(`TTS provider "${voice.provider}" is not configured`);
    if (!(await provider.available()).ok) throw new RenderNonRetryableError(`TTS provider "${voice.provider}" is not available on this worker`);
    const ffmpegVersion = await probeVersion(this.bins.ffmpeg, '-version');
    if (!ffmpegVersion) throw new RenderNonRetryableError('FFmpeg is not installed on this worker');

    await this.dataSource.query(
      `UPDATE video_production SET status = 'rendering', stage = 'narration', progress = 2, error = NULL, updated_at = now() WHERE id = $1 AND job_id = $2 AND status IN ('queued', 'rendering')`,
      [prod.id, ctx.jobId],
    );
    const workDir = await mkdtemp(join(tmpdir(), 'vsf-render-'));
    try {
      // ---- fonts (provenance of everything that appears on screen)
      const fonts = await this.registerFonts(prod);

      // ---- narration
      const timings: SceneTiming[] = [];
      let cursor = 0;
      for (const [i, scene] of scenes.entries()) {
        this.throwIfCancelled(ctx);
        const audio = await this.narrate(prod, voice, provider, scene, i, workDir, ctx);
        const speechMs = audio.durationMs ?? 0;
        let sceneMs = Math.max(speechMs + SCENE_PAD_MS, MIN_SCENE_MS);
        if (scene.code) sceneMs = Math.max(sceneMs, Math.min(scene.durationSec * 1000, speechMs + CODE_READ_MS));
        timings.push({
          index: i,
          scene,
          startMs: cursor,
          endMs: cursor + sceneMs,
          speechMs,
          audioAssetId: audio.id,
          audioPath: audio.path,
          cues: buildCues(scene.narration, cursor, speechMs, cursor + sceneMs),
          frameAssetIds: [],
          frames: [],
        });
        cursor += sceneMs;
        await this.progress(prod.id, ctx, 'narration', 5 + Math.round((30 * (i + 1)) / scenes.length));
      }
      const totalMs = cursor;

      // ---- frames
      const notes = { truncatedCodeLines: 0, headlineOverflows: 0 };
      const s = prod.settings;
      for (const t of timings) {
        this.throwIfCancelled(ctx);
        const slots = s.burnCaptions && t.cues.length ? t.cues.map((c) => ({ caption: c.lines, startMs: c.startMs, ms: c.endMs - c.startMs })) : [{ caption: null, startMs: t.startMs, ms: t.endMs - t.startMs }];
        for (const slot of slots) {
          const { svg, notes: n } = buildFrameSvg({
            width: s.width,
            height: s.height,
            headline: t.scene.onScreenText || t.scene.narration.slice(0, 80),
            code: t.scene.code,
            caption: slot.caption,
            progress: slot.startMs / totalMs,
            sceneLabel: `${t.index + 1}/${timings.length}`,
          });
          if (slot === slots[0]) {
            notes.truncatedCodeLines += n.truncatedCodeLines;
            if (!n.headlineFits) notes.headlineOverflows++;
          }
          const asset = await this.frameAsset(prod, svg, t.scene.code ? 'code_frame' : 'image', { scriptVersionId: prod.scriptVersionId, sceneIndex: t.index });
          const path = join(workDir, `f-${asset.sha256.slice(0, 16)}.png`);
          await writeFile(path, asset.body);
          t.frameAssetIds.push(asset.entity.id);
          t.frames.push({ path, ms: slot.ms });
          await this.assets.link(prod.id, asset.entity.id, 'frame', t.index);
        }
        await this.progress(prod.id, ctx, 'frames', 35 + Math.round((20 * (t.index + 1)) / timings.length));
      }
      // Thumbnail: the hook frame without captions.
      const thumbSvg = buildFrameSvg({ width: s.width, height: s.height, headline: scenes[0].onScreenText || scenes[0].narration.slice(0, 80), code: scenes[0].code, caption: null, progress: 0, sceneLabel: '' }).svg;
      const thumb = await this.frameAsset(prod, thumbSvg, 'image', { scriptVersionId: prod.scriptVersionId, purpose: 'thumbnail' });
      await this.assets.link(prod.id, thumb.entity.id, 'thumbnail', 0);
      await this.saveScenes(prod.id, ctx.jobId, timings);

      // ---- compose
      this.throwIfCancelled(ctx);
      const out = join(workDir, 'output.mp4');
      const composeScenes: ComposeScene[] = timings.map((t) => ({ audioPath: t.audioPath, durationMs: t.endMs - t.startMs, frames: t.frames }));
      let lastBeat = 0;
      await compose(
        this.bins,
        {
          workDir,
          scenes: composeScenes,
          settings: s,
          output: out,
          onProgress: (f) => {
            const now = Date.now();
            if (now - lastBeat < 2000) return;
            lastBeat = now;
            void this.progress(prod.id, ctx, 'compose', 55 + Math.round(30 * f)).catch(() => undefined);
          },
        },
        this.step(ctx),
      );
      await this.progress(prod.id, ctx, 'compose', 85);

      // ---- outputs
      const cues = timings.flatMap((t) => t.cues);
      const vtt = await this.assets.store({
        workspaceId: prod.workspaceId,
        kind: 'captions',
        generated: true,
        body: Buffer.from(toWebVtt(cues), 'utf8'),
        mime: 'text/vtt',
        ext: 'vtt',
        rights: ORIGINAL_RIGHTS('generated:captions@1'),
        generationParams: { from: 'script narration', cues: cues.length },
        provenance: { scriptVersionId: prod.scriptVersionId, productionId: prod.id },
      });
      await this.assets.link(prod.id, vtt.id, 'captions', null);

      const p = await probe(this.bins, out, this.step(ctx));
      const video = await this.assets.store({
        workspaceId: prod.workspaceId,
        kind: 'video',
        generated: true,
        body: { path: out },
        mime: 'video/mp4',
        ext: 'mp4',
        durationMs: durationMs(p),
        width: s.width,
        height: s.height,
        rights: {
          source: 'generated:video-renderer@1',
          creatorOrProvider: 'Viral Shorts Factory renderer (FFmpeg)',
          license: 'Original work owned by the workspace; composed only of the workspace-owned and licensed assets linked to this production',
          licenseUrl: null,
          usageRights: voice.quality === 'production' ? 'Publishable after review' : voice.quality === 'draft' ? 'Draft: replace the voice before publishing' : 'Test render only',
        },
        generationParams: { settings: s, frameRenderer: FRAME_RENDERER_REF, ffmpeg: ffmpegVersion, voiceProfileId: voice.id },
        provenance: { scriptId: prod.scriptId, scriptVersionId: prod.scriptVersionId, scriptHash: prod.scriptHash, productionId: prod.id, jobId: ctx.jobId, fonts: fonts.map((f) => f.id) },
      });
      await this.assets.link(prod.id, video.id, 'video', null);

      // ---- quality
      this.throwIfCancelled(ctx);
      await this.progress(prod.id, ctx, 'quality', 88);
      const [missing, decode, loudness] = [
        await this.assets.verifyStored(prod.id),
        await decodeErrors(this.bins, out, this.step(ctx)),
        await integratedLoudness(this.bins, out, this.step(ctx)),
      ];
      const checks = evaluateQuality({
        settings: s,
        probe: p,
        decodeErrors: decode,
        loudnessLufs: loudness,
        cues,
        missingAssets: missing,
        voiceQuality: voice.quality,
        simplifiedTransitions: scenes.filter((sc) => sc.transition !== 'cut').length,
        truncatedCodeLines: notes.truncatedCodeLines,
        headlineOverflows: notes.headlineOverflows,
        expectedDurationMs: totalMs,
      });
      const summary = summarize(checks);

      const result = await this.finalize(prod, ctx, { video, vtt, thumb: thumb.entity, probe: p, checks, summary });
      await this.budget.record({
        workspaceId: prod.workspaceId,
        provider: 'local-ffmpeg',
        category: 'render',
        units: Math.round((Date.now() - started) / 1000),
        unit: `compute-seconds:${QUALITY_REF}`,
        amountMinor: 0,
        relatedType: 'video_production',
        relatedId: prod.id,
        jobId: ctx.jobId,
      });
      return result;
    } catch (err) {
      if (ctx.signal.aborted) throw abortError(ctx.signal);
      if (err instanceof ProcessError && err.reason === 'spawn') throw new RenderNonRetryableError(err.message);
      if (err instanceof TtsUnavailableError) throw new RenderNonRetryableError(err.message);
      throw err;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async finishedResult(productionId: string, jobId: string): Promise<RenderOutput | null> {
    const [row] = await this.dataSource.query<Array<{ version: number; video_asset_id: string; duration_ms: number; passed: boolean | null; publishable: boolean | null; failures: string[] | null }>>(
      `SELECT v.version, v.video_asset_id, v.duration_ms, q.passed, q.publishable, q.failures
         FROM video_version v LEFT JOIN quality_report q ON q.video_version_id = v.id
        WHERE v.production_id = $1 AND v.render_key = $2`,
      [productionId, jobId],
    );
    if (!row) return null;
    return { productionId, status: row.passed ? 'ready' : 'quality_failed', version: row.version, videoAssetId: row.video_asset_id, durationMs: row.duration_ms, publishable: row.publishable === true, failures: row.failures ?? [] };
  }

  /** Cancellation outcome: production cancelled; no version is created. */
  async markCancelled(productionId: string, ctx: Pick<RenderContext, 'jobId'>): Promise<RenderOutput> {
    await this.dataSource.query(
      `UPDATE video_production SET status = 'cancelled', error = 'Cancelled by user', updated_at = now() WHERE id = $1 AND job_id = $2 AND status IN ('queued', 'rendering', 'cancelled')`,
      [productionId, ctx.jobId],
    );
    return { productionId, status: 'cancelled' };
  }

  /** Final failure (retries exhausted or non-retryable). */
  async markFailed(productionId: string, jobId: string, message: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE video_production SET status = 'failed', error = $3, updated_at = now() WHERE id = $1 AND job_id = $2 AND status IN ('queued', 'rendering')`,
      [productionId, jobId, message.slice(0, 500)],
    );
  }

  /** Attempt failed but will be retried: keep the error visible. */
  async markRetrying(productionId: string, jobId: string, message: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE video_production SET status = 'queued', stage = 'queued', error = $3, updated_at = now() WHERE id = $1 AND job_id = $2 AND status IN ('queued', 'rendering')`,
      [productionId, jobId, `Retrying after: ${message}`.slice(0, 500)],
    );
  }

  // ------------------------------------------------------------------ steps

  private async loadApprovedScenes(prod: VideoProductionEntity): Promise<StoryboardSceneDto[]> {
    const [row] = await this.dataSource.query<Array<{ status: string; approved_version: number | null; version: number; content_hash: string; body: ScriptBody }>>(
      `SELECT s.status, s.approved_version, v.version, v.content_hash, v.body
         FROM script_version v JOIN video_script s ON s.id = v.script_id WHERE v.id = $1`,
      [prod.scriptVersionId],
    );
    if (!row) throw new RenderNonRetryableError('Script version not found');
    if (row.status !== 'approved' || row.approved_version !== row.version || row.content_hash !== prod.scriptHash) {
      throw new RenderNonRetryableError('The script version is no longer approved; approve it again before rendering');
    }
    const scenes = row.body.scenes;
    if (!scenes?.length) throw new RenderNonRetryableError('Script has no scenes');
    return scenes;
  }

  private async registerFonts(prod: VideoProductionEntity): Promise<MediaAssetEntity[]> {
    const dir = fontsDir();
    const out: MediaAssetEntity[] = [];
    for (const file of FONT_FILES) {
      const body = await readFile(join(dir, file));
      const a = await this.assets.store({
        workspaceId: prod.workspaceId,
        kind: 'font',
        generated: false,
        body,
        mime: 'font/ttf',
        ext: 'ttf',
        rights: {
          source: 'bundled:assets/fonts',
          creatorOrProvider: 'The JetBrains Mono Project Authors',
          license: 'SIL Open Font License 1.1',
          licenseUrl: 'https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt',
          usageRights: 'Free for commercial use, embedding and rendering into videos',
        },
        provenance: { file, upstream: 'https://github.com/JetBrains/JetBrainsMono', release: 'v2.304' },
      });
      await this.assets.link(prod.id, a.id, 'font', null);
      out.push(a);
    }
    return out;
  }

  private async narrate(
    prod: VideoProductionEntity,
    voice: VoiceProfileEntity,
    provider: TtsProvider,
    scene: StoryboardSceneDto,
    index: number,
    workDir: string,
    ctx: RenderContext,
  ): Promise<{ id: string; path: string; durationMs: number | null }> {
    const cacheKey = `tts:${sha256(JSON.stringify([voice.provider, voice.voiceId, voice.rateWpm, voice.params, scene.narration]))}`;
    const path = join(workDir, `a-${index}.wav`);
    const cached = await this.assets.findByCacheKey(prod.workspaceId, cacheKey);
    if (cached && (await this.storage.headObject(cached.storageKey))) {
      await writeFile(path, await this.storage.getObjectBuffer(cached.storageKey));
      await this.assets.link(prod.id, cached.id, 'narration', index);
      return { id: cached.id, path, durationMs: cached.durationMs };
    }
    const res = await provider.synthesize(scene.narration, { provider: voice.provider, voiceId: voice.voiceId, rateWpm: voice.rateWpm, language: voice.language }, this.step(ctx));
    const raw = join(workDir, `raw-${index}.wav`);
    await writeFile(raw, res.wav);
    await normalizeSpeech(this.bins, raw, path, this.step(ctx));
    const body = await readFile(path);
    const dur = durationMs(await probe(this.bins, path, this.step(ctx)));
    const asset = await this.assets.store({
      workspaceId: prod.workspaceId,
      kind: 'audio',
      generated: true,
      body,
      mime: 'audio/wav',
      ext: 'wav',
      durationMs: dur,
      rights: res.rights,
      generationParams: { provider: voice.provider, voiceId: voice.voiceId, rateWpm: voice.rateWpm, model: res.model, textSha256: sha256(scene.narration), processing: '48kHz mono, silence trimmed' },
      provenance: { scriptVersionId: prod.scriptVersionId, sceneIndex: index, mock: res.mock },
      cacheKey,
    });
    if (!res.mock) {
      await this.budget.record({
        workspaceId: prod.workspaceId,
        provider: voice.provider,
        category: 'tts',
        units: res.units,
        unit: `chars:${res.model}`,
        amountMinor: res.costMinor,
        relatedType: 'video_production',
        relatedId: prod.id,
        jobId: ctx.jobId,
      });
    }
    await this.assets.link(prod.id, asset.id, 'narration', index);
    return { id: asset.id, path, durationMs: asset.durationMs ?? dur };
  }

  private async frameAsset(prod: VideoProductionEntity, svg: string, kind: 'image' | 'code_frame', provenance: Record<string, unknown>): Promise<{ entity: MediaAssetEntity; body: Buffer; sha256: string }> {
    const cacheKey = `frame:${sha256(`${FRAME_RENDERER_REF}\n${svg}`)}`;
    const cached = await this.assets.findByCacheKey(prod.workspaceId, cacheKey);
    if (cached && (await this.storage.headObject(cached.storageKey))) {
      return { entity: cached, body: await this.storage.getObjectBuffer(cached.storageKey), sha256: cached.sha256 };
    }
    const body = renderPng(svg);
    const entity = await this.assets.store({
      workspaceId: prod.workspaceId,
      kind,
      generated: true,
      body,
      mime: 'image/png',
      ext: 'png',
      width: prod.settings.width,
      height: prod.settings.height,
      rights: ORIGINAL_RIGHTS(`generated:${FRAME_RENDERER_REF}`),
      generationParams: { renderer: FRAME_RENDERER_REF, svgSha256: sha256(svg) },
      provenance,
      cacheKey,
    });
    return { entity, body, sha256: entity.sha256 };
  }

  private async saveScenes(productionId: string, jobId: string, timings: SceneTiming[]): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const [own] = await tx.query<Array<{ id: string }>>(`SELECT id FROM video_production WHERE id = $1 AND job_id = $2 FOR UPDATE`, [productionId, jobId]);
      if (!own) throw new RenderNonRetryableError('Superseded by a newer render job');
      await tx.query(`DELETE FROM video_scene WHERE production_id = $1`, [productionId]);
      for (const t of timings) {
        await tx.query(
          `INSERT INTO video_scene (production_id, scene_index, start_ms, end_ms, narration, on_screen_text, transition, audio_asset_id, frame_asset_ids, captions)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[],$10)`,
          [productionId, t.index, t.startMs, t.endMs, t.scene.narration, t.scene.onScreenText, t.scene.transition, t.audioAssetId, t.frameAssetIds, JSON.stringify(t.cues)],
        );
      }
    });
  }

  private async finalize(
    prod: VideoProductionEntity,
    ctx: RenderContext,
    r: { video: MediaAssetEntity; vtt: MediaAssetEntity; thumb: MediaAssetEntity; probe: Awaited<ReturnType<typeof probe>>; checks: ReturnType<typeof evaluateQuality>; summary: { passed: boolean; publishable: boolean; failures: string[] } },
  ): Promise<RenderOutput> {
    const v = r.probe.streams.find((x) => x.codec_type === 'video');
    const out = await this.dataSource.transaction(async (tx): Promise<RenderOutput> => {
      // Lease-checked: only the worker that owns the job may publish its result.
      const [job] = await tx.query<Array<{ id: string }>>(`SELECT id FROM job WHERE id = $1 AND status = 'running' AND lease_owner = $2 FOR UPDATE`, [ctx.jobId, ctx.workerId]);
      if (!job) throw new RenderLeaseLostError();
      const [p] = await tx.query<Array<{ cancel_requested: boolean; job_id: string | null }>>(`SELECT cancel_requested, job_id FROM video_production WHERE id = $1 FOR UPDATE`, [prod.id]);
      if (p.job_id !== ctx.jobId) throw new RenderNonRetryableError('Superseded by a newer render job');
      // The approval may have been revoked while rendering: never record a version for an unapproved script.
      const [approved] = await tx.query<unknown[]>(
        `SELECT 1 FROM script_version v JOIN video_script s ON s.id = v.script_id
          WHERE v.id = $1 AND s.status = 'approved' AND s.approved_version = v.version AND v.content_hash = $2 FOR SHARE OF s`,
        [prod.scriptVersionId, prod.scriptHash],
      );
      if (!approved) throw new RenderNonRetryableError('The script approval was revoked during rendering; approve it again and retry');
      if (p.cancel_requested) {
        await tx.query(`UPDATE video_production SET status = 'cancelled', error = 'Cancelled by user', updated_at = now() WHERE id = $1`, [prod.id]);
        return { productionId: prod.id, status: 'cancelled' };
      }
      // One version per render job: a retried/taken-over job reuses its row instead of adding another.
      await tx.query(
        `INSERT INTO video_version (production_id, version, render_key, video_asset_id, captions_asset_id, thumbnail_asset_id, width, height, fps, duration_ms, codec, bitrate_kbps, job_id)
         SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12 FROM video_version WHERE production_id = $1
         ON CONFLICT (production_id, render_key) DO UPDATE SET video_asset_id = EXCLUDED.video_asset_id, captions_asset_id = EXCLUDED.captions_asset_id,
           thumbnail_asset_id = EXCLUDED.thumbnail_asset_id, duration_ms = EXCLUDED.duration_ms, bitrate_kbps = EXCLUDED.bitrate_kbps`,
        [
          prod.id,
          ctx.jobId,
          r.video.id,
          r.vtt.id,
          r.thumb.id,
          v?.width ?? prod.settings.width,
          v?.height ?? prod.settings.height,
          prod.settings.fps,
          r.video.durationMs ?? 0,
          v?.codec_name ?? 'unknown',
          Math.round(Number(r.probe.format.bit_rate ?? 0) / 1000),
          ctx.jobId,
        ],
      );
      const [ver] = await tx.query<Array<{ id: string; version: number }>>(`SELECT id, version FROM video_version WHERE production_id = $1 AND render_key = $2`, [prod.id, ctx.jobId]);
      await tx.query(
        `INSERT INTO quality_report (video_version_id, checks, passed, publishable, failures) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (video_version_id) DO UPDATE SET checks = EXCLUDED.checks, passed = EXCLUDED.passed, publishable = EXCLUDED.publishable,
           failures = EXCLUDED.failures, created_at = now()`,
        [ver.id, JSON.stringify(r.checks), r.summary.passed, r.summary.publishable, r.summary.failures],
      );
      const status = r.summary.passed ? 'ready' : 'quality_failed';
      await tx.query(
        `UPDATE video_production SET status = $2, stage = 'done', progress = 100, error = $3, updated_at = now() WHERE id = $1`,
        [prod.id, status, r.summary.passed ? null : `Quality checks failed: ${r.summary.failures.length}`],
      );
      return { productionId: prod.id, status, version: ver.version, videoAssetId: r.video.id, durationMs: r.video.durationMs ?? 0, publishable: r.summary.publishable, failures: r.summary.failures };
    });
    await this.audit.record({
      actorType: 'worker',
      workspaceId: prod.workspaceId,
      action: 'video.rendered',
      subjectType: 'video_production',
      subjectId: prod.id,
      outcome: out.status === 'ready' ? 'success' : 'failure',
      details: { status: out.status, version: out.version, failures: out.failures?.length ?? 0, sha256: r.video.sha256 },
    });
    return out;
  }

  private async progress(productionId: string, ctx: RenderContext, stage: RenderStage, progress: number): Promise<void> {
    if (!(await ctx.heartbeat(progress))) throw new RenderLeaseLostError();
    await this.dataSource.query(`UPDATE video_production SET stage = $3, progress = $4, updated_at = now() WHERE id = $1 AND job_id = $2 AND status = 'rendering'`, [
      productionId,
      ctx.jobId,
      stage,
      progress,
    ]);
  }

  private throwIfCancelled(ctx: RenderContext): void {
    if (ctx.signal.aborted) throw abortError(ctx.signal);
  }

  private step(ctx: RenderContext) {
    return { signal: ctx.signal, timeoutMs: this.timeoutMs };
  }
}

/** The processor aborts with reason 'lease' when the job lease is lost, otherwise it is a user cancellation. */
export const ABORT_LEASE = 'lease';
export const ABORT_CANCEL = 'cancel';
export const ABORT_DEADLINE = 'deadline';
function abortError(signal: AbortSignal): Error {
  if (signal.reason === ABORT_LEASE) return new RenderLeaseLostError();
  if (signal.reason === ABORT_DEADLINE) return new Error('Render exceeded its overall deadline'); // retryable
  return new RenderCancelledError();
}

const ORIGINAL_RIGHTS = (source: string) => ({
  source,
  creatorOrProvider: 'Viral Shorts Factory (generated in-house)',
  license: 'Original work owned by the workspace',
  licenseUrl: null,
  usageRights: 'Unrestricted use by the workspace',
});
