import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { CaptionCue, MediaKind, ProductionStatus, QualityCheckDto, RenderSettings, RenderStage, TtsProviderName } from '@vsf/contracts';

const numeric = { to: (v: number) => v, from: (v: string | null) => (v === null ? null : Number(v)) };
const bigint = { to: (v: number) => v, from: (v: string | null) => (v === null ? null : Number(v)) };

@Entity('voice_profile')
export class VoiceProfileEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('text') name: string;
  @Column('text') provider: TtsProviderName;
  @Column('text', { name: 'voice_id' }) voiceId: string;
  @Column('text') language: string;
  @Column('int', { name: 'rate_wpm' }) rateWpm: number;
  @Column('text') quality: 'draft' | 'mock' | 'production';
  @Column('boolean', { name: 'is_default', default: false }) isDefault: boolean;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) params: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('media_asset')
export class MediaAssetEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('text') kind: MediaKind;
  @Column('boolean') generated: boolean;
  @Column('text', { name: 'storage_key' }) storageKey: string;
  @Column('char', { length: 64 }) sha256: string;
  @Column('text') mime: string;
  @Column('bigint', { transformer: bigint }) bytes: number;
  @Column('int', { name: 'duration_ms', nullable: true }) durationMs: number | null;
  @Column('int', { nullable: true }) width: number | null;
  @Column('int', { nullable: true }) height: number | null;
  @Column('text') source: string;
  @Column('text', { name: 'creator_or_provider' }) creatorOrProvider: string;
  @Column('text') license: string;
  @Column('text', { name: 'license_url', nullable: true }) licenseUrl: string | null;
  @Column('text', { name: 'usage_rights' }) usageRights: string;
  @Column('jsonb', { name: 'generation_params', nullable: true }) generationParams: Record<string, unknown> | null;
  @Column('jsonb', { nullable: true }) provenance: Record<string, unknown> | null;
  @Column('text', { name: 'cache_key', nullable: true }) cacheKey: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('video_production')
export class VideoProductionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('uuid', { name: 'script_id' }) scriptId: string;
  @Column('uuid', { name: 'script_version_id' }) scriptVersionId: string;
  @Column('char', { name: 'script_hash', length: 64 }) scriptHash: string;
  @Column('uuid', { name: 'voice_profile_id' }) voiceProfileId: string;
  @Column('jsonb') settings: RenderSettings;
  @Column('char', { name: 'settings_hash', length: 64 }) settingsHash: string;
  @Column('text', { default: 'queued' }) status: ProductionStatus;
  @Column('text', { default: 'queued' }) stage: RenderStage;
  @Column('int', { default: 0 }) progress: number;
  @Column('text', { nullable: true }) error: string | null;
  @Column('boolean', { name: 'cancel_requested', default: false }) cancelRequested: boolean;
  @Column('int', { name: 'render_attempt', default: 1 }) renderAttempt: number;
  @Column('uuid', { name: 'job_id', nullable: true }) jobId: string | null;
  @Column('uuid', { name: 'created_by', nullable: true }) createdBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('video_scene')
export class VideoSceneEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'production_id' }) productionId: string;
  @Column('int', { name: 'scene_index' }) sceneIndex: number;
  @Column('int', { name: 'start_ms' }) startMs: number;
  @Column('int', { name: 'end_ms' }) endMs: number;
  @Column('text') narration: string;
  @Column('text', { name: 'on_screen_text' }) onScreenText: string;
  @Column('text') transition: 'cut' | 'fade' | 'slide' | 'zoom';
  @Column('uuid', { name: 'audio_asset_id', nullable: true }) audioAssetId: string | null;
  @Column('uuid', { name: 'frame_asset_ids', array: true, default: () => "'{}'" }) frameAssetIds: string[];
  @Column('jsonb', { default: () => "'[]'::jsonb" }) captions: CaptionCue[];
}

@Entity('production_asset')
export class ProductionAssetEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'production_id' }) productionId: string;
  @Column('uuid', { name: 'asset_id' }) assetId: string;
  @Column('text') role: string;
  @Column('int', { name: 'scene_index', nullable: true }) sceneIndex: number | null;
}

@Entity('video_version')
export class VideoVersionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'production_id' }) productionId: string;
  @Column('int') version: number;
  @Column('text', { name: 'render_key' }) renderKey: string;
  @Column('uuid', { name: 'video_asset_id' }) videoAssetId: string;
  @Column('uuid', { name: 'captions_asset_id', nullable: true }) captionsAssetId: string | null;
  @Column('uuid', { name: 'thumbnail_asset_id', nullable: true }) thumbnailAssetId: string | null;
  @Column('int') width: number;
  @Column('int') height: number;
  @Column('numeric', { precision: 6, scale: 3, transformer: numeric }) fps: number;
  @Column('int', { name: 'duration_ms' }) durationMs: number;
  @Column('text') codec: string;
  @Column('int', { name: 'bitrate_kbps' }) bitrateKbps: number;
  @Column('uuid', { name: 'job_id', nullable: true }) jobId: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('quality_report')
export class QualityReportEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'video_version_id' }) videoVersionId: string;
  @Column('jsonb') checks: QualityCheckDto[];
  @Column('boolean') passed: boolean;
  @Column('boolean', { default: false }) publishable: boolean;
  @Column('text', { array: true, default: () => "'{}'" }) failures: string[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

export const VIDEO_ENTITIES = [
  VoiceProfileEntity,
  MediaAssetEntity,
  VideoProductionEntity,
  VideoSceneEntity,
  ProductionAssetEntity,
  VideoVersionEntity,
  QualityReportEntity,
];
