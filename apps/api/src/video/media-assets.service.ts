import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { MediaAssetDto, MediaKind } from '@vsf/contracts';
import { MediaAssetEntity } from '../database/video.entities';
import { StorageService } from '../infra/storage.service';
import { sha256 } from './settings';
import type { AssetRights } from './tts';

export interface StoreAssetInput {
  workspaceId: string;
  kind: MediaKind;
  generated: boolean;
  body: Buffer;
  mime: string;
  ext: string;
  rights: AssetRights;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  generationParams?: Record<string, unknown> | null;
  provenance?: Record<string, unknown> | null;
  /** Deterministic key of the inputs that produced the asset (lets retries skip regeneration). */
  cacheKey?: string | null;
}

export function toAssetDto(a: MediaAssetEntity): MediaAssetDto {
  return {
    id: a.id,
    kind: a.kind,
    generated: a.generated,
    mime: a.mime,
    bytes: a.bytes,
    sha256: a.sha256,
    durationMs: a.durationMs,
    width: a.width,
    height: a.height,
    source: a.source,
    creatorOrProvider: a.creatorOrProvider,
    license: a.license,
    licenseUrl: a.licenseUrl,
    usageRights: a.usageRights,
    generationParams: a.generationParams,
    provenance: a.provenance,
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * Content-addressed asset store: the object key is derived from the SHA-256, and (workspace, kind, sha256) is
 * unique, so storing the same bytes twice (e.g. a retried job) returns the existing row instead of a duplicate.
 * Rights metadata is mandatory (enforced by the type here and NOT NULL/CHECK constraints in the DB).
 */
@Injectable()
export class MediaAssetsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storage: StorageService,
  ) {}

  async findByCacheKey(workspaceId: string, cacheKey: string): Promise<MediaAssetEntity | null> {
    return this.dataSource.getRepository(MediaAssetEntity).findOne({ where: { workspaceId, cacheKey } });
  }

  async store(input: StoreAssetInput): Promise<MediaAssetEntity> {
    for (const [k, v] of Object.entries(input.rights)) {
      if (k !== 'licenseUrl' && (typeof v !== 'string' || !v.trim())) throw new Error(`Asset rights metadata "${k}" is required`);
    }
    const hash = sha256(input.body);
    const repo = this.dataSource.getRepository(MediaAssetEntity);
    const existing = await repo.findOne({ where: { workspaceId: input.workspaceId, kind: input.kind, sha256: hash } });
    if (existing) {
      // Make sure the object still exists (e.g. a crash between upload and insert on a previous attempt).
      if (!(await this.storage.headObject(existing.storageKey))) await this.storage.putObject(existing.storageKey, input.body, existing.mime);
      return existing;
    }
    const key = `assets/${input.workspaceId}/${input.kind}/${hash.slice(0, 2)}/${hash}.${input.ext}`;
    await this.storage.putObject(key, input.body, input.mime);
    await this.dataSource.query(
      `INSERT INTO media_asset (workspace_id, kind, generated, storage_key, sha256, mime, bytes, duration_ms, width, height,
         source, creator_or_provider, license, license_url, usage_rights, generation_params, provenance, cache_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT DO NOTHING`,
      [
        input.workspaceId,
        input.kind,
        input.generated,
        key,
        hash,
        input.mime,
        input.body.length,
        input.durationMs ?? null,
        input.width ?? null,
        input.height ?? null,
        input.rights.source,
        input.rights.creatorOrProvider,
        input.rights.license,
        input.rights.licenseUrl,
        input.rights.usageRights,
        input.generationParams ? JSON.stringify(input.generationParams) : null,
        input.provenance ? JSON.stringify(input.provenance) : null,
        input.cacheKey ?? null,
      ],
    );
    const row = await repo.findOne({ where: { workspaceId: input.workspaceId, kind: input.kind, sha256: hash } });
    if (row) return row;
    // Same bytes stored under another cache key concurrently, or same cache key with different bytes: resolve by cache key.
    if (input.cacheKey) {
      const byKey = await this.findByCacheKey(input.workspaceId, input.cacheKey);
      if (byKey) return byKey;
    }
    throw new Error('Asset insert conflicted and no existing row was found');
  }

  async link(productionId: string, assetId: string, role: string, sceneIndex: number | null, em?: EntityManager): Promise<void> {
    await (em ?? this.dataSource.manager).query(
      `INSERT INTO production_asset (production_id, asset_id, role, scene_index) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [productionId, assetId, role, sceneIndex],
    );
  }

  /** IDs of the production's assets whose stored object is missing or has a different size. */
  async verifyStored(productionId: string): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ id: string; storage_key: string; bytes: string; role: string }>>(
      `SELECT DISTINCT a.id, a.storage_key, a.bytes, pa.role FROM production_asset pa JOIN media_asset a ON a.id = pa.asset_id WHERE pa.production_id = $1`,
      [productionId],
    );
    const missing: string[] = [];
    for (const r of rows) {
      const head = await this.storage.headObject(r.storage_key);
      if (!head || head.bytes !== Number(r.bytes)) missing.push(`${r.role}:${r.id.slice(0, 8)}`);
    }
    return missing;
  }
}
