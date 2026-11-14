import { INestApplication, INestApplicationContext } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { cookieFrom, createTestApp, createUser, createWorker, resetTestDatabase, waitFor } from './helpers';

const OWNER = { email: 'owner@test.local', password: 'owner-password-123' };
const REVIEWER = { email: 'reviewer@test.local', password: 'reviewer-password-123' };
const CSRF = { 'X-Requested-With': 'vsf-web' };

describe('API (e2e)', () => {
  let app: INestApplication;
  let http: App;
  let ds: DataSource;
  let ownerToken: string;
  let reviewerToken: string;

  function login(email: string, password: string) {
    return request(http).post('/api/auth/login').send({ email, password });
  }

  async function auditActions(): Promise<string[]> {
    const rows: Array<{ action: string }> = await ds.query('SELECT action FROM audit_event ORDER BY occurred_at');
    return rows.map((r) => r.action);
  }

  beforeAll(async () => {
    await resetTestDatabase();
    app = await createTestApp();
    http = app.getHttpServer() as App;
    ds = app.get(DataSource);
    await createUser(app, OWNER.email, OWNER.password, 'owner');
    await createUser(app, REVIEWER.email, REVIEWER.password, 'reviewer');
    ownerToken = (await login(OWNER.email, OWNER.password)).body.accessToken;
    reviewerToken = (await login(REVIEWER.email, REVIEWER.password)).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('health', () => {
    it('GET /api/health/live is public', async () => {
      const res = await request(http).get('/api/health/live').expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /api/health/ready reports database, redis and storage up', async () => {
      const res = await request(http).get('/api/health/ready').expect(200);
      expect(res.body.status).toBe('ok');
      for (const dep of ['database', 'redis', 'storage']) expect(res.body.checks[dep].status).toBe('up');
    });
  });

  describe('authentication', () => {
    it('rejects protected routes without a token using the ApiError shape and correlation id', async () => {
      const res = await request(http).get('/api/channels').set('X-Correlation-Id', 'e2e-correlation-0001').expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, error: 'Unauthorized', correlationId: 'e2e-correlation-0001' });
      expect(res.headers['x-correlation-id']).toBe('e2e-correlation-0001');
    });

    it('rejects a tampered token', async () => {
      await request(http).get('/api/auth/me').set('Authorization', `Bearer ${ownerToken}x`).expect(401);
    });

    it('rejects wrong credentials generically and audits the failure', async () => {
      const res = await login(OWNER.email, 'not-the-password').expect(401);
      expect(res.body.message).toBe('Invalid email or password');
      const unknown = await login('nobody@test.local', 'whatever-123').expect(401);
      expect(unknown.body.message).toBe('Invalid email or password');
      expect(await auditActions()).toContain('auth.login');
    });

    it('logs in, sets a strict HttpOnly refresh cookie, and never returns the refresh token in the body', async () => {
      const res = await login(OWNER.email, OWNER.password).expect(200);
      expect(res.body).toMatchObject({ expiresIn: 900, user: { email: OWNER.email, role: 'owner' } });
      expect(JSON.stringify(res.body)).not.toMatch(/refresh/i);
      const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('vsf_refresh='))!;
      expect(raw).toMatch(/HttpOnly/);
      expect(raw).toMatch(/SameSite=Strict/);
      expect(raw).toMatch(/Path=\/api\/auth/);
    });

    it('returns the current user from /api/auth/me', async () => {
      const res = await request(http).get('/api/auth/me').set('Authorization', `Bearer ${ownerToken}`).expect(200);
      expect(res.body.email).toBe(OWNER.email);
    });

    it('validates login input', async () => {
      await request(http).post('/api/auth/login').send({ email: 'not-an-email', password: 'x' }).expect(400);
    });
  });

  describe('refresh token rotation', () => {
    it('requires the CSRF header', async () => {
      const res = await login(OWNER.email, OWNER.password);
      const cookie = cookieFrom(res.headers['set-cookie'], 'vsf_refresh')!;
      await request(http).post('/api/auth/refresh').set('Cookie', cookie).expect(403);
    });

    it('rotates on use and revokes the whole family when an old token is replayed', async () => {
      const first = cookieFrom((await login(OWNER.email, OWNER.password)).headers['set-cookie'], 'vsf_refresh')!;
      const r1 = await request(http).post('/api/auth/refresh').set(CSRF).set('Cookie', first).expect(200);
      expect(r1.body.accessToken).toBeTruthy();
      const second = cookieFrom(r1.headers['set-cookie'], 'vsf_refresh')!;
      expect(second).not.toEqual(first);

      // Replay of the already-used token: rejected, and the newer token in the same family is revoked too.
      await request(http).post('/api/auth/refresh').set(CSRF).set('Cookie', first).expect(401);
      await request(http).post('/api/auth/refresh').set(CSRF).set('Cookie', second).expect(401);
      expect(await auditActions()).toContain('auth.refresh_reuse_detected');
    });

    it('logout revokes the session', async () => {
      const cookie = cookieFrom((await login(OWNER.email, OWNER.password)).headers['set-cookie'], 'vsf_refresh')!;
      await request(http).post('/api/auth/logout').set(CSRF).set('Cookie', cookie).expect(204);
      await request(http).post('/api/auth/refresh').set(CSRF).set('Cookie', cookie).expect(401);
    });

    it('rejects refresh without a cookie', async () => {
      await request(http).post('/api/auth/refresh').set(CSRF).expect(401);
    });
  });

  describe('account lockout', () => {
    it('locks after 5 failed attempts, even for the correct password', async () => {
      const email = 'lockme@test.local';
      const password = 'lockme-password-123';
      await createUser(app, email, password, 'reviewer');
      for (let i = 0; i < 5; i++) await login(email, 'wrong-password').expect(401);
      await login(email, password).expect(401);
      expect(await auditActions()).toContain('auth.lockout');
    });
  });

  describe('authorization (roles)', () => {
    it('lets a reviewer read channels but not create them', async () => {
      await request(http).get('/api/channels').set('Authorization', `Bearer ${reviewerToken}`).expect(200);
      await request(http)
        .post('/api/channels')
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ platform: 'youtube', handle: '@reviewer_try', title: 'x' })
        .expect(403);
    });

    it('restricts audit events and user management to owners', async () => {
      await request(http).get('/api/audit-events').set('Authorization', `Bearer ${reviewerToken}`).expect(403);
      await request(http).get('/api/users').set('Authorization', `Bearer ${reviewerToken}`).expect(403);
      await request(http).get('/api/users').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    });
  });

  describe('channels', () => {
    it('creates a channel (private by default), audits it, and rejects duplicates', async () => {
      const res = await request(http)
        .post('/api/channels')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ platform: 'youtube', handle: '@Codehaksy', title: 'Codehaksy' })
        .expect(201);
      expect(res.body).toMatchObject({ handle: '@Codehaksy', defaultPrivacy: 'private' });
      expect(await auditActions()).toContain('http.POST /api/channels');

      await request(http)
        .post('/api/channels')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ platform: 'youtube', handle: '@Codehaksy', title: 'dup' })
        .expect(409);
    });

    it('rejects invalid input and unknown fields', async () => {
      const auth = { Authorization: `Bearer ${ownerToken}` };
      await request(http).post('/api/channels').set(auth).send({ platform: 'youtube', handle: 'no-at', title: 'x' }).expect(400);
      await request(http).post('/api/channels').set(auth).send({ platform: 'tiktok', handle: '@abc', title: 'x' }).expect(400);
      await request(http)
        .post('/api/channels')
        .set(auth)
        .send({ platform: 'youtube', handle: '@abcd', title: 'x', defaultPrivacy: 'public' })
        .expect(400);
    });
  });

  describe('jobs', () => {
    let worker: INestApplicationContext | undefined;

    afterAll(async () => {
      await worker?.close();
    });

    it('is idempotent per key: one job record for repeated requests', async () => {
      const auth = { Authorization: `Bearer ${ownerToken}` };
      const a = await request(http).post('/api/jobs/maintenance/ping').set(auth).send({ idempotencyKey: 'e2e-ping-0001' }).expect(201);
      const b = await request(http).post('/api/jobs/maintenance/ping').set(auth).send({ idempotencyKey: 'e2e-ping-0001' }).expect(200);
      expect(b.body.id).toBe(a.body.id);
      const [{ count }] = await ds.query<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM job WHERE idempotency_key LIKE '%e2e-ping-0001'`,
      );
      expect(count).toBe(1);
    });

    it('is processed by the worker to completion', async () => {
      const auth = { Authorization: `Bearer ${ownerToken}` };
      const created = await request(http).post('/api/jobs/maintenance/ping').set(auth).send({ idempotencyKey: 'e2e-ping-0002' }).expect(201);
      worker = await createWorker();
      const done = await waitFor(async () => {
        const res = await request(http).get(`/api/jobs/${created.body.id}`).set(auth).expect(200);
        return res.body.status === 'completed' ? res.body : undefined;
      });
      expect(done).toMatchObject({ status: 'completed', progress: 100, attempt: 1 });
      expect(await auditActions()).toContain('job.completed');
    });

    it('validates ids and keys, and restricts enqueue to owners', async () => {
      const auth = { Authorization: `Bearer ${ownerToken}` };
      await request(http).get('/api/jobs/not-a-uuid').set(auth).expect(400);
      await request(http).get('/api/jobs/00000000-0000-4000-8000-0000000000ff').set(auth).expect(404);
      await request(http).post('/api/jobs/maintenance/ping').set(auth).send({ idempotencyKey: 'bad key!' }).expect(400);
      await request(http)
        .post('/api/jobs/maintenance/ping')
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ idempotencyKey: 'e2e-ping-0003' })
        .expect(403);
    });

    it('lists jobs with paging metadata', async () => {
      const res = await request(http).get('/api/jobs?limit=1').set('Authorization', `Bearer ${ownerToken}`).expect(200);
      expect(res.body).toMatchObject({ limit: 1, offset: 0 });
      expect(res.body.total).toBeGreaterThanOrEqual(2);
      expect(res.body.items).toHaveLength(1);
    });
  });

  describe('review fixes: concurrency and recovery', () => {
    it('counts concurrent failed logins atomically (parallel guessing cannot bypass the lockout)', async () => {
      const email = 'parallel@test.local';
      const password = 'parallel-password-123';
      await createUser(app, email, password, 'reviewer');
      const results = await Promise.all(Array.from({ length: 6 }, () => login(email, 'wrong-password')));
      expect(results.every((r) => r.status === 401)).toBe(true);
      await login(email, password).expect(401);
      const [row] = await ds.query<Array<{ lockout_count: number; locked: boolean }>>(
        `SELECT lockout_count, locked_until > now() AS locked FROM user_account WHERE email = $1`,
        [email],
      );
      expect(row).toEqual({ lockout_count: 1, locked: true });
    });

    it('serializes concurrent refreshes of the same token: one wins, then the whole family is revoked', async () => {
      const cookie = cookieFrom((await login(OWNER.email, OWNER.password)).headers['set-cookie'], 'vsf_refresh')!;
      const [a, b] = await Promise.all([
        request(http).post('/api/auth/refresh').set(CSRF).set('Cookie', cookie),
        request(http).post('/api/auth/refresh').set(CSRF).set('Cookie', cookie),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 401]);
      const winner = a.status === 200 ? a : b;
      const winnerCookie = cookieFrom(winner.headers['set-cookie'], 'vsf_refresh')!;
      // The loser's request was a reuse of a consumed token, so the winner's new token must be dead too.
      await request(http).post('/api/auth/refresh').set(CSRF).set('Cookie', winnerCookie).expect(401);
    });

    it('returns 409 (not 500) when two creates race on a unique constraint', async () => {
      const body = { platform: 'youtube', handle: '@race_condition', title: 'race' };
      const auth = { Authorization: `Bearer ${ownerToken}` };
      const results = await Promise.all([
        request(http).post('/api/channels').set(auth).send(body),
        request(http).post('/api/channels').set(auth).send(body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('audits authorization denials with the client IP from the trusted proxy header', async () => {
      await request(http)
        .post('/api/channels')
        .set('Authorization', `Bearer ${reviewerToken}`)
        .set('X-Forwarded-For', '203.0.113.7')
        .send({ platform: 'youtube', handle: '@denied_one', title: 'x' })
        .expect(403);
      const rows = await ds.query<Array<{ ip: string; subject_id: string }>>(
        `SELECT ip, subject_id FROM audit_event WHERE action = 'http.denied' ORDER BY occurred_at DESC LIMIT 1`,
      );
      expect(rows[0]).toEqual({ ip: '203.0.113.7', subject_id: 'POST /api/channels' });
    });

    it('does not audit unauthenticated denials (audit log cannot be flooded anonymously)', async () => {
      const before = await ds.query<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM audit_event`);
      for (let i = 0; i < 5; i++) await request(http).get('/api/channels').set('Authorization', 'Bearer garbage').expect(401);
      await request(http).post('/api/auth/logout').expect(403);
      const after = await ds.query<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM audit_event`);
      expect(after[0].n).toBe(before[0].n);
    });

    it('fails a job whose attempts are exhausted instead of retrying forever', async () => {
      const worker = await createWorker();
      try {
        const [row] = await ds.query<Array<{ id: string }>>(
          `INSERT INTO job (workspace_id, type, queue, idempotency_key, status, attempt, max_attempts, updated_at)
           VALUES ('00000000-0000-4000-8000-000000000001', 'maintenance.ping', 'maintenance', 'e2e-exhausted', 'queued', 3, 3, now() - interval '5 minutes')
           RETURNING id`,
        );
        const done = await waitFor(async () => {
          const [j] = await ds.query<Array<{ status: string; error: string }>>(`SELECT status, error FROM job WHERE id = $1`, [row.id]);
          return j.status === 'failed' ? j : undefined;
        });
        expect(done).toEqual({ status: 'failed', error: 'Max attempts exhausted' });
      } finally {
        await worker.close();
      }
    });

    it('recovers jobs without a restart: lost queue messages and abandoned running jobs', async () => {
      const worker = await createWorker();
      try {
        const [lost] = await ds.query<Array<{ id: string }>>(
          `INSERT INTO job (workspace_id, type, queue, idempotency_key, status, updated_at)
           VALUES ('00000000-0000-4000-8000-000000000001', 'maintenance.ping', 'maintenance', 'e2e-lost-message', 'queued', now() - interval '5 minutes')
           RETURNING id`,
        );
        const [stuck] = await ds.query<Array<{ id: string }>>(
          `INSERT INTO job (workspace_id, type, queue, idempotency_key, status, attempt, started_at)
           VALUES ('00000000-0000-4000-8000-000000000001', 'maintenance.ping', 'maintenance', 'e2e-stuck-running', 'running', 1, now() - interval '1 hour')
           RETURNING id`,
        );
        for (const id of [lost.id, stuck.id]) {
          const done = await waitFor(async () => {
            const [row] = await ds.query<Array<{ status: string }>>(`SELECT status FROM job WHERE id = $1`, [id]);
            return row.status === 'completed' ? row : undefined;
          }, 15_000);
          expect(done.status).toBe('completed');
        }
      } finally {
        await worker.close();
      }
    });
  });

  describe('audit events API', () => {
    it('pages audit events newest first for owners', async () => {
      const res = await request(http).get('/api/audit-events?limit=5').set('Authorization', `Bearer ${ownerToken}`).expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(5);
      expect(res.body.total).toBeGreaterThan(0);
      const times = res.body.items.map((i: { occurredAt: string }) => Date.parse(i.occurredAt));
      expect([...times].sort((x, y) => y - x)).toEqual(times);
    });
  });
});
