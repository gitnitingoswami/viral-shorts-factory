import { DataSource } from 'typeorm';
import { resetTestDatabase, testDataSource } from './helpers';

const TABLES = ['workspace', 'user_account', 'refresh_session', 'channel', 'connected_account', 'job', 'audit_event'];

async function tables(ds: DataSource): Promise<string[]> {
  const rows: Array<{ table_name: string }> = await ds.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [TABLES],
  );
  return rows.map((r) => r.table_name).sort();
}

describe('migrations (disposable test DB)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    await resetTestDatabase();
    ds = await testDataSource().initialize();
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('runs up → down → up cleanly', async () => {
    expect(await tables(ds)).toEqual([...TABLES].sort());

    while ((await ds.query(`SELECT 1 FROM schema_migrations LIMIT 1`)).length > 0) {
      await ds.undoLastMigration({ transaction: 'each' });
    }
    expect(await tables(ds)).toEqual([]);

    await ds.runMigrations({ transaction: 'each' });
    expect(await tables(ds)).toEqual([...TABLES].sort());
    const ws: Array<{ id: string }> = await ds.query('SELECT id FROM workspace');
    expect(ws).toEqual([{ id: '00000000-0000-4000-8000-000000000001' }]);
  });

  it('enforces constraints: unique idempotency key and role check', async () => {
    const insertJob = `INSERT INTO job (workspace_id, type, queue, idempotency_key, status)
      VALUES ('00000000-0000-4000-8000-000000000001', 't', 'q', 'same-key', 'queued')`;
    await ds.query(insertJob);
    await expect(ds.query(insertJob)).rejects.toThrow(/uq_job_idempotency_key/);
    await expect(
      ds.query(`INSERT INTO user_account (workspace_id, email, password_hash, role)
        VALUES ('00000000-0000-4000-8000-000000000001', 'x@y.z', 'h', 'admin')`),
    ).rejects.toThrow(/check constraint/);
  });

  it('keeps the audit log append-only', async () => {
    await ds.query(`INSERT INTO audit_event (workspace_id, actor_type, action, outcome)
      VALUES ('00000000-0000-4000-8000-000000000001', 'system', 'test', 'success')`);
    await expect(ds.query(`UPDATE audit_event SET action = 'tampered'`)).rejects.toThrow(/append-only/);
    await expect(ds.query(`DELETE FROM audit_event`)).rejects.toThrow(/append-only/);
    await expect(ds.query(`TRUNCATE audit_event`)).rejects.toThrow(/append-only/);
  });
});
