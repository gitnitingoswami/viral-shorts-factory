import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 04: media assets with mandatory rights metadata, voice profiles, video productions (one per approved
 * script version + settings + voice), production scenes, versions and quality reports. Render jobs are rows in
 * `job` (type `video.render`).
 */
export class VideoProduction1763360000000 implements MigrationInterface {
  name = 'VideoProduction1763360000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE voice_profile (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        name text NOT NULL,
        provider text NOT NULL CHECK (provider IN ('espeak', 'mock')),
        voice_id text NOT NULL,
        language text NOT NULL,
        rate_wpm int NOT NULL CHECK (rate_wpm BETWEEN 80 AND 300),
        quality text NOT NULL CHECK (quality IN ('draft', 'mock', 'production')),
        is_default boolean NOT NULL DEFAULT false,
        params jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_voice_profile UNIQUE (workspace_id, provider, voice_id, rate_wpm)
      )`);
    await q.query(`CREATE UNIQUE INDEX uq_voice_profile_default ON voice_profile (workspace_id) WHERE is_default`);
    await q.query(`
      INSERT INTO voice_profile (workspace_id, name, provider, voice_id, language, rate_wpm, quality, is_default) VALUES
        ('00000000-0000-4000-8000-000000000001', 'Draft voice (eSpeak NG, US English)', 'espeak', 'en-us', 'en-US', 165, 'draft', true),
        ('00000000-0000-4000-8000-000000000001', 'Mock voice (tone, tests only)', 'mock', 'tone', 'en-US', 150, 'mock', false)`);

    await q.query(`
      CREATE TABLE media_asset (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        kind text NOT NULL CHECK (kind IN ('image', 'audio', 'font', 'music', 'code_frame', 'video', 'captions')),
        generated boolean NOT NULL,
        storage_key text NOT NULL,
        sha256 char(64) NOT NULL,
        mime text NOT NULL,
        bytes bigint NOT NULL CHECK (bytes > 0),
        duration_ms int,
        width int,
        height int,
        source text NOT NULL CHECK (length(source) > 0),
        creator_or_provider text NOT NULL CHECK (length(creator_or_provider) > 0),
        license text NOT NULL CHECK (length(license) > 0),
        license_url text,
        usage_rights text NOT NULL CHECK (length(usage_rights) > 0),
        generation_params jsonb,
        provenance jsonb,
        cache_key text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_media_asset_content UNIQUE (workspace_id, kind, sha256)
      )`);
    await q.query(`CREATE UNIQUE INDEX uq_media_asset_cache ON media_asset (workspace_id, cache_key) WHERE cache_key IS NOT NULL`);
    await q.query(`CREATE INDEX ix_media_asset_ws_created ON media_asset (workspace_id, created_at DESC)`);

    await q.query(`
      CREATE TABLE video_production (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        script_id uuid NOT NULL REFERENCES video_script(id),
        script_version_id uuid NOT NULL REFERENCES script_version(id),
        script_hash char(64) NOT NULL,
        voice_profile_id uuid NOT NULL REFERENCES voice_profile(id),
        settings jsonb NOT NULL,
        settings_hash char(64) NOT NULL,
        status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'rendering', 'ready', 'quality_failed', 'failed', 'cancelled')),
        stage text NOT NULL DEFAULT 'queued' CHECK (stage IN ('queued', 'narration', 'frames', 'compose', 'quality', 'done')),
        progress int NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        error text,
        cancel_requested boolean NOT NULL DEFAULT false,
        render_attempt int NOT NULL DEFAULT 1,
        job_id uuid REFERENCES job(id) ON DELETE SET NULL,
        created_by uuid REFERENCES user_account(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_video_production_identity UNIQUE (script_version_id, settings_hash, voice_profile_id)
      )`);
    await q.query(`CREATE INDEX ix_video_production_ws_created ON video_production (workspace_id, created_at DESC)`);

    await q.query(`
      CREATE TABLE video_scene (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        production_id uuid NOT NULL REFERENCES video_production(id) ON DELETE CASCADE,
        scene_index int NOT NULL CHECK (scene_index >= 0),
        start_ms int NOT NULL,
        end_ms int NOT NULL,
        narration text NOT NULL,
        on_screen_text text NOT NULL,
        transition text NOT NULL,
        audio_asset_id uuid REFERENCES media_asset(id),
        frame_asset_ids uuid[] NOT NULL DEFAULT '{}',
        captions jsonb NOT NULL DEFAULT '[]'::jsonb,
        CONSTRAINT uq_video_scene UNIQUE (production_id, scene_index),
        CONSTRAINT ck_video_scene_time CHECK (end_ms > start_ms)
      )`);

    await q.query(`
      CREATE TABLE production_asset (
        production_id uuid NOT NULL REFERENCES video_production(id) ON DELETE CASCADE,
        asset_id uuid NOT NULL REFERENCES media_asset(id),
        role text NOT NULL,
        scene_index int,
        PRIMARY KEY (production_id, asset_id, role)
      )`);

    await q.query(`
      CREATE TABLE video_version (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        production_id uuid NOT NULL REFERENCES video_production(id) ON DELETE CASCADE,
        version int NOT NULL CHECK (version >= 1),
        render_key text NOT NULL,
        video_asset_id uuid NOT NULL REFERENCES media_asset(id),
        captions_asset_id uuid REFERENCES media_asset(id),
        thumbnail_asset_id uuid REFERENCES media_asset(id),
        width int NOT NULL,
        height int NOT NULL,
        fps numeric(6, 3) NOT NULL,
        duration_ms int NOT NULL,
        codec text NOT NULL,
        bitrate_kbps int NOT NULL,
        job_id uuid REFERENCES job(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_video_version UNIQUE (production_id, version),
        CONSTRAINT uq_video_version_render UNIQUE (production_id, render_key)
      )`);

    await q.query(`
      CREATE TABLE quality_report (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        video_version_id uuid NOT NULL UNIQUE REFERENCES video_version(id) ON DELETE CASCADE,
        checks jsonb NOT NULL,
        passed boolean NOT NULL,
        failures text[] NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE quality_report`);
    await q.query(`DROP TABLE video_version`);
    await q.query(`DROP TABLE production_asset`);
    await q.query(`DROP TABLE video_scene`);
    await q.query(`DROP TABLE video_production`);
    await q.query(`DROP TABLE media_asset`);
    await q.query(`DROP TABLE voice_profile`);
  }
}
