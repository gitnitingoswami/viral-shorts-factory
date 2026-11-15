import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 02: trend research, cost ledger and budget, and job leases (follow-up F-01).
 * Every metric row carries its source and observation/retrieval timestamps (provenance).
 */
export class TrendResearch1763330000000 implements MigrationInterface {
  name = 'TrendResearch1763330000000';

  public async up(q: QueryRunner): Promise<void> {
    // --- F-01: job lease (worker identity + expiry) ---
    await q.query(`ALTER TABLE job ADD COLUMN lease_owner text, ADD COLUMN lease_until timestamptz`);
    await q.query(`CREATE INDEX ix_job_running_lease ON job (lease_until) WHERE status = 'running'`);

    await q.query(`
      CREATE TABLE niche (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        name text NOT NULL,
        slug text NOT NULL,
        description text NOT NULL DEFAULT '',
        keywords text[] NOT NULL CHECK (cardinality(keywords) BETWEEN 1 AND 50),
        exclude_keywords text[] NOT NULL DEFAULT '{}',
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_niche_workspace_slug UNIQUE (workspace_id, slug)
      )`);

    await q.query(`
      CREATE TABLE research_source (
        key text PRIMARY KEY CHECK (key IN ('hackernews', 'stackexchange', 'github', 'rss', 'youtube')),
        name text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        terms_url text NOT NULL,
        terms_notes text NOT NULL,
        terms_verified_at date NOT NULL
      )`);
    await q.query(`
      INSERT INTO research_source (key, name, terms_url, terms_notes, terms_verified_at) VALUES
      ('hackernews', 'Hacker News (Algolia search API)', 'https://hn.algolia.com/api',
        'Public read API; metadata and links only, no content republished.', '2026-11-15'),
      ('stackexchange', 'Stack Overflow (Stack Exchange API 2.3)', 'https://api.stackexchange.com/docs',
        'Public API, 300 req/day without key; metadata only (content is CC BY-SA and is not reused).', '2026-11-15'),
      ('github', 'GitHub repository search', 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
        'REST search API; optional read-only token raises rate limit; metadata only.', '2026-11-15'),
      ('rss', 'Official release/blog feeds (allowlisted)', 'https://nodejs.org/en/feed/blog.xml',
        'Allowlisted official feeds; headlines and links only.', '2026-11-15'),
      ('youtube', 'YouTube Data API v3 (search.list)', 'https://developers.google.com/youtube/terms/developer-policies',
        'API key; competition counts only; data about other channels deleted within 30 days.', '2026-11-15')`);

    await q.query(`
      CREATE TABLE trend_collection (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        niche_id uuid NOT NULL REFERENCES niche(id),
        trigger text NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
        status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
        run_key text NOT NULL,
        window_start timestamptz NOT NULL,
        window_end timestamptz NOT NULL,
        started_at timestamptz,
        finished_at timestamptz,
        source_results jsonb NOT NULL DEFAULT '[]'::jsonb,
        job_id uuid REFERENCES job(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_trend_collection_run_key UNIQUE (run_key),
        CONSTRAINT ck_trend_collection_window CHECK (window_end > window_start)
      )`);
    await q.query(`CREATE INDEX ix_trend_collection_niche_created ON trend_collection (niche_id, created_at DESC)`);

    await q.query(`
      CREATE TABLE raw_signal (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        collection_id uuid NOT NULL REFERENCES trend_collection(id) ON DELETE CASCADE,
        source_key text NOT NULL REFERENCES research_source(key),
        external_id text NOT NULL,
        url text NOT NULL,
        title text NOT NULL,
        tags text[] NOT NULL DEFAULT '{}',
        published_at timestamptz,
        retrieved_at timestamptz NOT NULL,
        metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
        expires_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_raw_signal UNIQUE (collection_id, source_key, external_id)
      )`);
    await q.query(`CREATE INDEX ix_raw_signal_expires ON raw_signal (expires_at) WHERE expires_at IS NOT NULL`);

    await q.query(`
      CREATE TABLE trend_topic (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        collection_id uuid NOT NULL REFERENCES trend_collection(id) ON DELETE CASCADE,
        niche_id uuid NOT NULL REFERENCES niche(id),
        title text NOT NULL,
        slug text NOT NULL,
        score numeric(6, 4) NOT NULL CHECK (score BETWEEN 0 AND 1),
        confidence numeric(4, 3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
        breakdown jsonb NOT NULL,
        missing_components text[] NOT NULL DEFAULT '{}',
        stale boolean NOT NULL DEFAULT false,
        sources text[] NOT NULL,
        signal_count int NOT NULL CHECK (signal_count >= 1),
        newest_signal_at timestamptz,
        status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'approved', 'rejected')),
        decided_by uuid REFERENCES user_account(id) ON DELETE SET NULL,
        decided_at timestamptz,
        decision_note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_trend_topic_collection_slug UNIQUE (collection_id, slug)
      )`);
    await q.query(`CREATE INDEX ix_trend_topic_niche_slug ON trend_topic (niche_id, slug)`);

    await q.query(`
      CREATE TABLE trend_topic_signal (
        topic_id uuid NOT NULL REFERENCES trend_topic(id) ON DELETE CASCADE,
        signal_id uuid NOT NULL REFERENCES raw_signal(id) ON DELETE CASCADE,
        PRIMARY KEY (topic_id, signal_id)
      )`);

    await q.query(`
      CREATE TABLE trend_metric (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        topic_id uuid NOT NULL REFERENCES trend_topic(id) ON DELETE CASCADE,
        signal_id uuid REFERENCES raw_signal(id) ON DELETE CASCADE,
        name text NOT NULL,
        value numeric NOT NULL,
        unit text NOT NULL,
        source_key text NOT NULL REFERENCES research_source(key),
        observed_at timestamptz NOT NULL,
        retrieved_at timestamptz NOT NULL,
        expires_at timestamptz
      )`);
    await q.query(`CREATE INDEX ix_trend_metric_topic ON trend_metric (topic_id)`);
    await q.query(`CREATE INDEX ix_trend_metric_expires ON trend_metric (expires_at) WHERE expires_at IS NOT NULL`);

    await q.query(`
      CREATE TABLE weekly_trend_report (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        collection_id uuid NOT NULL REFERENCES trend_collection(id) ON DELETE CASCADE,
        markdown text NOT NULL,
        limitations text[] NOT NULL DEFAULT '{}',
        generated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_weekly_trend_report_collection UNIQUE (collection_id)
      )`);

    // --- Cost ledger and budget (guard enforced before billable work) ---
    await q.query(`
      CREATE TABLE expense_record (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        provider text NOT NULL,
        category text NOT NULL CHECK (category IN ('llm', 'tts', 'image', 'render', 'storage', 'hosting', 'api', 'other')),
        units numeric NOT NULL CHECK (units >= 0),
        unit text NOT NULL,
        amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
        currency char(3) NOT NULL DEFAULT 'USD',
        related_type text,
        related_id text,
        job_id uuid REFERENCES job(id) ON DELETE SET NULL,
        occurred_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX ix_expense_record_ws_time ON expense_record (workspace_id, occurred_at)`);

    await q.query(`
      CREATE TABLE budget (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspace(id),
        scope text NOT NULL CHECK (scope IN ('global', 'provider', 'category')),
        scope_key text,
        period text NOT NULL DEFAULT 'month' CHECK (period IN ('month')),
        limit_minor bigint NOT NULL CHECK (limit_minor >= 0),
        currency char(3) NOT NULL DEFAULT 'USD',
        warn_pct int NOT NULL DEFAULT 80 CHECK (warn_pct BETWEEN 1 AND 100),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_budget_scope_key CHECK ((scope = 'global') = (scope_key IS NULL))
      )`);
    await q.query(
      `CREATE UNIQUE INDEX uq_budget_scope ON budget (workspace_id, scope, COALESCE(scope_key, ''), period)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS budget`);
    await q.query(`DROP TABLE IF EXISTS expense_record`);
    await q.query(`DROP TABLE IF EXISTS weekly_trend_report`);
    await q.query(`DROP TABLE IF EXISTS trend_metric`);
    await q.query(`DROP TABLE IF EXISTS trend_topic_signal`);
    await q.query(`DROP TABLE IF EXISTS trend_topic`);
    await q.query(`DROP TABLE IF EXISTS raw_signal`);
    await q.query(`DROP TABLE IF EXISTS trend_collection`);
    await q.query(`DROP TABLE IF EXISTS research_source`);
    await q.query(`DROP TABLE IF EXISTS niche`);
    await q.query(`DROP INDEX IF EXISTS ix_job_running_lease`);
    await q.query(`ALTER TABLE job DROP COLUMN IF EXISTS lease_until, DROP COLUMN IF EXISTS lease_owner`);
  }
}
