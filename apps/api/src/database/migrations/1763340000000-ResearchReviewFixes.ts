import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 02 review fixes:
 * - trend_topic.youtube_expires_at: when YouTube-derived values in the topic (competition breakdown) must be
 *   redacted (YouTube API Services: data about other channels deleted within 30 days).
 * - Indexes for cascades and listing.
 */
export class ResearchReviewFixes1763340000000 implements MigrationInterface {
  name = 'ResearchReviewFixes1763340000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE trend_topic ADD COLUMN youtube_expires_at timestamptz`);
    await q.query(`CREATE INDEX ix_trend_topic_youtube_expires ON trend_topic (youtube_expires_at) WHERE youtube_expires_at IS NOT NULL`);
    await q.query(`CREATE INDEX ix_trend_topic_signal_signal ON trend_topic_signal (signal_id)`);
    await q.query(`CREATE INDEX ix_trend_collection_ws_created ON trend_collection (workspace_id, created_at DESC)`);
    await q.query(`CREATE INDEX ix_trend_collection_job ON trend_collection (job_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS ix_trend_collection_job`);
    await q.query(`DROP INDEX IF EXISTS ix_trend_collection_ws_created`);
    await q.query(`DROP INDEX IF EXISTS ix_trend_topic_signal_signal`);
    await q.query(`DROP INDEX IF EXISTS ix_trend_topic_youtube_expires`);
    await q.query(`ALTER TABLE trend_topic DROP COLUMN IF EXISTS youtube_expires_at`);
  }
}
