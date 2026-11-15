import { INestApplication, INestApplicationContext } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import type { TrendCollectionDto } from '@vsf/contracts';
import { JobsService } from '../src/jobs/jobs.service';
import { ResearchPipeline } from '../src/research/research.pipeline';
import { isoWeek, ResearchService } from '../src/research/research.service';
import { createTestApp, createUser, createWorker, resetTestDatabase, waitFor } from './helpers';
import { FixtureOptions, fixtureHttp, SHARED_URL } from './research-fixtures';

const OWNER = { email: 'owner@research.test', password: 'owner-password-123' };
const REVIEWER = { email: 'reviewer@research.test', password: 'reviewer-password-123' };
const TERMINAL = new Set(['completed', 'partial', 'failed']);

describe('Trend research (e2e)', () => {
  let app: INestApplication;
  let http: App;
  let ds: DataSource;
  let owner: string;
  let reviewer: string;
  let nicheId: string;
  let worker: INestApplicationContext | undefined;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function withWorker<T>(opts: FixtureOptions, fn: () => Promise<T>): Promise<T> {
    worker = await createWorker(fixtureHttp(opts));
    try {
      return await fn();
    } finally {
      await worker.close();
      worker = undefined;
    }
  }

  async function runAndWait(key: string): Promise<TrendCollectionDto> {
    const started = await request(http).post('/api/research/runs').set(auth(owner)).send({ nicheId, idempotencyKey: key }).expect(202);
    return waitFor(async () => {
      const res = await request(http).get(`/api/research/collections/${started.body.id}`).set(auth(owner)).expect(200);
      return TERMINAL.has(res.body.status) ? (res.body as TrendCollectionDto) : undefined;
    }, 20_000);
  }

  beforeAll(async () => {
    await resetTestDatabase();
    app = await createTestApp();
    http = app.getHttpServer() as App;
    ds = app.get(DataSource);
    await createUser(app, OWNER.email, OWNER.password, 'owner');
    await createUser(app, REVIEWER.email, REVIEWER.password, 'reviewer');
    owner = (await request(http).post('/api/auth/login').send(OWNER)).body.accessToken;
    reviewer = (await request(http).post('/api/auth/login').send(REVIEWER)).body.accessToken;
  });

  afterAll(async () => {
    await worker?.close();
    await app.close();
  });

  describe('niches and sources', () => {
    it('lists the source registry with configuration status and terms', async () => {
      const res = await request(http).get('/api/research/sources').set(auth(reviewer)).expect(200);
      expect(res.body.map((s: { key: string }) => s.key).sort()).toEqual(['github', 'hackernews', 'rss', 'stackexchange', 'youtube']);
      for (const s of res.body) expect(s.termsUrl).toMatch(/^https:\/\//);
    });

    it('creates and updates a niche (owner only), normalizing keywords', async () => {
      await request(http).post('/api/niches').set(auth(reviewer)).send({ name: 'x', keywords: ['a'] }).expect(403);
      await request(http).post('/api/niches').set(auth(owner)).send({ name: 'No keywords', keywords: [] }).expect(400);
      await request(http).post('/api/niches').set(auth(owner)).send({ name: 'Bad', keywords: ['<script>'] }).expect(400);
      const res = await request(http)
        .post('/api/niches')
        .set(auth(owner))
        .send({ name: 'Coding tips', keywords: ['TypeScript', 'Node.js', 'typescript'], excludeKeywords: ['Gardening'] })
        .expect(201);
      expect(res.body).toMatchObject({ slug: 'coding-tips', keywords: ['typescript', 'node.js'], excludeKeywords: ['gardening'], active: true });
      nicheId = res.body.id;
      await request(http).post('/api/niches').set(auth(owner)).send({ name: 'Coding Tips', keywords: ['git'] }).expect(409);
      const upd = await request(http).patch(`/api/niches/${nicheId}`).set(auth(owner)).send({ description: 'Short tips' }).expect(200);
      expect(upd.body.description).toBe('Short tips');
      // Renaming onto another niche's name is a 409, not a 500.
      const other = await request(http).post('/api/niches').set(auth(owner)).send({ name: 'DevOps', keywords: ['docker'], active: false }).expect(201);
      await request(http).patch(`/api/niches/${other.body.id}`).set(auth(owner)).send({ name: 'Coding tips' }).expect(409);
      const audit = await ds.query<Array<{ action: string }>>(`SELECT action FROM audit_event WHERE action IN ('niche.created', 'niche.updated')`);
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['niche.created', 'niche.updated']));
    });
  });

  describe('manual run', () => {
    let collection: TrendCollectionDto;

    it('is idempotent per key and completes with all sources', async () => {
      const a = await request(http).post('/api/research/runs').set(auth(owner)).send({ nicheId, idempotencyKey: 'run-key-0001' }).expect(202);
      const b = await request(http).post('/api/research/runs').set(auth(owner)).send({ nicheId, idempotencyKey: 'run-key-0001' }).expect(202);
      expect(b.body.id).toBe(a.body.id);
      expect(b.body.jobId).toBe(a.body.jobId);
      await request(http).post('/api/research/runs').set(auth(reviewer)).send({ nicheId, idempotencyKey: 'run-key-0002' }).expect(403);

      collection = await withWorker({ youtubeCounts: { typescript: 40, node: 2 } }, () =>
        waitFor(async () => {
          const res = await request(http).get(`/api/research/collections/${a.body.id}`).set(auth(owner)).expect(200);
          return TERMINAL.has(res.body.status) ? (res.body as TrendCollectionDto) : undefined;
        }, 20_000),
      );
      expect(collection.status).toBe('completed');
      expect(collection.sourceResults.map((r) => [r.source, r.status])).toEqual([
        ['hackernews', 'ok'],
        ['stackexchange', 'ok'],
        ['github', 'ok'],
        ['rss', 'ok'],
        ['youtube', 'ok'],
      ]);
      expect(collection.topicCount).toBeGreaterThan(0);
    });

    it('drops excluded/irrelevant signals and merges duplicates across sources', async () => {
      const res = await request(http).get(`/api/research/collections/${collection.id}/topics?limit=200`).set(auth(owner)).expect(200);
      const titles: string[] = res.body.items.map((t: { title: string }) => t.title);
      expect(titles.join(' ')).not.toMatch(/Gardening/);
      const merged = res.body.items.find((t: { title: string }) => /TypeScript 6\.1/.test(t.title));
      expect(merged.sources).toEqual(expect.arrayContaining(['hackernews', 'rss']));
      const [{ n }] = await ds.query<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM trend_topic t JOIN trend_topic_signal ts ON ts.topic_id = t.id JOIN raw_signal s ON s.id = ts.signal_id WHERE t.id = $1 AND s.url = $2`,
        [merged.id, SHARED_URL],
      );
      expect(n).toBe(2);
    });

    it('stores explainable scores and full provenance for every metric', async () => {
      const list = await request(http).get(`/api/research/collections/${collection.id}/topics?sort=score`).set(auth(owner)).expect(200);
      const top = list.body.items[0];
      // The well-evidenced cross-source topic ranks first (data-poor topics are shrunk).
      expect(top.title).toMatch(/TypeScript 6\.1/);
      expect(top.breakdown).toHaveLength(6);
      expect(top.missingComponents).toEqual(['repeatability']); // first collection: no history yet
      expect(top.confidence).toBeCloseTo(0.95, 3);
      const scores = list.body.items.map((t: { score: number }) => t.score);
      expect([...scores].sort((x, y) => y - x)).toEqual(scores);

      const detail = await request(http).get(`/api/research/topics/${top.id}`).set(auth(reviewer)).expect(200);
      expect(detail.body.signals.length).toBe(top.signalCount);
      for (const m of detail.body.metrics) {
        expect(m.source).toBeTruthy();
        expect(Date.parse(m.observedAt)).not.toBeNaN();
        expect(Date.parse(m.retrievedAt)).not.toBeNaN();
      }
      const [{ orphans }] = await ds.query<Array<{ orphans: number }>>(
        `SELECT count(*)::int AS orphans FROM trend_metric WHERE source_key IS NULL OR observed_at IS NULL OR retrieved_at IS NULL`,
      );
      expect(orphans).toBe(0);
    });

    it('records YouTube competition with a 30-day expiry, quota usage in the ledger, and no other-channel data', async () => {
      const [m] = await ds.query<Array<{ days: number }>>(
        `SELECT round(extract(epoch FROM (expires_at - retrieved_at)) / 86400)::int AS days FROM trend_metric WHERE source_key = 'youtube' LIMIT 1`,
      );
      expect(m.days).toBe(30);
      const [{ units }] = await ds.query<Array<{ units: string }>>(
        `SELECT sum(units)::text AS units FROM expense_record WHERE provider = 'youtube' AND related_id = $1`,
        [collection.id],
      );
      expect(Number(units)).toBeGreaterThan(0);
      const [{ ytSignals }] = await ds.query<Array<{ ytSignals: number }>>(`SELECT count(*)::int AS "ytSignals" FROM raw_signal WHERE source_key = 'youtube'`);
      expect(ytSignals).toBe(0);
    });

    it('filters and searches topics; validates query params', async () => {
      const q = await request(http).get(`/api/research/collections/${collection.id}/topics?q=node&minScore=0.1`).set(auth(owner)).expect(200);
      for (const t of q.body.items) expect(t.title.toLowerCase()).toContain('node');
      await request(http).get(`/api/research/collections/${collection.id}/topics?minScore=2`).set(auth(owner)).expect(400);
      await request(http).get(`/api/research/collections/${collection.id}/topics?sort=random`).set(auth(owner)).expect(400);
      await request(http).get(`/api/research/collections/${collection.id}/topics?q=%25_`).set(auth(owner)).expect(200);
    });

    it('lets reviewers approve/reject and compares 2–4 topics', async () => {
      const list = await request(http).get(`/api/research/collections/${collection.id}/topics`).set(auth(owner)).expect(200);
      const [t1, t2] = list.body.items;
      const d = await request(http).post(`/api/research/topics/${t1.id}/decision`).set(auth(reviewer)).send({ decision: 'approved', note: 'good hook' }).expect(200);
      expect(d.body).toMatchObject({ status: 'approved', decisionNote: 'good hook' });
      const [ev] = await ds.query<Array<{ details: { previous: string; decision: string; note: string } }>>(
        `SELECT details FROM audit_event WHERE action = 'topic.decision' AND subject_id = $1`,
        [t1.id],
      );
      expect(ev.details).toEqual({ previous: 'new', decision: 'approved', note: 'good hook' });
      await request(http).post(`/api/research/topics/${t2.id}/decision`).set(auth(owner)).send({ decision: 'maybe' }).expect(400);
      const approved = await request(http).get(`/api/research/collections/${collection.id}/topics?status=approved`).set(auth(owner)).expect(200);
      expect(approved.body.items.map((t: { id: string }) => t.id)).toEqual([t1.id]);

      const cmp = await request(http).get(`/api/research/topics/compare?ids=${t1.id},${t2.id}`).set(auth(owner)).expect(200);
      expect(cmp.body.map((t: { id: string }) => t.id)).toEqual([t1.id, t2.id]);
      await request(http).get(`/api/research/topics/compare?ids=${t1.id}`).set(auth(owner)).expect(400);
      await request(http).get(`/api/research/topics/compare?ids=${t1.id},not-a-uuid`).set(auth(owner)).expect(400);
    });

    it('produces a weekly report with evidence and limitations', async () => {
      const r = await request(http).get(`/api/research/collections/${collection.id}/report`).set(auth(owner)).expect(200);
      expect(r.body.markdown).toMatch(/# Weekly trend report: Coding tips/);
      expect(r.body.markdown).toContain(SHARED_URL);
      expect(r.body.limitations.join(' ')).toMatch(/not predictions of views/);
    });

    it('is idempotent when the same collection job runs again', async () => {
      const before = await ds.query<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM trend_topic WHERE collection_id = $1`, [collection.id]);
      const pipeline = app.get(ResearchPipeline);
      await pipeline.run(collection.id, () => Promise.resolve(true));
      const after = await ds.query<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM trend_topic WHERE collection_id = $1`, [collection.id]);
      expect(after[0].n).toBe(before[0].n);
    });
  });

  describe('provider failures', () => {
    it('isolates a failing source (partial) and scrubs secrets from stored errors', async () => {
      const c = await withWorker({ failHosts: ['api.stackexchange.com'], youtubeError: 'quota exceeded for key=AIzaFAKE-test-key-0123456789' }, () =>
        runAndWait('run-key-partial'),
      );
      expect(c.status).toBe('partial');
      const se = c.sourceResults.find((r) => r.source === 'stackexchange')!;
      expect(se).toMatchObject({ status: 'failed', message: 'HTTP 503' });
      const yt = c.sourceResults.find((r) => r.source === 'youtube')!;
      expect(yt.status).toBe('failed');
      expect(JSON.stringify(c.sourceResults)).not.toContain('AIzaFAKE');
      expect(c.topicCount).toBeGreaterThan(0);
      const r = await request(http).get(`/api/research/collections/${c.id}/report`).set(auth(owner)).expect(200);
      expect(r.body.limitations.join(' ')).toMatch(/stackexchange.*failed/);
    });

    it('marks the run failed (not crashed) when every discovery source fails', async () => {
      const c = await withWorker({ failHosts: ['hn.algolia.com', 'api.stackexchange.com', 'api.github.com', 'nodejs.org'] }, () => runAndWait('run-key-allfail'));
      expect(c.status).toBe('failed');
      expect(c.topicCount).toBe(0);
    });

    it('uses repeatability once history exists', async () => {
      const c = await withWorker({}, () => runAndWait('run-key-history'));
      const list = await request(http).get(`/api/research/collections/${c.id}/topics`).set(auth(owner)).expect(200);
      const ts = list.body.items.find((t: { title: string }) => /TypeScript 6\.1/.test(t.title));
      expect(ts.missingComponents).not.toContain('repeatability');
      const rep = ts.breakdown.find((b: { component: string }) => b.component === 'repeatability');
      expect(rep.value).toBeGreaterThan(0);
    });
  });

  describe('schedule, budget, retention, leases', () => {
    it('scheduled runs are idempotent per niche and ISO week', async () => {
      const svc = app.get(ResearchService);
      const now = new Date();
      await svc.scheduleWeekly(now);
      await svc.scheduleWeekly(now);
      const rows = await ds.query<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM trend_collection WHERE run_key = $1`, [`scheduled:${nicheId}:${isoWeek(now)}`]);
      expect(rows[0].n).toBe(1);
    });

    it('budget summary is owner-only; an exhausted budget skips YouTube', async () => {
      await request(http).get('/api/budget/summary').set(auth(reviewer)).expect(403);
      const s = await request(http).get('/api/budget/summary').set(auth(owner)).expect(200);
      expect(s.body).toMatchObject({ currency: 'USD', limitMinor: 10000, status: 'ok' });

      await ds.query(`UPDATE budget SET limit_minor = 0`);
      try {
        const c = await withWorker({}, () => runAndWait('run-key-budget'));
        expect(c.sourceResults.find((r) => r.source === 'youtube')).toMatchObject({ status: 'skipped', message: 'monthly budget exhausted' });
        const ex = await request(http).get('/api/budget/summary').set(auth(owner)).expect(200);
        expect(ex.body.status).toBe('exceeded');
      } finally {
        await ds.query(`UPDATE budget SET limit_minor = 10000`);
      }
    });

    it('purges and redacts every YouTube-derived value past its retention window', async () => {
      const [{ withYt }] = await ds.query<Array<{ withYt: number }>>(
        `SELECT count(*)::int AS "withYt" FROM trend_topic WHERE youtube_expires_at IS NOT NULL`,
      );
      expect(withYt).toBeGreaterThan(0);
      await ds.query(`UPDATE trend_metric SET expires_at = now() - interval '1 day' WHERE source_key = 'youtube'`);
      await ds.query(`UPDATE trend_topic SET youtube_expires_at = now() - interval '1 day' WHERE youtube_expires_at IS NOT NULL`);
      const purged = await app.get(ResearchPipeline).purgeExpired();
      expect(purged).toBeGreaterThan(0);
      const [{ n }] = await ds.query<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM trend_metric WHERE source_key = 'youtube'`);
      expect(n).toBe(0);
      // No YouTube number may remain anywhere: topic breakdowns, explanations, or reports.
      const leftovers = await ds.query<Array<{ id: string }>>(
        `SELECT id FROM trend_topic WHERE breakdown::text ~ 'short videos' OR youtube_expires_at IS NOT NULL
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(breakdown) b WHERE b->>'component' = 'competition' AND b->'value' <> 'null'::jsonb)`,
      );
      expect(leftovers).toEqual([]);
      const reports = await ds.query<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM weekly_trend_report WHERE markdown ~ 'short videos|search estimate'`);
      expect(reports[0].n).toBe(0);
      const redacted = await ds.query<Array<{ missing: string[] }>>(`SELECT missing_components AS missing FROM trend_topic WHERE breakdown::text ~ '30-day retention' LIMIT 1`);
      expect(redacted[0].missing).toContain('competition');
    });

    it('stops YouTube calls at the daily cap', async () => {
      await ds.query(
        `INSERT INTO expense_record (workspace_id, provider, category, units, unit, amount_minor) VALUES ('00000000-0000-4000-8000-000000000001', 'youtube', 'api', 80, 'search.list call', 0)`,
      );
      const c = await withWorker({}, () => runAndWait('run-key-cap'));
      expect(c.sourceResults.find((r) => r.source === 'youtube')).toMatchObject({ status: 'skipped', message: 'daily YouTube search cap reached' });
    });

    it('fails collections whose job failed outside the processor (never stuck in running)', async () => {
      const [job] = await ds.query<Array<{ id: string }>>(
        `INSERT INTO job (workspace_id, type, queue, idempotency_key, status, attempt, max_attempts, error)
         VALUES ('00000000-0000-4000-8000-000000000001', 'research.collect', 'research', 'orphan-job', 'failed', 3, 3, 'Lease expired on final attempt') RETURNING id`,
      );
      const [col] = await ds.query<Array<{ id: string }>>(
        `INSERT INTO trend_collection (workspace_id, niche_id, trigger, status, run_key, window_start, window_end, job_id)
         VALUES ('00000000-0000-4000-8000-000000000001', $1, 'manual', 'running', 'orphan-run', now() - interval '7 days', now(), $2) RETURNING id`,
        [nicheId, job.id],
      );
      expect(await app.get(ResearchPipeline).failOrphanedCollections()).toBeGreaterThanOrEqual(1);
      const [row] = await ds.query<Array<{ status: string }>>(`SELECT status FROM trend_collection WHERE id = $1`, [col.id]);
      expect(row.status).toBe('failed');
    });

    it('job lease: a live lease blocks other workers; an expired lease can be reclaimed', async () => {
      const jobs = app.get(JobsService);
      const [row] = await ds.query<Array<{ id: string }>>(
        `INSERT INTO job (workspace_id, type, queue, idempotency_key, status) VALUES ('00000000-0000-4000-8000-000000000001', 'maintenance.ping', 'maintenance', 'lease-test', 'queued') RETURNING id`,
      );
      expect(await jobs.claim(row.id, 'worker-a', 60_000)).not.toBeNull();
      expect(await jobs.claim(row.id, 'worker-b', 60_000)).toBeNull();
      expect(await jobs.heartbeat(row.id, 'worker-b', 60_000)).toBe(false);
      expect(await jobs.heartbeat(row.id, 'worker-a', 60_000, 50)).toBe(true);

      await ds.query(`UPDATE job SET lease_until = now() - interval '1 second' WHERE id = $1`, [row.id]);
      expect(await jobs.claim(row.id, 'worker-b', 60_000)).not.toBeNull();
      expect(await jobs.complete(row.id, 'worker-a', {})).toBe(false); // stale owner can't complete
      expect(await jobs.complete(row.id, 'worker-b', { ok: true })).toBe(true);
    });
  });
});
