import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type {
  CreateProductionRequest,
  CreateProductionResponse,
  MediaAssetDto,
  MediaKind,
  Page,
  ProductionStatus,
  QualityReportDto,
  RenderCapabilityDto,
  SignedMediaUrlDto,
  VideoProductionDetailDto,
  VideoProductionDto,
  VideoVersionDto,
  VoiceProfileDto,
} from '@vsf/contracts';
import { AuditService } from '../audit/audit.service';
import { JOB_TYPE_VIDEO_RENDER, QUEUE_RENDER } from '../common/constants';
import type { AppEnv } from '../config/env.schema';
import { MediaAssetEntity, QualityReportEntity, VideoProductionEntity, VideoSceneEntity, VideoVersionEntity, VoiceProfileEntity } from '../database/video.entities';
import { JobsService } from '../jobs/jobs.service';
import { toAssetDto } from './media-assets.service';
import { MediaSigner } from './media-signer';
import { probeVersion } from './process';
import { defaultSettings, InvalidSettingsError, resolveSettings, settingsHash } from './settings';
import { TTS_PROVIDERS, TtsProviders } from './video.pipeline';
import { StorageService } from '../infra/storage.service';

export interface Actor {
  userId: string;
  workspaceId: string;
  correlationId: string | null;
}

interface ProductionRow {
  id: string;
  script_id: string;
  script_title: string;
  script_version: number;
  script_hash: string;
  voice_profile_id: string;
  voice_name: string;
  settings: VideoProductionDto['settings'];
  status: ProductionStatus;
  stage: VideoProductionDto['stage'];
  progress: number;
  error: string | null;
  cancel_requested: boolean;
  render_attempt: number;
  job_id: string | null;
  latest_version: number | null;
  created_at: Date;
  updated_at: Date;
}

const PRODUCTION_SELECT = `
  SELECT p.id, p.script_id, s.title AS script_title, v.version AS script_version, p.script_hash, p.voice_profile_id, vp.name AS voice_name,
         p.settings, p.status, p.stage, p.progress, p.error, p.cancel_requested, p.render_attempt, p.job_id, p.created_at, p.updated_at,
         (SELECT MAX(vv.version) FROM video_version vv WHERE vv.production_id = p.id) AS latest_version
    FROM video_production p
    JOIN video_script s ON s.id = p.script_id
    JOIN script_version v ON v.id = p.script_version_id
    JOIN voice_profile vp ON vp.id = p.voice_profile_id`;

function toProductionDto(r: ProductionRow): VideoProductionDto {
  return {
    id: r.id,
    scriptId: r.script_id,
    scriptTitle: r.script_title,
    scriptVersion: r.script_version,
    scriptHash: r.script_hash,
    voiceProfileId: r.voice_profile_id,
    voiceName: r.voice_name,
    settings: r.settings,
    status: r.status,
    stage: r.stage,
    progress: r.progress,
    error: r.error,
    cancelRequested: r.cancel_requested,
    renderAttempt: r.render_attempt,
    jobId: r.job_id,
    latestVersion: r.latest_version === null ? null : Number(r.latest_version),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export const MEDIA_KINDS: MediaKind[] = ['image', 'audio', 'font', 'music', 'code_frame', 'video', 'captions'];
export const PRODUCTION_STATUSES: ProductionStatus[] = ['queued', 'rendering', 'ready', 'quality_failed', 'failed', 'cancelled'];

@Injectable()
export class VideoService {
  private readonly signer: MediaSigner;
  private readonly urlTtl: number;
  private readonly env: ConfigService<AppEnv, true>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Inject(TTS_PROVIDERS) private readonly tts: TtsProviders,
    config: ConfigService<AppEnv, true>,
  ) {
    this.env = config;
    this.signer = new MediaSigner(config.get('JWT_ACCESS_SECRET', { infer: true }));
    this.urlTtl = config.get('MEDIA_URL_TTL_SECONDS', { infer: true });
    // Fail fast at boot on invalid RENDER_* defaults (otherwise every create would return 400).
    resolveSettings(this.defaults(), undefined);
  }

  private capabilityCache: { at: number; value: Promise<RenderCapabilityDto> } | null = null;

  private defaults() {
    return defaultSettings({
      RENDER_WIDTH: this.env.get('RENDER_WIDTH', { infer: true }),
      RENDER_HEIGHT: this.env.get('RENDER_HEIGHT', { infer: true }),
      RENDER_FPS: this.env.get('RENDER_FPS', { infer: true }),
      RENDER_VIDEO_BITRATE_KBPS: this.env.get('RENDER_VIDEO_BITRATE_KBPS', { infer: true }),
    });
  }

  /** Capabilities of this host (API and worker share one image in deployment). */
  capability(): Promise<RenderCapabilityDto> {
    // Probing spawns processes: cache for a minute.
    if (!this.capabilityCache || Date.now() - this.capabilityCache.at > 60_000) this.capabilityCache = { at: Date.now(), value: this.probeCapability() };
    return this.capabilityCache.value;
  }

  private async probeCapability(): Promise<RenderCapabilityDto> {
    const [ffmpeg, espeak] = await Promise.all([probeVersion(this.env.get('FFMPEG_PATH', { infer: true }), '-version'), probeVersion(this.env.get('ESPEAK_PATH', { infer: true }), '--version')]);
    return {
      ffmpeg: { available: Boolean(ffmpeg), version: ffmpeg },
      espeak: { available: Boolean(espeak), version: espeak },
      defaults: this.defaults(),
      concurrency: this.env.get('RENDER_CONCURRENCY', { infer: true }),
    };
  }

  async voices(workspaceId: string): Promise<VoiceProfileDto[]> {
    const rows = await this.dataSource.getRepository(VoiceProfileEntity).find({ where: { workspaceId }, order: { isDefault: 'DESC', name: 'ASC' } });
    return Promise.all(
      rows.map(async (v) => ({
        id: v.id,
        name: v.name,
        provider: v.provider,
        voiceId: v.voiceId,
        language: v.language,
        rateWpm: v.rateWpm,
        quality: v.quality,
        isDefault: v.isDefault,
        available: this.tts[v.provider] ? (await this.tts[v.provider].available()).ok : false,
      })),
    );
  }

  // ------------------------------------------------------------------ productions

  async create(body: CreateProductionRequest, actor: Actor): Promise<CreateProductionResponse> {
    let settings;
    try {
      settings = resolveSettings(this.defaults(), body.settings);
    } catch (err) {
      if (err instanceof InvalidSettingsError) throw new BadRequestException(err.message);
      throw err;
    }
    const [script] = await this.dataSource.query<Array<{ status: string; approved_version: number | null; version_id: string | null; content_hash: string | null }>>(
      `SELECT s.status, s.approved_version, v.id AS version_id, v.content_hash
         FROM video_script s LEFT JOIN script_version v ON v.script_id = s.id AND v.version = s.approved_version
        WHERE s.id = $1 AND s.workspace_id = $2`,
      [body.scriptId, actor.workspaceId],
    );
    if (!script) throw new NotFoundException('Script not found');
    if (script.status !== 'approved' || !script.version_id || !script.content_hash) throw new ConflictException('Only approved scripts can be rendered');

    const voiceRepo = this.dataSource.getRepository(VoiceProfileEntity);
    const voice = body.voiceProfileId
      ? await voiceRepo.findOne({ where: { id: body.voiceProfileId, workspaceId: actor.workspaceId } })
      : await voiceRepo.findOne({ where: { workspaceId: actor.workspaceId, isDefault: true } });
    if (!voice) throw new BadRequestException('Voice profile not found');

    const inserted = await this.dataSource.query<Array<{ id: string }>>(
      `INSERT INTO video_production (workspace_id, script_id, script_version_id, script_hash, voice_profile_id, settings, settings_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (script_version_id, settings_hash, voice_profile_id) DO NOTHING RETURNING id`,
      [actor.workspaceId, body.scriptId, script.version_id, script.content_hash, voice.id, JSON.stringify(settings), settingsHash(settings), actor.userId],
    );
    const created = inserted.length > 0;
    const prod = await this.dataSource.getRepository(VideoProductionEntity).findOneOrFail({
      where: { scriptVersionId: script.version_id, settingsHash: settingsHash(settings), voiceProfileId: voice.id },
    });
    if (prod.workspaceId !== actor.workspaceId) throw new ForbiddenException();
    // Enqueue when new, or when an earlier request crashed between insert and enqueue (job_id still NULL).
    let job = prod.jobId ? await this.jobs.get(prod.jobId, actor.workspaceId).catch(() => null) : null;
    if (!prod.jobId) job = await this.enqueue(prod, actor);
    if (created) {
      await this.audit.record({
        actorType: 'user',
        actorId: actor.userId,
        workspaceId: actor.workspaceId,
        action: 'video.production_created',
        subjectType: 'video_production',
        subjectId: prod.id,
        outcome: 'success',
        correlationId: actor.correlationId,
        details: { scriptId: body.scriptId, scriptHash: script.content_hash, voice: voice.name, settingsHash: prod.settingsHash },
      });
    }
    return { production: await this.get(actor.workspaceId, prod.id), job, created };
  }

  private enqueue(prod: Pick<VideoProductionEntity, 'id' | 'renderAttempt' | 'workspaceId'>, actor: Actor) {
    return enqueueRender(this.jobs, this.dataSource, prod, actor.userId, actor.correlationId);
  }

  async list(workspaceId: string, q: { status?: string; limit: number; offset: number }): Promise<Page<VideoProductionDto>> {
    const params: unknown[] = [workspaceId];
    let where = `p.workspace_id = $1`;
    if (q.status) {
      params.push(q.status);
      where += ` AND p.status = $${params.length}`;
    }
    const [{ count }] = await this.dataSource.query<Array<{ count: string }>>(`SELECT count(*) FROM video_production p WHERE ${where}`, params);
    const rows = await this.dataSource.query<ProductionRow[]>(`${PRODUCTION_SELECT} WHERE ${where} ORDER BY p.created_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`, params);
    return { items: rows.map(toProductionDto), total: Number(count), limit: q.limit, offset: q.offset };
  }

  async get(workspaceId: string, id: string): Promise<VideoProductionDto> {
    const [row] = await this.dataSource.query<ProductionRow[]>(`${PRODUCTION_SELECT} WHERE p.id = $1 AND p.workspace_id = $2`, [id, workspaceId]);
    if (!row) throw new NotFoundException('Production not found');
    return toProductionDto(row);
  }

  async detail(workspaceId: string, id: string): Promise<VideoProductionDetailDto> {
    const base = await this.get(workspaceId, id);
    const m = this.dataSource.manager;
    const scenes = await m.find(VideoSceneEntity, { where: { productionId: id }, order: { sceneIndex: 'ASC' } });
    const versions = await m.find(VideoVersionEntity, { where: { productionId: id }, order: { version: 'DESC' } });
    const reports = versions.length ? await m.getRepository(QualityReportEntity).createQueryBuilder('q').where('q.video_version_id IN (:...ids)', { ids: versions.map((v) => v.id) }).getMany() : [];
    const assetRows = await this.dataSource.query<Array<{ asset_id: string; role: string; scene_index: number | null }>>(
      `SELECT asset_id, role, scene_index FROM production_asset WHERE production_id = $1 ORDER BY role, scene_index NULLS FIRST`,
      [id],
    );
    const assets = assetRows.length ? await m.getRepository(MediaAssetEntity).createQueryBuilder('a').where('a.id IN (:...ids)', { ids: [...new Set(assetRows.map((a) => a.asset_id))] }).getMany() : [];
    const byId = new Map(assets.map((a) => [a.id, a]));
    const videoBytes = new Map(assets.filter((a) => a.kind === 'video').map((a) => [a.id, a]));
    return {
      ...base,
      scenes: scenes.map((s) => ({
        index: s.sceneIndex,
        startMs: s.startMs,
        endMs: s.endMs,
        narration: s.narration,
        onScreenText: s.onScreenText,
        transition: s.transition,
        audioAssetId: s.audioAssetId,
        frameAssetIds: s.frameAssetIds,
        captions: s.captions,
      })),
      versions: versions.map((v): VideoVersionDto => {
        const q = reports.find((r) => r.videoVersionId === v.id);
        const asset = videoBytes.get(v.videoAssetId) ?? byId.get(v.videoAssetId);
        return {
          id: v.id,
          version: v.version,
          videoAssetId: v.videoAssetId,
          captionsAssetId: v.captionsAssetId,
          thumbnailAssetId: v.thumbnailAssetId,
          width: v.width,
          height: v.height,
          fps: v.fps,
          durationMs: v.durationMs,
          codec: v.codec,
          bitrateKbps: v.bitrateKbps,
          sha256: asset?.sha256 ?? '',
          bytes: asset?.bytes ?? 0,
          quality: q ? toQualityDto(q) : null,
          createdAt: v.createdAt.toISOString(),
        };
      }),
      assets: assetRows.flatMap((r) => {
        const a = byId.get(r.asset_id);
        return a ? [{ ...toAssetDto(a), role: r.role, sceneIndex: r.scene_index }] : [];
      }),
    };
  }

  async cancel(workspaceId: string, id: string, actor: Actor): Promise<VideoProductionDto> {
    const prod = await this.dataSource.getRepository(VideoProductionEntity).findOne({ where: { id, workspaceId } });
    if (!prod) throw new NotFoundException('Production not found');
    if (prod.status !== 'queued' && prod.status !== 'rendering') throw new ConflictException(`A ${prod.status} production cannot be cancelled`);
    await this.dataSource.query(`UPDATE video_production SET cancel_requested = true, updated_at = now() WHERE id = $1 AND status IN ('queued', 'rendering')`, [id]);
    // Not started yet: cancel immediately (the worker never claims a cancelled job; a job linked later sees
    // cancel_requested and stops before rendering).
    if (!prod.jobId || (await this.jobs.cancelQueued(prod.jobId, 'Cancelled by user'))) {
      await this.dataSource.query(`UPDATE video_production SET status = 'cancelled', error = 'Cancelled by user', updated_at = now() WHERE id = $1 AND status = 'queued'`, [id]);
    }
    await this.audit.record({ actorType: 'user', actorId: actor.userId, workspaceId, action: 'video.production_cancel_requested', subjectType: 'video_production', subjectId: id, outcome: 'success', correlationId: actor.correlationId });
    return this.get(workspaceId, id);
  }

  async retry(workspaceId: string, id: string, actor: Actor): Promise<CreateProductionResponse> {
    const next = await this.dataSource.transaction(async (tx) => {
      const [p] = await tx.query<Array<{ status: ProductionStatus; script_version_id: string; script_hash: string; render_attempt: number }>>(
        `SELECT status, script_version_id, script_hash, render_attempt FROM video_production WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [id, workspaceId],
      );
      if (!p) throw new NotFoundException('Production not found');
      if (!['failed', 'quality_failed', 'cancelled'].includes(p.status)) throw new ConflictException(`A ${p.status} production cannot be re-rendered`);
      const [ok] = await tx.query<unknown[]>(
        `SELECT 1 FROM script_version v JOIN video_script s ON s.id = v.script_id
          WHERE v.id = $1 AND s.status = 'approved' AND s.approved_version = v.version AND v.content_hash = $2`,
        [p.script_version_id, p.script_hash],
      );
      if (!ok) throw new ConflictException('The script version is no longer approved');
      await tx.query(
        `UPDATE video_production SET render_attempt = render_attempt + 1, status = 'queued', stage = 'queued', progress = 0, error = NULL,
                cancel_requested = false, job_id = NULL, updated_at = now() WHERE id = $1`,
        [id],
      );
      return p.render_attempt + 1;
    });
    const job = await this.enqueue({ id, renderAttempt: next, workspaceId }, actor);
    await this.audit.record({ actorType: 'user', actorId: actor.userId, workspaceId, action: 'video.production_retried', subjectType: 'video_production', subjectId: id, outcome: 'success', correlationId: actor.correlationId, details: { attempt: next } });
    return { production: await this.get(workspaceId, id), job, created: false };
  }

  // ------------------------------------------------------------------ assets

  async listAssets(workspaceId: string, q: { kind?: string; limit: number; offset: number }): Promise<Page<MediaAssetDto>> {
    const [rows, total] = await this.dataSource.getRepository(MediaAssetEntity).findAndCount({
      where: { workspaceId, ...(q.kind ? { kind: q.kind as MediaKind } : {}) },
      order: { createdAt: 'DESC' },
      take: q.limit,
      skip: q.offset,
    });
    return { items: rows.map(toAssetDto), total, limit: q.limit, offset: q.offset };
  }

  async signedUrl(workspaceId: string, assetId: string): Promise<SignedMediaUrlDto> {
    const exists = await this.dataSource.getRepository(MediaAssetEntity).exist({ where: { id: assetId, workspaceId } });
    if (!exists) throw new NotFoundException('Asset not found');
    const exp = Math.floor(Date.now() / 1000) + this.urlTtl;
    return { url: `/api/video/media/${assetId}?exp=${exp}&sig=${this.signer.sign(assetId, exp)}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Resolves a signed media request; throws 403 for a bad or expired signature. */
  async openMedia(assetId: string, exp: number, sig: string, range: string | undefined) {
    if (!this.signer.verify(assetId, exp, sig)) throw new ForbiddenException('Invalid or expired media link');
    const asset = await this.dataSource.getRepository(MediaAssetEntity).findOne({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');
    const validRange = range && /^bytes=\d*-\d*$/.test(range) && range !== 'bytes=-' ? range : undefined;
    const obj = await this.storage.getObject(asset.storageKey, validRange);
    return { asset, ...obj, partial: Boolean(validRange && obj.contentRange) };
  }
}

export function toQualityDto(q: QualityReportEntity): QualityReportDto {
  return { id: q.id, passed: q.passed, publishable: q.publishable, checks: q.checks, failures: q.failures, createdAt: q.createdAt.toISOString() };
}

/**
 * Creates (idempotently, per production + render attempt) the render job and links it to the production.
 * The worker also takes ownership by render_attempt (see VideoPipeline.render), so a worker that picks the job up
 * before this link is written renders normally, and the reconciler re-runs this for productions left unlinked.
 */
export async function enqueueRender(
  jobs: JobsService,
  dataSource: DataSource,
  prod: Pick<VideoProductionEntity, 'id' | 'renderAttempt' | 'workspaceId'>,
  createdBy: string | null,
  correlationId: string | null,
) {
  const { job } = await jobs.enqueue({
    type: JOB_TYPE_VIDEO_RENDER,
    queue: QUEUE_RENDER,
    idempotencyKey: `video.render:${prod.id}:${prod.renderAttempt}`,
    input: { productionId: prod.id, renderAttempt: prod.renderAttempt },
    maxAttempts: 3,
    createdBy,
    correlationId,
    workspaceId: prod.workspaceId,
  });
  await dataSource.query(`UPDATE video_production SET job_id = $2, updated_at = now() WHERE id = $1 AND render_attempt = $3 AND job_id IS NULL`, [prod.id, job.id, prod.renderAttempt]);
  return job;
}
