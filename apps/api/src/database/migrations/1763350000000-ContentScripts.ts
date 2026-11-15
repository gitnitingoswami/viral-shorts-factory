import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 03: content ideas, scripts with immutable versions, storyboard scenes, claims (fact-check),
 * code verification and reviews. Approval is bound to a version's content hash.
 */
export class ContentScripts1763350000000 implements MigrationInterface {
  name = 'ContentScripts1763350000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE content_idea (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        topic_id uuid NOT NULL REFERENCES trend_topic(id) ON DELETE CASCADE,
        title text NOT NULL,
        audience text NOT NULL,
        angle text NOT NULL,
        hook text NOT NULL,
        value_proposition text NOT NULL,
        format text NOT NULL CHECK (format IN ('quick-tip', 'how-to', 'myth-vs-fact', 'comparison', 'quick-fix', 'explainer')),
        target_duration_sec int NOT NULL CHECK (target_duration_sec BETWEEN 15 AND 90),
        source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
        similarity_score numeric(4, 3) NOT NULL DEFAULT 0,
        duplicate_of_id uuid REFERENCES content_idea(id) ON DELETE SET NULL,
        status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'selected', 'discarded')),
        llm_model text NOT NULL,
        prompt_ref text NOT NULL,
        llm_mock boolean NOT NULL,
        job_id uuid REFERENCES job(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX ix_content_idea_topic ON content_idea (topic_id)`);
    await q.query(`CREATE INDEX ix_content_idea_ws_created ON content_idea (workspace_id, created_at DESC)`);

    await q.query(`
      CREATE TABLE video_script (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        idea_id uuid NOT NULL REFERENCES content_idea(id),
        title text NOT NULL,
        status text NOT NULL DEFAULT 'drafting' CHECK (status IN ('drafting', 'in_review', 'approved', 'rejected')),
        current_version int NOT NULL DEFAULT 0,
        approved_version int,
        job_id uuid REFERENCES job(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_video_script_idea UNIQUE (idea_id)
      )`);

    await q.query(`
      CREATE TABLE script_version (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        script_id uuid NOT NULL REFERENCES video_script(id) ON DELETE CASCADE,
        version int NOT NULL CHECK (version >= 1),
        author_type text NOT NULL CHECK (author_type IN ('ai', 'human')),
        author_id uuid REFERENCES user_account(id) ON DELETE SET NULL,
        title text NOT NULL,
        body jsonb NOT NULL,
        content_hash char(64) NOT NULL,
        word_count int NOT NULL,
        est_duration_sec int NOT NULL,
        llm_model text,
        prompt_ref text,
        llm_mock boolean,
        fact_check_state text NOT NULL DEFAULT 'pending' CHECK (fact_check_state IN ('pending', 'running', 'done', 'failed')),
        quality_state text NOT NULL DEFAULT 'pending' CHECK (quality_state IN ('pending', 'running', 'done', 'failed')),
        code_state text NOT NULL DEFAULT 'pending' CHECK (code_state IN ('pending', 'running', 'done', 'failed')),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_script_version UNIQUE (script_id, version)
      )`);
    // Versions are immutable: content columns can never change after insert (check states may).
    await q.query(`
      CREATE FUNCTION script_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.body IS DISTINCT FROM OLD.body OR NEW.title IS DISTINCT FROM OLD.title
           OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.version IS DISTINCT FROM OLD.version
           OR NEW.script_id IS DISTINCT FROM OLD.script_id OR NEW.author_type IS DISTINCT FROM OLD.author_type THEN
          RAISE EXCEPTION 'script_version content is immutable';
        END IF;
        RETURN NEW;
      END;
      $$`);
    await q.query(`
      CREATE TRIGGER trg_script_version_immutable BEFORE UPDATE ON script_version
      FOR EACH ROW EXECUTE FUNCTION script_version_immutable()`);

    await q.query(`
      CREATE TABLE script_claim (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        script_version_id uuid NOT NULL REFERENCES script_version(id) ON DELETE CASCADE,
        scene_index int NOT NULL,
        text text NOT NULL,
        verdict text NOT NULL DEFAULT 'pending' CHECK (verdict IN ('pending', 'supported', 'unsupported', 'contradicted', 'overridden')),
        evidence text,
        source_ref jsonb,
        override_reason text,
        overridden_by uuid REFERENCES user_account(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX ix_script_claim_version ON script_claim (script_version_id)`);

    await q.query(`
      CREATE TABLE code_verification (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        script_version_id uuid NOT NULL REFERENCES script_version(id) ON DELETE CASCADE,
        scene_index int NOT NULL,
        language text NOT NULL,
        code_hash char(64) NOT NULL,
        status text NOT NULL CHECK (status IN ('pending', 'passed', 'failed', 'not_executable', 'unavailable', 'overridden')),
        stdout text NOT NULL DEFAULT '',
        stderr text NOT NULL DEFAULT '',
        duration_ms int,
        override_reason text,
        overridden_by uuid REFERENCES user_account(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_code_verification UNIQUE (script_version_id, scene_index)
      )`);

    await q.query(`
      CREATE TABLE script_review (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        script_version_id uuid NOT NULL REFERENCES script_version(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('ai_quality', 'human')),
        scores jsonb,
        issues text[] NOT NULL DEFAULT '{}',
        decision text CHECK (decision IN ('approved', 'rejected', 'changes_requested')),
        note text,
        reviewer_id uuid REFERENCES user_account(id) ON DELETE SET NULL,
        approved_hash char(64),
        llm_model text,
        prompt_ref text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_script_review_human CHECK ((kind = 'human') = (decision IS NOT NULL))
      )`);
    await q.query(`CREATE INDEX ix_script_review_version ON script_review (script_version_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS script_review`);
    await q.query(`DROP TABLE IF EXISTS code_verification`);
    await q.query(`DROP TABLE IF EXISTS script_claim`);
    await q.query(`DROP TRIGGER IF EXISTS trg_script_version_immutable ON script_version`);
    await q.query(`DROP TABLE IF EXISTS script_version`);
    await q.query(`DROP FUNCTION IF EXISTS script_version_immutable()`);
    await q.query(`DROP TABLE IF EXISTS video_script`);
    await q.query(`DROP TABLE IF EXISTS content_idea`);
  }
}
