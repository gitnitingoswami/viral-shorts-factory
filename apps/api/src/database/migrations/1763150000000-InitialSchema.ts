import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 01 foundation schema: identity, channels, integrations, jobs, audit.
 * Reversible; verified up → down → up in the e2e suite against the disposable test DB.
 */
export class InitialSchema1763150000000 implements MigrationInterface {
  name = 'InitialSchema1763150000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS citext`);

    await q.query(`
      CREATE TABLE workspace (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `INSERT INTO workspace (id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'Default')`,
    );

    await q.query(`
      CREATE TABLE user_account (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        email citext NOT NULL,
        password_hash text NOT NULL,
        role text NOT NULL CHECK (role IN ('owner', 'reviewer')),
        failed_login_count int NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
        locked_until timestamptz,
        last_login_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_user_account_workspace_email UNIQUE (workspace_id, email)
      )`);

    await q.query(`
      CREATE TABLE refresh_session (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
        family_id uuid NOT NULL,
        token_hash char(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        replaced_by uuid,
        user_agent text,
        ip text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_refresh_session_token_hash UNIQUE (token_hash)
      )`);
    await q.query(`CREATE INDEX ix_refresh_session_user ON refresh_session (user_id)`);
    await q.query(`CREATE INDEX ix_refresh_session_family ON refresh_session (family_id)`);

    await q.query(`
      CREATE TABLE channel (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        platform text NOT NULL CHECK (platform IN ('youtube')),
        handle text NOT NULL,
        title text NOT NULL,
        default_privacy text NOT NULL DEFAULT 'private' CHECK (default_privacy IN ('private', 'unlisted')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_channel_workspace_platform_handle UNIQUE (workspace_id, platform, handle)
      )`);

    await q.query(`
      CREATE TABLE connected_account (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        channel_id uuid REFERENCES channel(id) ON DELETE SET NULL,
        provider text NOT NULL CHECK (provider IN ('youtube')),
        external_account_id text NOT NULL,
        display_name text NOT NULL,
        scopes text[] NOT NULL DEFAULT '{}',
        status text NOT NULL CHECK (status IN ('connected', 'expired', 'revoked')),
        connected_by uuid REFERENCES user_account(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_connected_account UNIQUE (workspace_id, provider, external_account_id)
      )`);

    await q.query(`
      CREATE TABLE job (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        type text NOT NULL,
        queue text NOT NULL,
        idempotency_key text NOT NULL,
        status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        attempt int NOT NULL DEFAULT 0 CHECK (attempt >= 0),
        max_attempts int NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
        progress int NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        input jsonb NOT NULL DEFAULT '{}'::jsonb,
        output jsonb,
        error text,
        correlation_id text,
        created_by uuid REFERENCES user_account(id) ON DELETE SET NULL,
        started_at timestamptz,
        finished_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_job_idempotency_key UNIQUE (idempotency_key)
      )`);
    await q.query(`CREATE INDEX ix_job_status_queue ON job (status, queue)`);

    await q.query(`
      CREATE TABLE audit_event (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        occurred_at timestamptz NOT NULL DEFAULT now(),
        actor_type text NOT NULL CHECK (actor_type IN ('user', 'system', 'worker')),
        actor_id uuid,
        action text NOT NULL,
        subject_type text,
        subject_id text,
        outcome text NOT NULL CHECK (outcome IN ('success', 'failure')),
        correlation_id text,
        ip text,
        details jsonb NOT NULL DEFAULT '{}'::jsonb
      )`);
    await q.query(`CREATE INDEX ix_audit_event_occurred_brin ON audit_event USING brin (occurred_at)`);
    await q.query(`CREATE INDEX ix_audit_event_action ON audit_event (action)`);

    // Audit log is append-only: reject UPDATE/DELETE at the database level.
    await q.query(`
      CREATE FUNCTION audit_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'audit_event is append-only';
      END;
      $$`);
    await q.query(`
      CREATE TRIGGER trg_audit_event_append_only
      BEFORE UPDATE OR DELETE ON audit_event
      FOR EACH ROW EXECUTE FUNCTION audit_event_append_only()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER IF EXISTS trg_audit_event_append_only ON audit_event`);
    await q.query(`DROP FUNCTION IF EXISTS audit_event_append_only()`);
    await q.query(`DROP TABLE IF EXISTS audit_event`);
    await q.query(`DROP TABLE IF EXISTS job`);
    await q.query(`DROP TABLE IF EXISTS connected_account`);
    await q.query(`DROP TABLE IF EXISTS channel`);
    await q.query(`DROP TABLE IF EXISTS refresh_session`);
    await q.query(`DROP TABLE IF EXISTS user_account`);
    await q.query(`DROP TABLE IF EXISTS workspace`);
    // citext extension is left in place: it may be shared and dropping it is not needed for rollback.
  }
}
