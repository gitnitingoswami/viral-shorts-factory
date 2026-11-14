import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Review fixes (Phase 01):
 * - user_account.lockout_count enables exponential lockout backoff.
 * - A statement-level trigger blocks TRUNCATE on the append-only audit log (row triggers don't fire on TRUNCATE).
 */
export class AuthAndAuditHardening1763240000000 implements MigrationInterface {
  name = 'AuthAndAuditHardening1763240000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE user_account ADD COLUMN lockout_count int NOT NULL DEFAULT 0 CHECK (lockout_count >= 0)`,
    );
    await q.query(`
      CREATE TRIGGER trg_audit_event_no_truncate
      BEFORE TRUNCATE ON audit_event
      FOR EACH STATEMENT EXECUTE FUNCTION audit_event_append_only()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER IF EXISTS trg_audit_event_no_truncate ON audit_event`);
    await q.query(`ALTER TABLE user_account DROP COLUMN IF EXISTS lockout_count`);
  }
}
